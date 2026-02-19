/**
 * @module interfaces/cli
 * @description CLI 命令路由
 */

import type { WorkflowService } from '../application/workflow-service';
import { formatStatus, formatTask } from './formatter';
import { readStdinIfPiped } from './stdin';

export class CLI {
  constructor(private readonly service: WorkflowService) {}

  async run(argv: string[]): Promise<void> {
    const args = argv.slice(2);
    try {
      const output = await this.dispatch(args);
      process.stdout.write(output + '\n');
    } catch (e) {
      process.stderr.write(`错误: ${e instanceof Error ? e.message : e}\n`);
      process.exitCode = 1;
    }
  }

  private async dispatch(args: string[]): Promise<string> {
    const [cmd, ...rest] = args;
    const s = this.service;

    switch (cmd) {
      case 'init': {
        const md = await readStdinIfPiped();
        if (md.trim()) {
          const data = await s.init(md);
          return `已初始化工作流: ${data.name} (${data.tasks.length} 个任务)\n协议已生成: .workflow/protocol.md`;
        }
        // 无stdin → 项目接管模式
        return await s.setup();
      }

      case 'next': {
        const result = await s.next();
        if (!result) return '全部完成';
        return formatTask(result.task, result.context);
      }

      case 'checkpoint': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        const detail = rest.length > 1
          ? rest.slice(1).join(' ')
          : await readStdinIfPiped();
        return await s.checkpoint(id, detail.trim());
      }

      case 'status': {
        const data = await s.status();
        if (!data) return '无活跃工作流';
        return formatStatus(data);
      }

      case 'finish':
        return await s.finish();

      case 'resume':
        return await s.resume();

      case 'add': {
        const title = rest.filter(r => r !== '--type')[0];
        if (!title) throw new Error('需要任务描述');
        const typeIdx = rest.indexOf('--type');
        const type = (typeIdx >= 0 && rest[typeIdx + 1]) || 'general';
        return await s.add(title, type as any);
      }

      default:
        return USAGE;
    }
  }
}

const USAGE = `用法: flow <command>
  init             初始化工作流 (stdin传入任务markdown)
  next             获取下一个待执行任务
  checkpoint <id>  记录任务完成 (stdin传入详细内容)
  finish           智能收尾 (验证+总结+回到待命)
  status           查看全局进度
  resume           中断恢复
  add <描述>       追加任务 [--type frontend|backend|general]`;
