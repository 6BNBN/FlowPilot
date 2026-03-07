# 排查：在其他项目单独运行 FlowPilot 导致 `.claude/` 与 Git 污染（删除文件“复活”）

> 目标读者：**在“其他项目”中复制 `flow.js` 并单独运行 FlowPilot 的使用者**。  
> 目标：解释现象与根因，给出立刻可执行的规避措施，并指明推荐的代码修复方向。

## 背景（为何会碰到）

FlowPilot 的典型用法是把构建产物 `flow.js` 复制到你的项目里，然后执行：

```bash
node flow.js init
```

这一步会让 FlowPilot 对你的项目做“接管/注入”（例如写入协议、注入 hooks），随后子 Agent 会按任务 checkpoint 并触发自动 git 提交。若这些注入/提交/清理策略缺少隔离边界，就可能出现 **`.claude/` 目录“突然出现”**、**误提交**、以及 **删除文件后又被恢复** 等问题。

---

## 1) 现象

### 现象 A：项目根目录出现 `.claude/`

- 运行 FlowPilot 后，项目根目录出现 `.claude/`（即使你原本项目没有）。
- `.claude/settings.json` 可能被修改（注入 hooks / env 等）。
- 如果你的仓库没有忽略该目录，它会出现在 `git status` 中，甚至被提交进历史。

### 现象 B：删除的文件“复活”

- 你在工作区**删除**了某些文件（例如 `rm file` / IDE 删除），看起来已经消失。
- 随后在某些阶段（恢复工作流、清理步骤、切换任务/分支、再次执行命令）文件又出现在工作区——像是被“还原/复活”。

---

## 2) 当前实现里的真实边界（源码层定位）

当前版本的关键点不再是“全量提交”或“自动 stash”，而是三套**显式边界**：dirty baseline、checkpoint ownership、setup-owned cleanup。

### 边界 A：`init()` 先记录 dirty baseline，再做 setup 注入

- **位置**：`src/application/workflow-service.ts` 的 `init()` 与 `src/infrastructure/runtime-state.ts` 的 `saveDirtyBaseline()`
- **行为**：工作流启动时会先记录当前已有脏文件，再执行 `ensureClaudeMd()`、`ensureHooks()`、`ensureLocalStateIgnored()`。
- **意义**：后续 `resume` / `finish` 可以区分：哪些脏文件是启动前就存在的，哪些是本轮 workflow 新产生的。

### 边界 B：checkpoint 只记录 `--files` ownership，不会偷偷扩大提交范围

- **位置**：`src/application/workflow-service.ts` 的 `checkpoint()` 与 `src/infrastructure/runtime-state.ts` 的 `recordOwnedFiles()`
- **行为**：checkpoint 会把 `--files` 持久化为 owned-file intent；若任务没有提供 `--files` 或这些文件没有可提交变更，输出会明确说明“未自动提交”。
- **意义**：最终提交只会信任 checkpoint 显式声明过归属的业务文件，而不是把整个工作区都算进来。

### 边界 C：`finish()` 先 cleanup，再做 ownership 校验，边界不安全就拒绝最终提交

- **位置**：`src/application/workflow-service.ts` 的 `resolveFinishCommitFiles()`
- **行为**：`finish()` 会先执行精确 cleanup，然后检查：
  - dirty baseline 是否存在
  - 当前新增脏文件是否都被 checkpoint `--files` 解释
  - `CLAUDE.md`、`.claude/settings.json`、`.gitignore` 在 cleanup 后是否仍有用户残留改动
- **意义**：verify 通过也不代表会最终提交；只要边界仍不安全，finish 就会 fail closed，明确列出原因和文件。

---

## 3) 风险 / 影响

- **边界解释错误**：如果不理解 dirty baseline，容易把“启动前就脏”的文件误认为是 FlowPilot 新写出来的。
- **遗漏 checkpoint ownership**：业务文件没有出现在任何任务的 `--files` 中时，finish 会拒绝最终提交，工作流停在 `finishing`。
- **setup-owned 文件残留用户改动**：`CLAUDE.md`、`.claude/settings.json`、`.gitignore` 在 cleanup 后仍然脏，会被视为风险边界，阻止最终提交。
- **协作成本上升**：团队成员若不知道 finish 的 fail-closed 语义，容易把“拒绝最终提交”误判成 verify 失败，增加排查时间。

---

## 4) 立刻可做的规避措施（基于当前实现）

下面是“无需改 FlowPilot 源码、立即见效”的做法，按优先级排列。

> 说明：当前版本已经不再依赖 `git add -A` 或自动 stash 整个工作区。下面的建议重点是帮助你理解 dirty baseline、ownership boundary、以及 finish 拒绝最终提交时该怎么处理。

### 4.1 先理解 ownership-based cleanup，不要把三类文件一概而论

FlowPilot 对 `CLAUDE.md`、`.claude/settings.json`、`.gitignore` 采用“谁创建/注入，谁负责 cleanup”的对称策略：

- **`CLAUDE.md`**：如果是 FlowPilot 在 setup/init 阶段新建，且文件内容仍只包含 FlowPilot scaffold / protocol block，finish 会自动删除；如果文件原本就存在，则只移除 FlowPilot 注入块，保留用户原文
- **`.claude/settings.json`**：如果是 FlowPilot 新建且 cleanup 后没有用户残留，会自动删除；如果原本存在，则回退到 baseline 快照，只移除 FlowPilot 注入的 hooks
- **`.gitignore`**：如果是 FlowPilot 仅为本地状态忽略规则而创建，且 cleanup 后仍只有这些 FlowPilot 注入规则，会自动删除；如果原本存在，则只移除这些 FlowPilot 注入规则

真正需要你处理的，是 cleanup 之后这些文件里**仍然存在的用户残留改动**。这种情况下 finish 会拒绝最终提交，并把文件列出来。

### 4.2 强制要求 checkpoint 使用 `--files`（只声明明确归属）

如果你的工作流/协议里允许子 Agent 自动提交，请**强制每次 checkpoint 都显式给出文件列表**，把 ownership boundary 收敛到“任务产物”。

示例：

```bash
echo "完成xxx [REMEMBER] ..." | node flow.js checkpoint 001 --files src/a.ts src/b.ts
```

当前实现里，如果没有 `--files`，任务 checkpoint 最多只会得到“未自动提交”的真实提示，不会偷偷扩大提交范围；但到了 `finish`，工作区里任何**未被 checkpoint 归属的新脏文件**，都会触发“拒绝最终提交”。

因此，最佳实践不是“让它猜”，而是：
- 每个任务都明确写出 `--files`
- 让 `CLAUDE.md` / `.claude/settings.json` / `.gitignore` 只由 setup/init ownership 管理，不要把它们混进普通业务任务的 `--files`
- 在 finish 拒绝时，先看它列出的未归属文件，再决定补 checkpoint、手动清理，还是保留到下一轮工作流

### 4.3 运行 FlowPilot 前，尽量让工作区可解释（dirty baseline 越清晰越好）

在目标项目中运行 FlowPilot 之前，先确认：

```bash
git status --porcelain
```

若有输出，并不意味着不能运行；当前实现会把这些文件记录为 **dirty baseline**。但你需要知道这会带来两个结果：
- `resume` 会把这些文件报告为“启动前已有的脏文件仍然保留”
- `finish` 只允许它们作为 baseline 存在，不会把它们自动并入最终提交

所以最稳妥的做法仍然是：
- 能先处理就先处理（提交 / 丢弃 / 你自己 stash）
- 如果必须带着脏工作区启动，也要知道这些文件之后不会自动变成本轮 workflow 的 owned files

### 4.4 如果 `finish` 因未归属脏文件而拒绝，怎么排查

当前更常见的问题，不是“stash 复活”，而是 `finish` 输出类似下面的拒绝信息：

```text
拒绝最终提交：检测到未归属给 workflow checkpoint 的脏文件。
- src/unowned.ts
```

处理顺序建议如下：

1. **先看文件属于哪一类**
   - 业务文件：通常说明某个任务漏写了 checkpoint `--files`
   - `CLAUDE.md` / `.claude/settings.json` / `.gitignore`：通常说明 cleanup 后还有用户残留改动
2. **再决定归属方式**
   - 属于本轮任务产物：在正确的任务 checkpoint 中补上 `--files`
   - 不属于本轮任务：手动还原、另开任务处理，或保留到下一轮 workflow
3. **重新执行 `node flow.js finish`**
   - 只要边界恢复可证明安全，finish 就会继续

如果输出是：

```text
拒绝最终提交：未找到 dirty baseline，无法证明工作流边界安全。
```

说明旧工作流缺失 `.workflow/dirty-baseline.json`。这种情况下应优先人工核对 `git status`，不要让 FlowPilot 猜哪些文件属于本轮工作流。

---

## 5) 当前实现的推荐操作习惯

在当前版本里，更推荐把注意力放在下面三条操作习惯上：

1. **checkpoint 永远带 `--files`**
   - 这决定了 finish 能否证明某个业务文件属于本轮 workflow
2. **把 setup-owned 文件和业务文件分开理解**
   - `CLAUDE.md`、`.claude/settings.json`、`.gitignore` 由 setup/init ownership 管理
   - 普通业务文件由各任务 checkpoint ownership 管理
3. **读懂 finish 的验证语义**
   - `验证通过 ... 请派子Agent执行 code-review ...` = verify 已通过，但还没进入允许最终提交的 `finishing` 状态
   - `验证结果: 未发现可执行的验证命令` = 仓库没有验证命令，不是失败
   - `- 跳过: ...（未找到测试文件）` = 命令执行成功，但没有实际测试内容
   - `拒绝最终提交: ...` = verify 已通过，但 ownership boundary 仍不安全

如果你的目标是继续改 FlowPilot 本体，下面这些模块仍然是关键入口。

### 5.1 `FlowPilot/src/infrastructure/git.ts`

- **修复提交边界**：`commitIn()` 必须只 `git add -- <files...>`，禁止默认 `git add -A`。
- **加入运行时产物过滤**：对 `.claude/`、`.workflow/`、`.flowpilot/` 等明确“工具运行时文件”做统一过滤，避免误 stage/误 commit。
- **禁用/收敛清理行为**：`gitCleanup()` 不应自动 stash 整个工作区；若必须做保护性操作，应改为：
  - 仅在“完全可控场景”执行（例如工作区已确认干净）
  - 或提供显式开关（默认关闭），并在输出中提示风险

### 5.2 `FlowPilot/src/infrastructure/fs-repository.ts`

- **限制 `ensureHooks()` 的写入策略**：
  - 默认不应修改目标项目的 `.claude/settings.json`（或至少需要显式确认/开关）
  - 更安全的方式是：把 FlowPilot 需要的规则放到它自己的目录（如 `.workflow/`）或通过运行参数注入，而不是写入用户项目的 `.claude/`
- **提供 “dry-run / no-inject” 模式**：允许用户在不注入 `.claude/` 的情况下运行（至少用于 CI/只读排查）。

### 5.3 `FlowPilot/src/application/workflow-service.ts`

- **强制提交时必须提供文件列表**：在 `checkpoint()` → `repo.commit(...)` 的链路上，可以做策略升级：
  - 若 checkpoint 未提供 `files`，则默认不自动提交（或者只提交白名单路径）
  - 把“`checkpoint --files`”作为协议强约束，减少误提交空间
- **把注入与提交拆开**：注入（CLAUDE/hook）和 git 提交属于不同风险级别的行为，应该有不同的开关与提示。

---

## 快速自查清单（建议复制执行）

```bash
# 1) 看当前工作区是否已有 baseline 脏文件
git status --porcelain

# 2) 看 FlowPilot 最终为什么拒绝（若已进入 finishing）
node flow.js finish

# 3) 若怀疑某个任务漏报 ownership，回看它的 checkpoint files
cat .workflow/owned-files.json

# 4) 若怀疑 setup-owned cleanup 后还有 residue，检查这三个文件
git diff -- CLAUDE.md .claude/settings.json .gitignore

# 5) 当前本地状态 ignore policy（FlowPilot 注入规则）
git diff -- .gitignore
```

