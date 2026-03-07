# Init/Setup Gitignore Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure `init` and `setup` automatically add `.claude/worktrees/` to the target project's `.gitignore` without overwriting existing content, without duplicating the rule, and without touching `.gitignore` in any other runtime phase.

**Architecture:** Add a focused repository helper on `WorkflowRepository`, implement it in `FsWorkflowRepository`, and call it from `WorkflowService.init()` and `WorkflowService.setup()` only. The helper creates `.gitignore` when missing, preserves all existing lines, appends the exact `.claude/worktrees/` rule once, and returns whether it changed the file.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest

---

## Before You Start

- Work from repo root: `/home/zzz/桌面/2026开发/tools/FlowPilot`
- Keep scope tight: no config system, no broader ignore rules, no unrelated refactors
- Prefer TDD exactly in this order: RED → GREEN → REFACTOR → focused validation
- Touch only these files unless a direct dependency forces otherwise:
  - `src/domain/repository.ts`
  - `src/infrastructure/fs-repository.ts`
  - `src/application/workflow-service.ts`
  - `src/infrastructure/fs-repository.test.ts`
  - `src/application/workflow-service.test.ts`

### Task 1: Add the shared `.gitignore` repository helper

**Files:**
- Modify: `src/domain/repository.ts`
- Modify: `src/infrastructure/fs-repository.ts`
- Test: `src/infrastructure/fs-repository.test.ts`

**Step 1: Write the failing repository tests**

Add these tests to `src/infrastructure/fs-repository.test.ts`:

```ts
it('ensureClaudeWorktreesIgnored creates .gitignore when missing', async () => {
  const changed = await repo.ensureClaudeWorktreesIgnored();

  expect(changed).toBe(true);
  expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('.claude/worktrees/\n');
});

it('ensureClaudeWorktreesIgnored appends the rule without overwriting existing content', async () => {
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');

  const changed = await repo.ensureClaudeWorktreesIgnored();

  expect(changed).toBe(true);
  expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
});

it('ensureClaudeWorktreesIgnored is idempotent and does not duplicate the rule', async () => {
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n.claude/worktrees/\n', 'utf-8');

  const changed = await repo.ensureClaudeWorktreesIgnored();

  expect(changed).toBe(false);
  expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
});

it('ensureClaudeWorktreesIgnored appends correctly when .gitignore has no trailing newline', async () => {
  await writeFile(join(dir, '.gitignore'), 'node_modules/', 'utf-8');

  const changed = await repo.ensureClaudeWorktreesIgnored();

  expect(changed).toBe(true);
  expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && npm test -- --run src/infrastructure/fs-repository.test.ts
```

Expected: FAIL with a TypeScript/runtime error such as `Property 'ensureClaudeWorktreesIgnored' does not exist`.

**Step 3: Write the minimal implementation**

Update `src/domain/repository.ts` to add the contract:

```ts
ensureClaudeWorktreesIgnored(): Promise<boolean>;
```

Then implement `src/infrastructure/fs-repository.ts` with minimal logic like this:

```ts
async ensureClaudeWorktreesIgnored(): Promise<boolean> {
  const path = join(this.base, '.gitignore');
  const rule = '.claude/worktrees/';

  try {
    const content = await readFile(path, 'utf-8');
    const hasRule = content
      .split(/\r?\n/)
      .some(line => line.trim() === rule);

    if (hasRule) return false;

    const nextContent = content.length === 0
      ? `${rule}\n`
      : `${content}${content.endsWith('\n') ? '' : '\n'}${rule}\n`;

    await writeFile(path, nextContent, 'utf-8');
    return true;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, `${rule}\n`, 'utf-8');
    return true;
  }
}
```

Keep this helper focused. Do not generalize it into a configurable ignore manager.

**Step 4: Run the test to verify it passes**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && npm test -- --run src/infrastructure/fs-repository.test.ts
```

Expected: PASS for the new `.gitignore` helper tests and the existing repository tests.

**Step 5: Commit**

```bash
git add src/domain/repository.ts src/infrastructure/fs-repository.ts src/infrastructure/fs-repository.test.ts
git commit -m "feat: ensure worktree gitignore rule during setup"
```

### Task 2: Wire the helper into `init()` and `setup()` only

**Files:**
- Modify: `src/application/workflow-service.ts`
- Test: `src/application/workflow-service.test.ts`

**Step 1: Write the failing service tests**

Add these tests to `src/application/workflow-service.test.ts`:

```ts
it('init appends .claude/worktrees/ to an existing .gitignore without overwriting content', async () => {
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');

  await svc.init(TASKS_MD);

  expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
});

it('setup creates .gitignore with the worktree rule when the file is missing', async () => {
  await svc.setup();

  expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('.claude/worktrees/\n');
});

it('runtime phases do not call ensureClaudeWorktreesIgnored', async () => {
  const repo = new FsWorkflowRepository(dir);
  const gitignoreSpy = vi.spyOn(repo, 'ensureClaudeWorktreesIgnored');
  svc = new WorkflowService(repo, parseTasksMarkdown);

  await svc.init(TASKS_MD);
  gitignoreSpy.mockClear();

  await svc.next();
  await svc.checkpoint('001', '表结构设计完成');
  await svc.resume();

  expect(gitignoreSpy).not.toHaveBeenCalled();
});
```

These tests intentionally cover both required entry points and the boundary that all other runtime phases must stay silent.

**Step 2: Run the test to verify it fails**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && npm test -- --run src/application/workflow-service.test.ts
```

Expected: FAIL because `init()` and `setup()` do not yet call the helper, so `.gitignore` is unchanged or missing.

**Step 3: Write the minimal implementation**

In `src/application/workflow-service.ts`, call the new helper in exactly two places.

Inside `init()` after the existing接管期 writes:

```ts
await this.repo.ensureClaudeMd();
await this.repo.ensureHooks();
await this.repo.ensureClaudeWorktreesIgnored();
```

Inside `setup()` after the existing接管期 writes:

```ts
const wrote = await this.repo.ensureClaudeMd();
await this.repo.ensureHooks();
await this.repo.ensureClaudeWorktreesIgnored();
```

Do not call this helper from `next()`, `nextBatch()`, `checkpoint()`, `resume()`, `finish()`, `abort()`, or cleanup code.

**Step 4: Run the test to verify it passes**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && npm test -- --run src/application/workflow-service.test.ts
```

Expected: PASS for the new `init()` / `setup()` behavior and the “runtime phases stay silent” regression.

**Step 5: Commit**

```bash
git add src/application/workflow-service.ts src/application/workflow-service.test.ts
git commit -m "feat: add worktree gitignore setup hooks"
```

### Task 3: Validate the narrow behavior end-to-end

**Files:**
- Verify: `src/domain/repository.ts`
- Verify: `src/infrastructure/fs-repository.ts`
- Verify: `src/application/workflow-service.ts`
- Verify: `src/infrastructure/fs-repository.test.ts`
- Verify: `src/application/workflow-service.test.ts`

**Step 1: Run the focused test files together**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && npm test -- --run src/infrastructure/fs-repository.test.ts src/application/workflow-service.test.ts
```

Expected: PASS.

**Step 2: Run the full test suite**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && npm test -- --run
```

Expected: PASS. If anything unrelated fails, stop and separate the unrelated failure from this feature before changing more code.

**Step 3: Inspect the final diff stays tight**

Run:

```bash
cd /home/zzz/桌面/2026开发/tools/FlowPilot && git diff -- src/domain/repository.ts src/infrastructure/fs-repository.ts src/application/workflow-service.ts src/infrastructure/fs-repository.test.ts src/application/workflow-service.test.ts
```

Expected: Only the helper contract, helper implementation, two service call sites, and their tests change.

**Step 4: Commit**

```bash
git add src/domain/repository.ts src/infrastructure/fs-repository.ts src/application/workflow-service.ts src/infrastructure/fs-repository.test.ts src/application/workflow-service.test.ts
git commit -m "feat: ensure worktree gitignore on init and setup"
```

## Done Criteria

The feature is complete only when all of these are true:

- `init()` creates or appends `.claude/worktrees/` in `.gitignore`
- `setup()` creates or appends `.claude/worktrees/` in `.gitignore`
- Existing `.gitignore` content is preserved exactly
- The rule is not duplicated on repeated runs
- Non-`init` / non-`setup` runtime phases do not touch `.gitignore`
- Only the narrow file set listed in this plan changes
- Focused tests and the full Vitest suite pass
