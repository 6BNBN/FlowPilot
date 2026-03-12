/**
 * @module infrastructure/runtime-state
 * @description 运行时状态辅助 - 文件锁元数据与判定逻辑
 */

import { readFileSync, unlink } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { hostname as getHostname } from 'os';
import { join } from 'path';
import type { ProgressData, TaskPhase } from '../domain/types';

const DEFAULT_INVALID_LOCK_STALE_AFTER_MS = 30_000;
const LINUX_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
const RUNTIME_DIR = '.workflow';
const ACTIVATED_FILE = 'activated.json';
const DIRTY_BASELINE_FILE = 'dirty-baseline.json';
const OWNED_FILES_FILE = 'owned-files.json';
const SETUP_OWNED_FILES_FILE = 'setup-owned.json';
const RECONCILE_STATE_FILE = 'reconcile-state.json';
const TASK_PULSES_FILE = 'task-pulses.json';
const INJECTIONS_FILE = 'injections.json';
const RUNTIME_PATH_PREFIXES = ['.flowpilot/', '.workflow/'];
const RUNTIME_FILES = new Set(['.claude/settings.json']);

/** 运行时锁元数据 */
export interface RuntimeLockMetadata {
  pid: number;
  hostname: string;
  createdAt: string;
  localityToken?: string;
}

/** 任务激活元数据 */
export interface TaskActivationMetadata {
  time: number;
  pid: number;
}

/** 工作流 dirty baseline */
export interface DirtyBaseline {
  capturedAt: string;
  files: string[];
}

/** checkpoint 持久化的 workflow-owned 文件 */
export interface OwnedFilesState {
  byTask: Record<string, string[]>;
}

/** setup/init 阶段由 FlowPilot 自身改写、可用于边界解释但不可自动提交的文件 */
export interface SetupOwnedState {
  files: string[];
}

/** 中断恢复后待接管的任务 */
export interface ReconcileState {
  taskIds: string[];
}

/** 子代理实时阶段上报 */
export interface TaskPulseStateEntry {
  phase: TaskPhase;
  updatedAt: string;
  note?: string;
}

/** 所有任务的实时阶段状态 */
export interface TaskPulseState {
  byTask: Record<string, TaskPulseStateEntry>;
}

/** FlowPilot 写入 settings.json 的 hook 结构 */
export interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; prompt: string }>;
}

/** 文件系统精确快照：记录是否存在以及原始文本 */
export interface ExactFileSnapshot {
  exists: boolean;
  rawContent?: string;
}

/** CLAUDE.md 注入清理信息 */
export interface ClaudeMdInjectionState {
  created: boolean;
  block: string;
  path?: string;
  scaffold?: string;
}

/** settings.json 注入清理信息 */
export interface HooksInjectionState {
  created: boolean;
  preToolUse: HookEntry[];
  settingsBaseline?: ExactFileSnapshot;
}

/** .gitignore 注入清理信息 */
export interface GitignoreInjectionState {
  created: boolean;
  rules: string[];
  baseline?: ExactFileSnapshot;
}

/** setup/init 阶段的精确注入 manifest */
export interface SetupInjectionManifest {
  claudeMd?: ClaudeMdInjectionState;
  roleMd?: ClaudeMdInjectionState;
  hooks?: HooksInjectionState;
  gitignore?: GitignoreInjectionState;
}

/** 当前 dirty 文件相对 baseline 的对比结果 */
export interface DirtyFileComparison {
  currentFiles: string[];
  preservedBaselineFiles: string[];
  newDirtyFiles: string[];
}

/** resume/restart 时的 dirty 文件归属分类 */
export interface ResumeDirtyClassification {
  currentFiles: string[];
  preservedBaselineFiles: string[];
  taskOwnedResidueFiles: string[];
  ambiguousFiles: string[];
}

/** 运行时锁解析结果 */
export type ParsedRuntimeLock =
  | { valid: true; metadata: RuntimeLockMetadata }
  | { valid: false; reason: 'invalid-json' | 'invalid-shape' };

/** 运行时锁陈旧判定输入 */
export interface RuntimeLockStaleCheckInput {
  parsed: ParsedRuntimeLock;
  fileAgeMs: number;
  staleAfterMs: number;
  isProcessAlive: (pid: number) => boolean;
  currentHostname: string;
  currentLocalityToken?: string;
  nowMs?: number;
}

/** 运行时锁陈旧判定结果 */
export interface RuntimeLockStaleDecision {
  stale: boolean;
  reason: 'live-owner' | 'dead-owner' | 'foreign-host-lock' | 'invalid-lock-payload' | 'unverified-locality';
  owner?: RuntimeLockMetadata;
  ageMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCreatedAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function runtimeDir(basePath: string): string {
  return join(basePath, RUNTIME_DIR);
}

function runtimePath(basePath: string, fileName: string): string {
  return join(runtimeDir(basePath), fileName);
}

function normalizeRuntimePath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isRuntimeMetadataPath(file: string): boolean {
  return RUNTIME_FILES.has(file)
    || RUNTIME_PATH_PREFIXES.some(prefix => file === prefix.slice(0, -1) || file.startsWith(prefix));
}

function isActivationMetadata(value: unknown): value is TaskActivationMetadata {
  return isRecord(value)
    && typeof value.time === 'number'
    && Number.isFinite(value.time)
    && Number.isInteger(value.pid)
    && value.pid > 0;
}

function normalizeDirtyFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const normalized = files
    .map(normalizeRuntimePath)
    .filter(file => file.length > 0)
    .filter(file => !isRuntimeMetadataPath(file));

  for (const file of normalized) {
    seen.add(file);
  }

  return [...seen].sort();
}

function isOwnedFilesState(value: unknown): value is OwnedFilesState {
  return isRecord(value) && isRecord(value.byTask);
}

function isSetupOwnedState(value: unknown): value is SetupOwnedState {
  return isRecord(value) && Array.isArray(value.files);
}

function isReconcileState(value: unknown): value is ReconcileState {
  return isRecord(value) && Array.isArray(value.taskIds);
}

function isTaskPulsePhase(value: unknown): value is TaskPhase {
  return value === 'analysis'
    || value === 'implementation'
    || value === 'verification'
    || value === 'blocked';
}

function isTaskPulseStateEntry(value: unknown): value is TaskPulseStateEntry {
  return isRecord(value)
    && isTaskPulsePhase(value.phase)
    && isValidCreatedAt(value.updatedAt)
    && (value.note === undefined || typeof value.note === 'string');
}

function isTaskPulseState(value: unknown): value is TaskPulseState {
  return isRecord(value)
    && isRecord(value.byTask)
    && Object.values(value.byTask).every(isTaskPulseStateEntry);
}

function isHookEntry(value: unknown): value is HookEntry {
  if (!isRecord(value) || typeof value.matcher !== 'string' || !Array.isArray(value.hooks)) {
    return false;
  }

  return value.hooks.every(hook => isRecord(hook) && typeof hook.type === 'string' && typeof hook.prompt === 'string');
}

function isExactFileSnapshot(value: unknown): value is ExactFileSnapshot {
  return isRecord(value)
    && typeof value.exists === 'boolean'
    && (value.rawContent === undefined || typeof value.rawContent === 'string');
}

function isClaudeMdInjectionState(value: unknown): value is ClaudeMdInjectionState {
  return isRecord(value)
    && typeof value.created === 'boolean'
    && typeof value.block === 'string'
    && (value.path === undefined || typeof value.path === 'string')
    && (value.scaffold === undefined || typeof value.scaffold === 'string');
}

function isHooksInjectionState(value: unknown): value is HooksInjectionState {
  return isRecord(value)
    && typeof value.created === 'boolean'
    && Array.isArray(value.preToolUse)
    && value.preToolUse.every(isHookEntry)
    && (value.settingsBaseline === undefined || isExactFileSnapshot(value.settingsBaseline));
}

function isGitignoreInjectionState(value: unknown): value is GitignoreInjectionState {
  return isRecord(value)
    && typeof value.created === 'boolean'
    && Array.isArray(value.rules)
    && value.rules.every(rule => typeof rule === 'string')
    && (value.baseline === undefined || isExactFileSnapshot(value.baseline));
}

function isSetupInjectionManifest(value: unknown): value is SetupInjectionManifest {
  return isRecord(value)
    && (value.claudeMd === undefined || isClaudeMdInjectionState(value.claudeMd))
    && (value.roleMd === undefined || isClaudeMdInjectionState(value.roleMd))
    && (value.hooks === undefined || isHooksInjectionState(value.hooks))
    && (value.gitignore === undefined || isGitignoreInjectionState(value.gitignore));
}

function normalizeSetupOwnedState(state: SetupOwnedState): SetupOwnedState {
  return {
    files: normalizeDirtyFiles(state.files.filter((file): file is string => typeof file === 'string')),
  };
}

function normalizeReconcileState(state: ReconcileState): ReconcileState {
  return {
    taskIds: [...new Set(
      state.taskIds
        .filter((taskId): taskId is string => typeof taskId === 'string')
        .map(taskId => taskId.trim())
        .filter(taskId => taskId.length > 0),
    )],
  };
}

function normalizeTaskPulseState(state: TaskPulseState): TaskPulseState {
  return {
    byTask: Object.fromEntries(
      Object.entries(state.byTask)
        .filter(([taskId]) => taskId.trim().length > 0)
        .filter(([, entry]) => isTaskPulseStateEntry(entry))
        .map(([taskId, entry]) => [
          taskId.trim(),
          {
            phase: entry.phase,
            updatedAt: entry.updatedAt,
            ...(entry.note && entry.note.trim().length > 0 ? { note: entry.note.trim() } : {}),
          },
        ]),
    ),
  };
}

function normalizeOwnedFilesState(state: OwnedFilesState): OwnedFilesState {
  return {
    byTask: Object.fromEntries(
      Object.entries(state.byTask)
        .filter(([taskId]) => taskId.trim().length > 0)
        .map(([taskId, files]) => [taskId, normalizeDirtyFiles(Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [])]),
    ),
  };
}

function dedupeHookEntries(entries: HookEntry[]): HookEntry[] {
  const byMatcher = new Map<string, HookEntry>();
  for (const entry of entries) {
    byMatcher.set(entry.matcher, {
      matcher: entry.matcher,
      hooks: entry.hooks.map(hook => ({ type: hook.type, prompt: hook.prompt })),
    });
  }
  return [...byMatcher.values()].sort((a, b) => a.matcher.localeCompare(b.matcher));
}

function normalizeSetupInjectionManifest(manifest: SetupInjectionManifest): SetupInjectionManifest {
  const normalized: SetupInjectionManifest = {};

  if (manifest.claudeMd) {
    normalized.claudeMd = {
      created: manifest.claudeMd.created,
      block: manifest.claudeMd.block,
      ...(manifest.claudeMd.path !== undefined ? { path: manifest.claudeMd.path } : {}),
      ...(manifest.claudeMd.scaffold !== undefined ? { scaffold: manifest.claudeMd.scaffold } : {}),
    };
  }

  if (manifest.roleMd) {
    normalized.roleMd = {
      created: manifest.roleMd.created,
      block: manifest.roleMd.block,
      ...(manifest.roleMd.path !== undefined ? { path: manifest.roleMd.path } : {}),
      ...(manifest.roleMd.scaffold !== undefined ? { scaffold: manifest.roleMd.scaffold } : {}),
    };
  }

  if (manifest.hooks) {
    normalized.hooks = {
      created: manifest.hooks.created,
      preToolUse: dedupeHookEntries(manifest.hooks.preToolUse),
      ...(manifest.hooks.settingsBaseline
        ? {
          settingsBaseline: {
            exists: manifest.hooks.settingsBaseline.exists,
            ...(manifest.hooks.settingsBaseline.rawContent !== undefined
              ? { rawContent: manifest.hooks.settingsBaseline.rawContent }
              : {}),
          },
        }
        : {}),
    };
  }

  if (manifest.gitignore) {
    normalized.gitignore = {
      created: manifest.gitignore.created,
      rules: [...new Set(manifest.gitignore.rules)],
      ...(manifest.gitignore.baseline
        ? {
          baseline: {
            exists: manifest.gitignore.baseline.exists,
            ...(manifest.gitignore.baseline.rawContent !== undefined
              ? { rawContent: manifest.gitignore.baseline.rawContent }
              : {}),
          },
        }
        : {}),
    };
  }

  return normalized;
}

/** 对比当前 dirty 文件与 workflow 启动 baseline，区分历史脏文件与中断残留 */
export function compareDirtyFilesAgainstBaseline(
  currentFiles: string[],
  baselineFiles: string[],
): DirtyFileComparison {
  const normalizedCurrentFiles = normalizeDirtyFiles(currentFiles);
  const normalizedBaselineFiles = normalizeDirtyFiles(baselineFiles);
  const baselineSet = new Set(normalizedBaselineFiles);

  return {
    currentFiles: normalizedCurrentFiles,
    preservedBaselineFiles: normalizedCurrentFiles.filter(file => baselineSet.has(file)),
    newDirtyFiles: normalizedCurrentFiles.filter(file => !baselineSet.has(file)),
  };
}

/** 将当前 dirty 文件划分为 baseline 保留、明确 task-owned residue、以及归属未明变更 */
export function classifyResumeDirtyFiles(
  currentFiles: string[],
  baselineFiles: string[] | null,
  setupOwnedFiles: string[],
  taskOwnedFiles: string[],
): ResumeDirtyClassification {
  const comparison = compareDirtyFilesAgainstBaseline(currentFiles, baselineFiles ?? []);
  const setupOwnedSet = new Set(normalizeDirtyFiles(setupOwnedFiles));
  const taskOwnedSet = new Set(normalizeDirtyFiles(taskOwnedFiles));
  const candidateFiles = (baselineFiles ? comparison.newDirtyFiles : comparison.currentFiles)
    .filter(file => !setupOwnedSet.has(file));

  return {
    currentFiles: comparison.currentFiles.filter(file => !setupOwnedSet.has(file)),
    preservedBaselineFiles: comparison.preservedBaselineFiles.filter(file => !setupOwnedSet.has(file)),
    taskOwnedResidueFiles: candidateFiles.filter(file => taskOwnedSet.has(file)),
    ambiguousFiles: candidateFiles.filter(file => !taskOwnedSet.has(file)),
  };
}

/** 读取当前机器可证明的本地性令牌 */
export function getRuntimeLocalityToken(): string | undefined {
  try {
    const token = readFileSync(LINUX_BOOT_ID_PATH, 'utf-8').trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

/** 创建当前进程的运行时锁元数据 */
export function createRuntimeLockMetadata(): RuntimeLockMetadata {
  const localityToken = getRuntimeLocalityToken();
  return {
    pid: process.pid,
    hostname: getHostname(),
    createdAt: new Date().toISOString(),
    ...(localityToken ? { localityToken } : {}),
  };
}

/** 序列化运行时锁元数据 */
export function serializeRuntimeLock(metadata: RuntimeLockMetadata): string {
  return JSON.stringify(metadata);
}

/** 解析运行时锁元数据 */
export function parseRuntimeLock(raw: string): ParsedRuntimeLock {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { valid: false, reason: 'invalid-shape' };

    const pid = parsed.pid;
    const hostname = parsed.hostname;
    const createdAt = parsed.createdAt;
    const localityToken = parsed.localityToken;
    if (
      !Number.isInteger(pid)
      || pid <= 0
      || typeof hostname !== 'string'
      || hostname.length === 0
      || !isValidCreatedAt(createdAt)
      || (localityToken !== undefined && (typeof localityToken !== 'string' || localityToken.length === 0))
    ) {
      return { valid: false, reason: 'invalid-shape' };
    }

    return {
      valid: true,
      metadata: {
        pid,
        hostname,
        createdAt,
        ...(typeof localityToken === 'string' ? { localityToken } : {}),
      },
    };
  } catch {
    return { valid: false, reason: 'invalid-json' };
  }
}

/** 计算锁年龄 */
export function getRuntimeLockAgeMs(metadata: RuntimeLockMetadata, nowMs = Date.now()): number {
  return Math.max(0, nowMs - Date.parse(metadata.createdAt));
}

/** 判断锁是否由当前进程持有 */
export function isRuntimeLockOwnedByProcess(
  parsed: ParsedRuntimeLock,
  pid = process.pid,
  currentHostname = getHostname(),
  currentLocalityToken = getRuntimeLocalityToken(),
): boolean {
  if (!parsed.valid || parsed.metadata.pid !== pid || parsed.metadata.hostname !== currentHostname) {
    return false;
  }

  if (parsed.metadata.localityToken === undefined) {
    return true;
  }

  return currentLocalityToken !== undefined && parsed.metadata.localityToken === currentLocalityToken;
}

/** 判断运行时锁是否可视为陈旧 */
export function isRuntimeLockStale(input: RuntimeLockStaleCheckInput): RuntimeLockStaleDecision {
  if (!input.parsed.valid) {
    return {
      stale: input.fileAgeMs >= input.staleAfterMs,
      reason: 'invalid-lock-payload',
      ageMs: input.fileAgeMs,
    };
  }

  const ageMs = getRuntimeLockAgeMs(input.parsed.metadata, input.nowMs ?? Date.now());
  if (input.parsed.metadata.hostname !== input.currentHostname) {
    return {
      stale: false,
      reason: 'foreign-host-lock',
      owner: input.parsed.metadata,
      ageMs,
    };
  }

  if (input.parsed.metadata.localityToken !== undefined && input.currentLocalityToken !== undefined) {
    if (input.parsed.metadata.localityToken !== input.currentLocalityToken) {
      return {
        stale: false,
        reason: 'foreign-host-lock',
        owner: input.parsed.metadata,
        ageMs,
      };
    }
  } else {
    return {
      stale: false,
      reason: 'unverified-locality',
      owner: input.parsed.metadata,
      ageMs,
    };
  }

  if (input.isProcessAlive(input.parsed.metadata.pid)) {
    return {
      stale: false,
      reason: 'live-owner',
      owner: input.parsed.metadata,
      ageMs,
    };
  }

  return {
    stale: true,
    reason: 'dead-owner',
    owner: input.parsed.metadata,
    ageMs,
  };
}

/** 读取任务激活状态 */
export async function loadActivationState(basePath: string): Promise<Record<string, TaskActivationMetadata>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, ACTIVATED_FILE), 'utf-8'));
    if (!isRecord(parsed)) return {};

    const entries = Object.entries(parsed)
      .filter((entry): entry is [string, TaskActivationMetadata] => isActivationMetadata(entry[1]));
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

/** 持久化任务激活状态 */
export async function recordTaskActivations(
  basePath: string,
  ids: string[],
  nowMs = Date.now(),
  pid = process.pid,
): Promise<Record<string, TaskActivationMetadata>> {
  const current = await loadActivationState(basePath);
  const next = ids.reduce<Record<string, TaskActivationMetadata>>(
    (state, id) => ({ ...state, [id]: { time: nowMs, pid } }),
    current,
  );
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, ACTIVATED_FILE);
  await writeFile(path + '.tmp', JSON.stringify(next), 'utf-8');
  await rename(path + '.tmp', path);
  return next;
}

/** 读取指定任务的持久化激活时长(ms)，缺失时返回 Infinity */
export async function getTaskActivationAge(
  basePath: string,
  id: string,
  _pid = process.pid,
  nowMs = Date.now(),
): Promise<number> {
  const state = await loadActivationState(basePath);
  const entry = state[id];
  if (!entry) return Infinity;
  return Math.max(0, nowMs - entry.time);
}

/** 读取 dirty baseline，旧工作流缺失时返回 null */
export async function loadDirtyBaseline(basePath: string): Promise<DirtyBaseline | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, DIRTY_BASELINE_FILE), 'utf-8'));
    if (!isRecord(parsed) || !isValidCreatedAt(parsed.capturedAt) || !Array.isArray(parsed.files)) {
      return null;
    }

    const files = parsed.files.filter((file): file is string => typeof file === 'string');
    return {
      capturedAt: parsed.capturedAt,
      files: normalizeDirtyFiles(files),
    };
  } catch {
    return null;
  }
}

/** 保存 dirty baseline */
export async function saveDirtyBaseline(
  basePath: string,
  files: string[],
  capturedAt = new Date().toISOString(),
): Promise<DirtyBaseline> {
  const baseline: DirtyBaseline = {
    capturedAt,
    files: normalizeDirtyFiles(files),
  };
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, DIRTY_BASELINE_FILE);
  await writeFile(path + '.tmp', JSON.stringify(baseline), 'utf-8');
  await rename(path + '.tmp', path);
  return baseline;
}

/** 读取 checkpoint-owned 文件状态，旧工作流缺失时返回空映射 */
export async function loadOwnedFiles(basePath: string): Promise<OwnedFilesState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, OWNED_FILES_FILE), 'utf-8'));
    if (!isOwnedFilesState(parsed)) {
      return { byTask: {} };
    }
    return normalizeOwnedFilesState(parsed);
  } catch {
    return { byTask: {} };
  }
}

/** 持久化单个 checkpoint 的 owned-file intent */
export async function recordOwnedFiles(
  basePath: string,
  taskId: string,
  files: string[],
): Promise<OwnedFilesState> {
  const current = await loadOwnedFiles(basePath);
  const next = normalizeOwnedFilesState({
    byTask: {
      ...current.byTask,
      [taskId]: normalizeDirtyFiles(files),
    },
  });
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, OWNED_FILES_FILE);
  await writeFile(path + '.tmp', JSON.stringify(next), 'utf-8');
  await rename(path + '.tmp', path);
  return next;
}

/** 读取 setup-owned 文件状态，旧工作流缺失时返回空列表 */
export async function loadSetupOwnedFiles(basePath: string): Promise<SetupOwnedState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, SETUP_OWNED_FILES_FILE), 'utf-8'));
    if (!isSetupOwnedState(parsed)) {
      return { files: [] };
    }
    return normalizeSetupOwnedState(parsed);
  } catch {
    return { files: [] };
  }
}

/** 读取任务实时阶段状态 */
export async function loadTaskPulseState(basePath: string): Promise<TaskPulseState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, TASK_PULSES_FILE), 'utf-8'));
    if (!isTaskPulseState(parsed)) return { byTask: {} };
    return normalizeTaskPulseState(parsed);
  } catch {
    return { byTask: {} };
  }
}

/** 保存整个任务实时阶段状态 */
export async function saveTaskPulseState(basePath: string, state: TaskPulseState): Promise<TaskPulseState> {
  const normalized = normalizeTaskPulseState(state);
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, TASK_PULSES_FILE);
  await writeFile(path + '.tmp', JSON.stringify(normalized, null, 2) + '\n', 'utf-8');
  await rename(path + '.tmp', path);
  return normalized;
}

/** 写入单个任务的实时阶段上报 */
export async function recordTaskPulse(
  basePath: string,
  taskId: string,
  entry: TaskPulseStateEntry,
): Promise<TaskPulseState> {
  const current = await loadTaskPulseState(basePath);
  return saveTaskPulseState(basePath, {
    byTask: {
      ...current.byTask,
      [taskId]: {
        phase: entry.phase,
        updatedAt: entry.updatedAt,
        ...(entry.note && entry.note.trim().length > 0 ? { note: entry.note.trim() } : {}),
      },
    },
  });
}

/** 清除单个任务的实时阶段上报 */
export async function clearTaskPulse(basePath: string, taskId: string): Promise<TaskPulseState> {
  const current = await loadTaskPulseState(basePath);
  if (!current.byTask[taskId]) return current;
  const next = { ...current.byTask };
  delete next[taskId];
  return saveTaskPulseState(basePath, { byTask: next });
}

/** 将持久化的任务阶段上报合并回 ProgressData，供 status/formatter 层消费 */
export function mergeTaskPulsesIntoProgress(data: ProgressData, pulseState: TaskPulseState): ProgressData {
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      const pulse = pulseState.byTask[task.id];
      if (!pulse) return task;
      return {
        ...task,
        phase: pulse.phase,
        phaseUpdatedAt: pulse.updatedAt,
        ...(pulse.note ? { phaseNote: pulse.note } : {}),
      };
    }),
  };
}

/** 持久化 setup/init 阶段的 explainable FlowPilot-owned 文件 */
export async function saveSetupOwnedFiles(basePath: string, files: string[]): Promise<SetupOwnedState> {
  const next = normalizeSetupOwnedState({ files });
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, SETUP_OWNED_FILES_FILE);
  await writeFile(path + '.tmp', JSON.stringify(next), 'utf-8');
  await rename(path + '.tmp', path);
  return next;
}

/** 读取中断待接管任务状态，缺失时返回空列表 */
export async function loadReconcileState(basePath: string): Promise<ReconcileState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, RECONCILE_STATE_FILE), 'utf-8'));
    if (!isReconcileState(parsed)) {
      return { taskIds: [] };
    }
    return normalizeReconcileState(parsed);
  } catch {
    return { taskIds: [] };
  }
}

/** 持久化中断待接管任务状态 */
export async function saveReconcileState(basePath: string, taskIds: string[]): Promise<ReconcileState> {
  const next = normalizeReconcileState({ taskIds });
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, RECONCILE_STATE_FILE);
  await writeFile(path + '.tmp', JSON.stringify(next), 'utf-8');
  await rename(path + '.tmp', path);
  return next;
}

/** 清理中断待接管任务状态 */
export async function clearReconcileState(basePath: string): Promise<void> {
  try {
    await unlink(runtimePath(basePath, RECONCILE_STATE_FILE));
  } catch {}
}

/** 读取 setup/init 阶段的精确注入 manifest */
export async function loadSetupInjectionManifest(basePath: string): Promise<SetupInjectionManifest> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath(basePath, INJECTIONS_FILE), 'utf-8'));
    if (!isSetupInjectionManifest(parsed)) {
      return {};
    }
    return normalizeSetupInjectionManifest(parsed);
  } catch {
    return {};
  }
}

/** 合并并持久化 setup/init 阶段的精确注入 manifest */
export async function mergeSetupInjectionManifest(
  basePath: string,
  patch: SetupInjectionManifest,
): Promise<SetupInjectionManifest> {
  const current = await loadSetupInjectionManifest(basePath);
  const next = normalizeSetupInjectionManifest({
    ...current,
    ...(patch.claudeMd ? { claudeMd: patch.claudeMd } : {}),
    ...(patch.roleMd ? { roleMd: patch.roleMd } : {}),
    ...(patch.gitignore ? { gitignore: patch.gitignore } : {}),
    ...(patch.hooks
      ? {
        hooks: {
          created: current.hooks?.created || patch.hooks.created,
          preToolUse: [
            ...(current.hooks?.preToolUse ?? []),
            ...patch.hooks.preToolUse,
          ],
          settingsBaseline: current.hooks?.settingsBaseline ?? patch.hooks.settingsBaseline,
        },
      }
      : {}),
  });
  await mkdir(runtimeDir(basePath), { recursive: true });
  const path = runtimePath(basePath, INJECTIONS_FILE);
  await writeFile(path + '.tmp', JSON.stringify(next), 'utf-8');
  await rename(path + '.tmp', path);
  return next;
}

/** 汇总所有 checkpoint 持久化的 workflow-owned 文件 */
export function collectOwnedFiles(state: OwnedFilesState): string[] {
  const allFiles = Object.values(state.byTask).flatMap(files => files);
  return normalizeDirtyFiles(allFiles);
}

/** 无效锁文件的默认陈旧回收阈值 */
export function defaultInvalidLockStaleAfterMs(): number {
  return DEFAULT_INVALID_LOCK_STALE_AFTER_MS;
}
