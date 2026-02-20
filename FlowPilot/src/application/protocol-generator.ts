/**
 * @module application/protocol-generator
 * @description 生成调度协议文件 protocol.md
 */

/** 生成 protocol.md 内容 */
export function generateProtocol(projectName: string): string {
  return `# 调度协议 — 执行循环

重复直到返回"全部完成"：

1. \`node flow.js next --batch\` 获取可并行任务
2. 对每个任务用 Task 工具派发子Agent，prompt包含：
   - flow next 输出的「上下文」部分
   - 任务描述和类型
   - 以下checkpoint指令（原文复制给子Agent）：
     > 完成后执行：echo '一句话摘要' | node flow.js checkpoint <id>
     > 失败执行：node flow.js checkpoint <id> FAILED
     > 然后只回复"任务<id>已完成"，不要回复其他内容。
3. 所有子Agent返回后继续循环

全部完成时执行 \`node flow.js finish\` 收尾。
`;
}
