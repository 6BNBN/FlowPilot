# 智能收尾与需求过渡设计

> **实现状态：已完成**

## 概述

工作流完成所有任务后，自动执行收尾（验证+审查+提交），然后回到待命状态接新需求。

## 状态机

`idle → running → finishing → idle`

- `finishing`: 所有开发任务完成，正在收尾验证
- 收尾完成后回到 `idle`，待命接新需求
- 验证失败保持 `finishing`，修复后重试

## flow finish 实现

1. 检查 `isAllDone` → 状态改 `finishing`
2. 自动检测项目类型并执行验证（支持7种语言/构建系统）：
   - Node.js: npm run build/test/lint
   - Rust: cargo build/test
   - Go: go build/test
   - Python: pytest/ruff/mypy
   - Java: mvn/gradle
   - C/C++: cmake/ctest
   - Makefile: make build/test/lint
3. 验证通过 → 生成变更总结（含完成/跳过/失败项汇报）+ 最终git commit + 状态改 `idle`
4. 验证失败 → 返回错误，状态保持 `finishing`，主Agent派子Agent修复后重试

## 协议中的收尾规则

- flow next 返回"全部完成" → 执行 flow finish
- 失败 → 用 Task 工具派子Agent修复 → 重试（最多3次）
- 通过 → 用 Task 工具派子Agent做 /code-review:code-review
- 审查有问题 → 派子Agent修复 → 再次 finish
- 全部通过 → 自动提交最终commit → 回到待命

## 主Agent完整循环

等待需求 → brainstorming → init → next/checkpoint循环 → finish收尾 → 等待需求
