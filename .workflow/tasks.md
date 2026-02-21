1. [backend] Reflect 反思引擎：LLM 分析工作流成败模式
   已完成。在 history.ts 新增 reflect() 函数，LLM+规则双路径分析。

2. [backend] Experiment 实验引擎：自动调整协议和配置 (deps: 1)
   在 history.ts 新增 experiment() 函数：基于 reflect 的 experiments 建议，自动修改 config.json 和 protocol.md 模板。每次修改前保存完整快照，记录到 .flowpilot/evolution/experiments.json。

3. [backend] Review 自愈引擎：验证实验效果 + 回滚 (deps: 2)
   在 history.ts 新增 review() 函数：init 时调用，对比上轮实验前后的工作流统计，指标恶化则自动回滚。检查 protocol.md 完整性、config.json 合法性。

4. [backend] 三阶段集成到工作流生命周期 (deps: 1, 2, 3)
   修改 workflow-service.ts：finish() 末尾调用 reflect() + experiment()，init() 开头调用 review()。

5. [general] 测试验证 + 构建 (deps: 4)
   为三阶段进化编写测试，运行 npm test + tsc + npm run build 确保全部通过。
