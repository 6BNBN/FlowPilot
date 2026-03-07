# Persistent Evolution and Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make evolution config survive `finish`/`clearAll`, fix heartbeat to read the real persisted progress source, and add a small `finish` summary that shows whether reflection/experiment ran and which config keys changed.

**Architecture:** Keep execution state under `.workflow/` and persistent state under `.flowpilot/`. Move long-lived config to `.flowpilot/config.json`, add a compatibility migration path from `.workflow/config.json`, and reuse the real `progress.md` parser so heartbeat reads the same source as the repository.

**Tech Stack:** TypeScript, Node.js built-ins, Vitest, FlowPilot repository/service architecture.

---

### Task 1: Inventory exact path consumers

**Files:**
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/domain/repository.ts`
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.ts`
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.ts`
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/hooks.ts`
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/verify.ts`
- Read: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.ts`

**Step 1: Search config path references**

Run: `rg -n "\.workflow/config\.json|\.flowpilot/config\.json" /home/zzz/桌面/2026开发/tools/FlowPilot/src`
Expected: every config path consumer is listed before editing.

**Step 2: Search progress path references**

Run: `rg -n "progress\.json|progress\.md" /home/zzz/桌面/2026开发/tools/FlowPilot/src`
Expected: `heartbeat.ts` is the only place still using `progress.json`.

**Step 3: Record exact files to modify**

Expected list:
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/domain/repository.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/hooks.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/verify.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.test.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.test.ts`
- `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts`
- Create: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.test.ts`

**Step 4: Commit inventory checkpoint**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/docs/plans/2026-03-07-persistent-evolution-and-recovery-design.md /home/zzz/桌面/2026开发/tools/FlowPilot/docs/plans/2026-03-07-persistent-evolution-and-recovery.md
git commit -m "docs: add persistent evolution recovery plans"
```

### Task 2: Write failing repository persistence tests

**Files:**
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.test.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/domain/repository.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`

**Step 1: Add a failing test for persistent config path**

Add test cases to `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.test.ts`:

```ts
it('saveConfig writes to .flowpilot/config.json', async () => {
  await repo.saveConfig({ maxRetries: 5 });
  const raw = await readFile(join(dir, '.flowpilot', 'config.json'), 'utf-8');
  expect(JSON.parse(raw)).toEqual({ maxRetries: 5 });
});

it('loadConfig migrates from .workflow/config.json when persistent config is missing', async () => {
  await mkdir(join(dir, '.workflow'), { recursive: true });
  await writeFile(join(dir, '.workflow', 'config.json'), JSON.stringify({ parallelLimit: 4 }), 'utf-8');

  const config = await repo.loadConfig();

  expect(config).toEqual({ parallelLimit: 4 });
  const migrated = JSON.parse(await readFile(join(dir, '.flowpilot', 'config.json'), 'utf-8'));
  expect(migrated).toEqual({ parallelLimit: 4 });
});

it('clearAll removes .workflow but keeps .flowpilot/config.json', async () => {
  await repo.saveConfig({ hints: ['keep this'] });
  await repo.saveProgress(makeData());

  await repo.clearAll();

  expect(await repo.loadProgress()).toBeNull();
  expect(await repo.loadConfig()).toEqual({ hints: ['keep this'] });
});
```

**Step 2: Run the repository test file and verify failure**

Run: `npm test -- --run src/infrastructure/fs-repository.test.ts`
Expected: FAIL because config still writes to `.workflow/config.json` and no migration exists.

**Step 3: Update repository contract comments first**

Change comments in `/home/zzz/桌面/2026开发/tools/FlowPilot/src/domain/repository.ts` to:

```ts
/** 加载 .flowpilot/config.json（必要时兼容迁移旧的 .workflow/config.json） */
loadConfig(): Promise<Record<string, unknown>>;
/** 保存 .flowpilot/config.json */
saveConfig(config: Record<string, unknown>): Promise<void>;
```

**Step 4: Implement the minimal repository persistence change**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`:

```ts
private readonly flowpilotDir: string;
private readonly persistentConfigPath: string;
private readonly legacyWorkflowConfigPath: string;

constructor(basePath: string) {
  this.base = basePath;
  this.root = join(basePath, '.workflow');
  this.flowpilotDir = join(basePath, '.flowpilot');
  this.persistentConfigPath = join(this.flowpilotDir, 'config.json');
  this.legacyWorkflowConfigPath = join(this.root, 'config.json');
  this.ctxDir = join(this.root, 'context');
  this.historyDir = join(basePath, '.flowpilot', 'history');
  this.evolutionDir = join(basePath, '.flowpilot', 'evolution');
}

async loadConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(this.persistentConfigPath, 'utf-8'));
  } catch {}

  try {
    const legacy = JSON.parse(await readFile(this.legacyWorkflowConfigPath, 'utf-8'));
    await this.ensure(this.flowpilotDir);
    await writeFile(this.persistentConfigPath, JSON.stringify(legacy, null, 2) + '\n', 'utf-8');
    return legacy;
  } catch {
    return {};
  }
}

async saveConfig(config: Record<string, unknown>): Promise<void> {
  await this.ensure(this.flowpilotDir);
  await writeFile(this.persistentConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
```

**Step 5: Update protocol template config lookup**

Change `loadProtocolTemplate()` in `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts` to read:

```ts
const config = JSON.parse(await readFile(join(basePath, '.flowpilot', 'config.json'), 'utf-8'));
```

and optionally fall back to the legacy `.workflow/config.json` if needed.

**Step 6: Re-run repository tests and verify pass**

Run: `npm test -- --run src/infrastructure/fs-repository.test.ts`
Expected: PASS.

**Step 7: Commit the repository persistence slice**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/src/domain/repository.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.test.ts
git commit -m "fix: persist FlowPilot config under .flowpilot"
```

### Task 3: Write failing evolution/history tests for the new config path

**Files:**
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.test.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.ts`

**Step 1: Change path assertions to `.flowpilot/config.json`**

Update existing tests in `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.test.ts`:

```ts
mkdirSync(join(base, '.flowpilot'), { recursive: true });
writeFileSync(join(base, '.flowpilot', 'config.json'), '{"maxRetries":2}');
...
const cfg = JSON.parse(readFileSync(join(base, '.flowpilot', 'config.json'), 'utf-8'));
```

**Step 2: Add a failing rollback test using the persistent config file**

```ts
it('review rolls back .flowpilot/config.json from snapshot when metrics regress', async () => {
  mkdirSync(join(base, '.flowpilot'), { recursive: true });
  writeFileSync(join(base, '.flowpilot', 'config.json'), '{"maxRetries":5}');

  const snapshotPath = join(base, '.flowpilot', 'evolution', 'snapshot-1.json');
  writeFileSync(snapshotPath, JSON.stringify({
    timestamp: '',
    files: { '.flowpilot/config.json': '{"maxRetries":2}' },
  }));

  ...

  const cfg = JSON.parse(readFileSync(join(base, '.flowpilot', 'config.json'), 'utf-8'));
  expect(cfg.maxRetries).toBe(2);
});
```

**Step 3: Run the history tests and verify failure**

Run: `npm test -- --run src/infrastructure/history.test.ts`
Expected: FAIL because `experiment()` and `review()` still read `.workflow/config.json` and snapshots use old keys.

**Step 4: Implement the minimal history path migration**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.ts` change these constants:

```ts
const configPath = join(basePath, '.flowpilot', 'config.json');
```

Update snapshot writing to:

```ts
const snapshotFile = await saveSnapshot(basePath, { '.flowpilot/config.json': configSnapshot });
```

Update rollback restore to:

```ts
if (snapshot.files['.flowpilot/config.json']) {
  await mkdir(join(basePath, '.flowpilot'), { recursive: true });
  await writeFile(configPath, snapshot.files['.flowpilot/config.json'], 'utf-8');
}
```

Keep a compatibility fallback during review:

```ts
const legacySnapshot = snapshot.files['config.json'];
const nextRaw = snapshot.files['.flowpilot/config.json'] ?? legacySnapshot;
```

**Step 5: Re-run history tests and verify pass**

Run: `npm test -- --run src/infrastructure/history.test.ts`
Expected: PASS.

**Step 6: Commit the history/evolution slice**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.test.ts
git commit -m "fix: keep evolution config after workflow cleanup"
```

### Task 4: Write failing heartbeat tests against the real progress source

**Files:**
- Create: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.test.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`

**Step 1: Add a failing heartbeat test file**

Create `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runHeartbeat } from './heartbeat';

describe('heartbeat', () => {
  it('reads active tasks from .workflow/progress.md', async () => {
    const base = mkdtempSync(join(tmpdir(), 'fp-heartbeat-'));
    mkdirSync(join(base, '.workflow'), { recursive: true });
    writeFileSync(join(base, '.workflow', 'progress.md'), `# demo\n\n状态: running\n当前: 001\n\n| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |\n|----|------|------|------|------|------|------|------|\n| 001 | Task A | backend | - | active | 0 | - | - |\n`);
    mkdirSync(join(base, '.flowpilot'), { recursive: true });
    writeFileSync(join(base, '.flowpilot', 'loop-window.json'), JSON.stringify([
      { taskId: '001', summary: 'waiting', timestamp: new Date(Date.now() - 31 * 60 * 1000).toISOString(), success: true }
    ]));

    const result = await runHeartbeat(base);
    expect(result.warnings.some(w => w.includes('[TIMEOUT]'))).toBe(true);
  });

  it('ignores missing progress file without throwing', async () => {
    const base = mkdtempSync(join(tmpdir(), 'fp-heartbeat-empty-'));
    const result = await runHeartbeat(base);
    expect(result.warnings).toEqual([]);
  });
});
```

**Step 2: Run the heartbeat tests and verify failure**

Run: `npm test -- --run src/infrastructure/heartbeat.test.ts`
Expected: FAIL because `runHeartbeat()` still reads `.workflow/progress.json`.

**Step 3: Extract a reusable progress markdown parser**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`, move the parser into an exported pure function:

```ts
export function parseProgressMarkdown(raw: string): ProgressData {
  ...
}
```

Then use it inside `loadProgress()`:

```ts
return parseProgressMarkdown(raw);
```

**Step 4: Point heartbeat to the real progress source**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.ts`:

```ts
import { parseProgressMarkdown } from './fs-repository';
...
const raw = await readFile(join(basePath, '.workflow', 'progress.md'), 'utf-8');
const data: ProgressData = parseProgressMarkdown(raw);
```

**Step 5: Re-run heartbeat tests and verify pass**

Run: `npm test -- --run src/infrastructure/heartbeat.test.ts`
Expected: PASS.

**Step 6: Re-run repository tests to verify parser extraction did not break round-trip**

Run: `npm test -- --run src/infrastructure/fs-repository.test.ts`
Expected: PASS.

**Step 7: Commit the heartbeat recovery slice**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.test.ts
git commit -m "fix: read workflow progress from progress.md"
```

### Task 5: Move remaining config consumers to `.flowpilot/config.json`

**Files:**
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/hooks.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/verify.ts`

**Step 1: Write a small failing verify-path assertion**

Add to `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts` or a dedicated infra test:

```ts
await repo.saveConfig({ verify: { commands: ['npm test'], timeout: 12 } });
expect(repo.verify().scripts).toContain('npm test');
```

If a dedicated infra test already exists, put it there instead of expanding service tests.

**Step 2: Change verify config loading path**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/verify.ts`:

```ts
const raw = readFileSync(join(cwd, '.flowpilot', 'config.json'), 'utf-8');
```

**Step 3: Change lifecycle hook loading path**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/hooks.ts`:

```ts
const configPath = join(basePath, '.flowpilot', 'config.json');
```

**Step 4: Run targeted tests**

Run: `npm test -- --run src/application/workflow-service.test.ts`
Expected: PASS for tests unrelated to observability changes.

**Step 5: Commit remaining config consumer updates**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/verify.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/hooks.ts
git commit -m "refactor: load persistent FlowPilot config consistently"
```

### Task 6: Write failing finish observability tests

**Files:**
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.ts`

**Step 1: Add a failing test for no experiment and no config change**

Add to `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts`:

```ts
it('finish summary reports reflect without experiment when no experiments are proposed', async () => {
  const repo = new FsWorkflowRepository(dir);
  mockChangedFiles(repo, []);
  mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
  vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
  svc = new WorkflowService(repo, parseTasksMarkdown);
  await completeWorkflow(svc);
  await svc.review();

  const historyModule = await import('../infrastructure/history');
  vi.spyOn(historyModule, 'reflect').mockResolvedValue({ timestamp: '', findings: [], experiments: [] });

  const msg = await svc.finish();
  expect(msg).toContain('进化摘要: reflect=1, experiment=0, configChanged=no');
  expect(msg).toContain('配置变更: 无');
});
```

**Step 2: Add a failing test for config key diff visibility**

```ts
it('finish summary lists changed config keys when experiment updates config', async () => {
  const repo = new FsWorkflowRepository(dir);
  mockChangedFiles(repo, []);
  mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
  vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
  svc = new WorkflowService(repo, parseTasksMarkdown);
  await completeWorkflow(svc);
  await svc.review();

  await repo.saveConfig({ maxRetries: 3 });

  const historyModule = await import('../infrastructure/history');
  vi.spyOn(historyModule, 'reflect').mockResolvedValue({
    timestamp: '',
    findings: ['retry hotspot'],
    experiments: [{ trigger: 't', observation: 'o', action: '设置 maxRetries 为 5', expected: 'e', target: 'config' }],
  });

  const msg = await svc.finish();
  expect(msg).toContain('进化摘要: reflect=1, experiment=1, configChanged=yes');
  expect(msg).toContain('配置变更: maxRetries');
});
```

**Step 3: Run the workflow service tests and verify failure**

Run: `npm test -- --run src/application/workflow-service.test.ts`
Expected: FAIL because `finish()` does not emit the new summary yet.

**Step 4: Implement a tiny config diff helper**

In `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.ts`, add:

```ts
private diffConfigKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}
```

**Step 5: Capture reflect/experiment execution and output summary**

Patch `finish()` to follow this order:

```ts
const configBeforeFinish = await this.repo.loadConfig();
const reflectReport = await reflect(wfStats, this.repo.projectRoot());
let experimentRan = 0;
if (reflectReport.experiments.length) {
  await experiment(reflectReport, this.repo.projectRoot());
  experimentRan = 1;
}
const configAfterFinish = await this.repo.loadConfig();
const changedKeys = this.diffConfigKeys(configBeforeFinish, configAfterFinish);
const evolutionSummary = `进化摘要: reflect=1, experiment=${experimentRan}, configChanged=${changedKeys.length ? 'yes' : 'no'}`;
const configSummary = `配置变更: ${changedKeys.length ? changedKeys.join(', ') : '无'}`;
```

Include `evolutionSummary` and `configSummary` in the final returned string before commit status text.

**Step 6: Keep the existing evolution log save behavior, but base it on persistent config**

Leave this behavior in place, but ensure the `configBefore` / `configAfter` snapshot compares `configBeforeFinish` and `configAfterFinish`, not a post-hoc guess from the last evolution entry.

**Step 7: Re-run workflow service tests and verify pass**

Run: `npm test -- --run src/application/workflow-service.test.ts`
Expected: PASS.

**Step 8: Commit the finish observability slice**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts
git commit -m "feat: show evolution changes in finish summary"
```

### Task 7: Run focused regression tests across all touched paths

**Files:**
- Test: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.test.ts`
- Test: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.test.ts`
- Test: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.test.ts`
- Test: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts`

**Step 1: Run the focused suite**

Run: `npm test -- --run src/infrastructure/fs-repository.test.ts src/infrastructure/history.test.ts src/infrastructure/heartbeat.test.ts src/application/workflow-service.test.ts`
Expected: PASS.

**Step 2: If one test fails, fix the implementation rather than weakening the assertion**

Check for these likely misses:
- old `.workflow/config.json` path still used somewhere
- snapshot restore still using `config.json` key only
- heartbeat parser and repository parser diverged
- `finish()` summary built from the wrong before/after config pair

**Step 3: Re-run the focused suite**

Run: `npm test -- --run src/infrastructure/fs-repository.test.ts src/infrastructure/history.test.ts src/infrastructure/heartbeat.test.ts src/application/workflow-service.test.ts`
Expected: PASS.

**Step 4: Commit the regression-safe state**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.test.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.test.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.test.ts /home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.test.ts
git commit -m "test: cover persistent evolution recovery flow"
```

### Task 8: Update docs that mention the old config path

**Files:**
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/README.md`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/README.en.md`
- Modify: `/home/zzz/桌面/2026开发/tools/FlowPilot/CLAUDE.md`

**Step 1: Replace outdated `.workflow/config.json` references**

Change wording to:

```md
进化结果写入 `.flowpilot/config.json`，被 maxRetries / parallelLimit / hints / verify / hooks 消费。
```

and in English:

```md
Evolution results are written to `.flowpilot/config.json` and consumed by maxRetries / parallelLimit / hints / verify / hooks.
```

**Step 2: Keep `.workflow/progress.md` and execution-state wording unchanged**

Do not move `progress.md` documentation out of `.workflow/`.

**Step 3: Run a quick search to verify no old config path remains in docs**

Run: `rg -n "\.workflow/config\.json" /home/zzz/桌面/2026开发/tools/FlowPilot/README.md /home/zzz/桌面/2026开发/tools/FlowPilot/README.en.md /home/zzz/桌面/2026开发/tools/FlowPilot/CLAUDE.md`
Expected: no matches.

**Step 4: Commit the docs alignment**

```bash
git add /home/zzz/桌面/2026开发/tools/FlowPilot/README.md /home/zzz/桌面/2026开发/tools/FlowPilot/README.en.md /home/zzz/桌面/2026开发/tools/FlowPilot/CLAUDE.md
git commit -m "docs: align persistent config path"
```

### Task 9: Final verification and handoff

**Files:**
- Verify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/application/workflow-service.ts`
- Verify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/fs-repository.ts`
- Verify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/history.ts`
- Verify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/heartbeat.ts`
- Verify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/hooks.ts`
- Verify: `/home/zzz/桌面/2026开发/tools/FlowPilot/src/infrastructure/verify.ts`

**Step 1: Run the targeted regression suite one last time**

Run: `npm test -- --run src/infrastructure/fs-repository.test.ts src/infrastructure/history.test.ts src/infrastructure/heartbeat.test.ts src/application/workflow-service.test.ts`
Expected: PASS.

**Step 2: Run the full test suite if the targeted suite is green**

Run: `npm test -- --run`
Expected: PASS, or only unrelated pre-existing failures.

**Step 3: Inspect the final diff**

Run: `git diff -- src/domain/repository.ts src/infrastructure/fs-repository.ts src/infrastructure/history.ts src/infrastructure/heartbeat.ts src/infrastructure/hooks.ts src/infrastructure/verify.ts src/application/workflow-service.ts src/infrastructure/fs-repository.test.ts src/infrastructure/history.test.ts src/infrastructure/heartbeat.test.ts src/application/workflow-service.test.ts README.md README.en.md CLAUDE.md`
Expected: only the agreed scope is changed.

**Step 4: Hand off with exact outcomes**

Report these outcomes explicitly:
- persistent config now survives `finish` / `clearAll`
- heartbeat now reads the real progress source
- `finish` summary shows reflect/experiment/config-changed status
- docs now distinguish `.workflow/` execution state from `.flowpilot/` persistent state
