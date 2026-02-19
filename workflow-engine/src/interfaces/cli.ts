/**
 * @module interfaces/cli
 * @description CLI 命令入口 - 解析 process.argv 并委托应用服务执行
 */

import type { WorkflowService } from '../application/workflow-service';
import type { ContextService } from '../application/context-service';
import { formatStatus, formatList, formatCapabilities } from './formatter';

/** 从标准输入读取全部内容 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

/** 解析 --key value 形式的选项 */
function parseOption(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** CLI 命令路由器 */
export class CLI {
  constructor(
    private readonly service: WorkflowService,
    private readonly context: ContextService,
    private readonly initContext?: () => Promise<{ docs: readonly string[] }>,
  ) {}

  async run(argv: string[]): Promise<void> {
    const args = argv.slice(2);
    try {
      const output = await this.dispatch(args);
      const cmd = args[0];
      const needsReminder = cmd && cmd !== 'status' && cmd !== 'caps';
      process.stdout.write(output + '\n');
      if (needsReminder) process.stdout.write('\n' + REMINDER + '\n');
    } catch (error) {
      process.stderr.write(`错误: ${error instanceof Error ? error.message : error}\n`);
      process.exitCode = 1;
    }
  }

  private async dispatch(args: string[]): Promise<string> {
    const [cmd, sub] = args;
    const s = this.service;

    switch (cmd) {
      case 'create': {
        if (!sub) throw new Error('需要工作流名称');
        await s.createWorkflow(sub, await readStdin());
        return `已创建工作流: ${sub}`;
      }
      case 'start': {
        if (!sub) throw new Error('需要工作流名称');
        const rt = await s.startWorkflow(sub);
        return `已启动: ${sub}\n当前步骤: ${rt.currentStepId}`;
      }
      case 'advance': {
        const name = await this.requireActive();
        const note = parseOption(args, '--note');
        const path = parseOption(args, '--artifact');
        const artifacts = path ? [{ path, description: '' }] : undefined;
        const rt = await s.advanceStep(name, note, artifacts);
        return `已推进到: ${rt.currentStepId ?? '(完成)'}`;
      }
      case 'branch': {
        if (!sub) throw new Error('需要分支选择');
        const name = await this.requireActive();
        const rt = await s.branchStep(name, sub);
        return `已选择分支: ${sub}\n当前步骤: ${rt.currentStepId}`;
      }
      case 'spawn': {
        const name = await this.requireActive();
        await s.spawnFactory(name, await readStdin());
        return '已派生子工作流';
      }
      case 'return': {
        if (!sub) throw new Error('需要父工作流名称');
        await s.returnFromSub(sub);
        return `已返回: ${sub}`;
      }
      case 'status': {
        const name = sub ?? await this.requireActive();
        const state = await s.getStatus(name);
        const ctx = await this.context.buildContext(name);
        return formatStatus(state) + '\n\n' + ctx;
      }
      case 'list':
        return formatList(await s.listWorkflows());
      case 'caps':
        return formatCapabilities();
      case 'edit': {
        if (!sub) throw new Error('需要工作流名称');
        await s.createWorkflow(sub, await readStdin());
        return `已更新工作流: ${sub}`;
      }
      case 'init-context': {
        if (!this.initContext) throw new Error('init-context 未配置');
        const cfg = await this.initContext();
        return `已生成 .workflow/context.json（${cfg.docs.length} 个文档）:\n${cfg.docs.map(d => `  - ${d}`).join('\n')}`;
      }
      default:
        return USAGE;
    }
  }

  /** 获取当前活跃工作流，不存在则报错 */
  private async requireActive(): Promise<string> {
    const name = await this.service.getActiveName();
    if (!name) throw new Error('无活跃工作流，请先 flow start <name>');
    return name;
  }
}

const REMINDER = `>>> 提醒: flow status 获取上下文 | flow advance --note "..." 记录产物 | 禁止跳步`;

const USAGE = `用法: flow <command>
  create <name>    创建工作流 (stdin 读取 markdown)
  start <name>     启动工作流
  advance          推进当前步骤 [--note "..."] [--artifact path]
  branch <choice>  选择分支路径
  spawn            派生子工作流 (stdin 读取 markdown)
  return <parent>  返回父工作流
  status [name]    查看当前状态与上下文注入
  list             列出所有工作流
  caps             列出原子能力清单
  edit <name>      更新工作流 (stdin 读取 markdown)
  init-context     扫描 docs/ 生成 .workflow/context.json`;
