# 智能收尾与需求过渡设计

## 概述

工作流完成所有任务后，自动执行收尾（验证+审查+提交），然后回到待命状态接新需求。

## 状态机扩展

`idle → running → finishing → idle`

- `finishing`: 所有开发任务完成，正在收尾验证
- 收尾完成后回到 `idle`，待命接新需求

## 新增命令: flow finish

1. 检查 `isAllDone` → 状态改 `finishing`
2. 读 package.json scripts，按优先级执行 test → build → lint
3. 验证通过 → 生成变更总结 + 最终git commit + 状态改 `idle`
4. 验证失败 → 返回错误，状态保持 `finishing`，主Agent派子Agent修复后重试

## 协议增强

protocol.md 新增收尾阶段规则：
- flow next 返回"全部完成" → 执行 flow finish
- 失败 → 派子Agent修复 → 重试（最多3次）
- 通过 → 代码审查 → 输出总结 → 等待下一个需求

## 主Agent完整循环

等待需求 → brainstorming → init → next/checkpoint循环 → finish收尾 → 等待需求
