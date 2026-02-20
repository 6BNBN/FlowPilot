1. [frontend] 添加前端idle检测（30分钟无操作自动登出）
   在kangjiamei-admin中添加用户空闲检测，30分钟无鼠标/键盘操作自动登出。检查现有实现，如不存在则添加idle timer composable。
2. [frontend] 添加PWA Service Worker支持
   kangjiamei-admin已有manifest.json但缺少service worker。添加SW注册和基础缓存策略，确保管理后台可安装到桌面。
3. [backend] 验证五星评价指标完整性（对比规格文档）
   读取3.最终敲定方案/中的评价相关文档，对比kangjiamei-api/internal/evaluation/中的代码，确认A类店长11项、B类店长7项、A类技师6项、B类技师4项指标全部覆盖，以及4类×5星级=20组阈值配置完整。缺失则补全。
4. [backend] 验证薪酬计算公式正确性（对比规格文档）
   读取3.最终敲定方案/中的薪酬相关文档，对比代码中的薪酬计算逻辑，确认A/B类店长和技师的薪酬公式与文档一致。缺失则补全。
5. [backend] 实现晋升与淘汰自动化机制 (deps: 3)
   实现：连续4季度5星→自动触发晋升流程；B类连续4季度5星→可申请转A类合伙人；1星淘汰/终止合作；2星观察期+强制培训标记；晋升/淘汰系统通知。在kangjiamei-api中添加promotion模块。
6. [backend] 实现拓客雷达功能
   在kangjiamei-api的wecom模块中实现：客户浏览/购物车行为实时推送给负责员工；去重窗口（同客户同商品30分钟内只推一次）；合并推送（短窗口多次浏览合并为摘要）；责任人路由（优先推staff_id，否则推门店负责人）。
7. [backend] 实现话术库功能
   在kangjiamei-api中添加话术库模块：话术分组管理CRUD、话术内容管理CRUD。在kangjiamei-admin中添加话术库管理页面。
8. [frontend] 实现话术库前端管理页面 (deps: 7)
   在kangjiamei-admin中添加话术库管理页面：分组列表、话术列表、新增/编辑/删除操作。参考现有页面风格。
9. [backend] 实现企微标签双向同步
   在kangjiamei-api的wecom模块中实现：企微侧标签变更回调→同步到本地客户标签；本地标签变更→同步到企微。添加webhook处理和同步逻辑。
10. [backend] 实现客户浏览轨迹推送
    在kangjiamei-api中实现客户浏览记录实时推送到企微的功能，与拓客雷达配合使用。添加浏览事件收集API和企微消息推送。
11. [frontend] 增强管理驾驶舱大屏
    增强kangjiamei-admin的dashboard/cockpit页面：添加营收趋势图、门店排行榜、转化漏斗图、预警面板。使用ECharts实现数据可视化。
12. [backend] 实现管理驾驶舱后端API (deps: 3, 4)
    在kangjiamei-api的report模块中添加驾驶舱所需的聚合API：营收趋势、门店排行、转化漏斗、预警数据。
13. [backend] 实现AI经营洞察功能
    在kangjiamei-ai中实现：自动分析数据异常并生成经营建议。添加analysis endpoint，调用LLM分析营收/客户/订单数据，输出结构化洞察。
14. [backend] 实现智能客服功能
    在kangjiamei-ai中实现面向C端的智能客服：回答客户常见问题、预约咨询。添加chat endpoint，使用knowledge base + LLM实现问答。
15. [backend] 实现AI跟进建议功能
    在kangjiamei-ai中实现：根据客户行为（浏览、购买、预约历史）自动推荐跟进策略。添加recommendation endpoint。
16. [general] 更新TODO验证清单 (deps: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
    根据所有任务完成情况，更新TODO-需求验证清单.md，将已验证/已实现的项目标记为完成。
