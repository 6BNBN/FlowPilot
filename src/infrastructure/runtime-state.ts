/**
 * @module infrastructure/runtime-state
 * @description 运行时状态辅助 - 文件锁元数据与判定逻辑
 */

import { readFileSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { hostname as getHostname } from 'os';
import { join } from 'path';

const DEFAULT_INVALID_LOCK_STALE_AFTER_MS = 30_000;
const LINUX_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
const RUNTIME_DIR = '.workflow';
const ACTIVATED_FILE = 'activated.json';
const DIRTY_BASELINE_FILE = 'dirty-baseline.json';
const RUNTIME_PATH_PREFIXES = ['.flowpilot/', '.workflow/'];

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
  return RUNTIME_PATH_PREFIXES.some(prefix => file === prefix.slice(0, -1) || file.startsWith(prefix));
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

/** 读取指定任务的跨进程激活时长(ms)，同进程返回 Infinity */
export async function getTaskActivationAge(
  basePath: string,
  id: string,
  pid = process.pid,
  nowMs = Date.now(),
): Promise<number> {
  const state = await loadActivationState(basePath);
  const entry = state[id];
  if (!entry || entry.pid === pid) return Infinity;
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

/** 无效锁文件的默认陈旧回收阈值 */
export function defaultInvalidLockStaleAfterMs(): number {
  return DEFAULT_INVALID_LOCK_STALE_AFTER_MS;
}
