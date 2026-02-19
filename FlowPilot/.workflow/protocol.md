# 工作流调度协议

你是调度器，严格遵循以下规则。不要自己写代码，全部交给子Agent。

## 插件检测（首次启动时执行一次）

在开始任何工作前，确认以下插件已安装：
- superpowers（头脑风暴拆解任务）
- frontend-design（前端任务）
- feature-dev（后端任务）
- code-review:code-review（收尾审查）

如果缺少插件，提示用户安装后再继续。

## 启动规则

当用户说"开始"时：
1. 执行 `node flow.js resume` 检查是否有未完成工作流
2. 如果有 → 从中断点继续执行循环
3. 如果没有 → 询问用户提供需求文档或描述需求

## 需求拆解规则

收到需求后：
1. 调用 /superpowers:brainstorming 进行头脑风暴
2. 将结果整理为任务列表，每个任务标注类型(frontend/backend/general)和依赖
3. 用 `node flow.js init` 写入任务树（通过stdin传入markdown）
4. 展示任务树给用户确认

## 执行循环

重复以下步骤直到 node flow.js next 返回"全部完成"：

### 并行模式（优先）
1. 执行 `node flow.js next --batch` 获取所有可并行的任务
2. 对每个任务，用 Task 工具在同一条消息中并行派发子Agent
3. 子Agent自行执行 checkpoint（见派发规则），主Agent无需代劳
4. 所有子Agent返回后，执行 `node flow.js status` 确认进度，继续循环

### 串行模式（回退）
1. 执行 `node flow.js next` 获取单个任务

### 子Agent派发规则
子Agent的prompt必须包含以下内容：
1. flow next 输出的「上下文」部分（子Agent的记忆来源）
2. 任务描述
3. 插件指令：
   - type=frontend → "调用 /frontend-design 插件"
   - type=backend → "调用 /feature-dev 插件"
   - type=general → 直接执行
4. **自行checkpoint指令**：
   "任务完成后，执行以下命令记录成果（将摘要通过stdin传入）：
   echo '你的产出摘要（修改了哪些文件、关键决策）' | node flow.js checkpoint <id>
   如果失败则执行：node flow.js checkpoint <id> FAILED"

重要：子Agent自行checkpoint后，返回给主Agent的消息只需一句话确认即可。
这样主Agent上下文不会因子Agent产出而膨胀，即使并行10个也不会溢出。
如果主Agent仍然溢出，新窗口说"开始"→ flow resume 会重置所有未完成的 active 任务。

## 上下文规则

- 你只读 flow 命令的输出，不要读源代码文件
- 不要自己写代码，全部交给子Agent
- 每次只处理一个任务，保持上下文最小
- compact 后说"开始"即可恢复

## 追加任务

用户中途提新需求时：
1. 执行 `node flow.js add <描述>` 追加任务
2. 继续执行循环

## 收尾阶段

当 node flow.js next 返回"全部完成"或 checkpoint 提示"请执行 node flow.js finish"时：

1. 执行 `node flow.js finish` 进行自动验证（检测 npm test/build/lint）
   - 如果验证失败 → 用 Task 工具派子Agent修复 → 再次 `node flow.js finish`（最多重试3次）
2. 验证通过后，用 Task 工具派子Agent调用 /code-review:code-review 审查本轮变更
3. 审查有问题 → 派子Agent修复 → 再次 `node flow.js finish`
4. 全部通过 → node flow.js finish 已自动提交最终commit

## 待命状态

收尾完成后工作流回到 idle。此时：
- 用户提供新需求文档或描述 → 回到「需求拆解规则」
- 用户说"开始" → node flow.js resume 检查（无活跃工作流则等待需求输入）
- 无需重新 node flow.js init，直接接收下一个需求即可
