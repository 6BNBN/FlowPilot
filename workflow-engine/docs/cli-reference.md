# CLI 命令参考

## flow create

创建新工作流实例。

```bash
flow create <workflow.md> [--name <名称>]
```

- `workflow.md`：工作流定义文件路径
- `--name`：可选，实例名称

示例：`flow create ./审查流程.md --name "PR-123审查"`

## flow start

启动已创建的工作流实例。

```bash
flow start <instance-id>
```

示例：`flow start abc123`

## flow advance

推进当前步骤到下一步。

```bash
flow advance <instance-id> [--data <json>]
```

- `--data`：可选，传递给下一步的数据（JSON格式）

示例：`flow advance abc123 --data '{"结果":"通过"}'`

## flow branch

在分支步骤选择路径。

```bash
flow branch <instance-id> --choice <选项值>
```

示例：`flow branch abc123 --choice "成功"`

## flow spawn

手动触发子流程派生。

```bash
flow spawn <instance-id> --step <步骤号> --items <json数组>
```

示例：`flow spawn abc123 --step 5 --items '["模块A","模块B"]'`

## flow return

从子流程返回父流程。

```bash
flow return <child-instance-id> [--data <json>]
```

示例：`flow return child456 --data '{"状态":"完成"}'`

## flow status

查看工作流实例状态。

```bash
flow status <instance-id> [--format <text|json>]
```

- `--format`：输出格式，默认 `text`

示例：`flow status abc123 --format json`

## flow list

列出所有工作流实例。

```bash
flow list [--status <running|completed|failed>]
```

- `--status`：可选，按状态过滤

示例：`flow list --status running`

## flow edit

编辑工作流定义文件。

```bash
flow edit <workflow.md>
```

用默认编辑器打开工作流定义文件进行修改。

示例：`flow edit ./审查流程.md`
