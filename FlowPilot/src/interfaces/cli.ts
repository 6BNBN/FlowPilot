/**
 * @module interfaces/cli
 * @description CLI 命令路由
 */

import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import type { WorkflowService } from '../application/workflow-service';
import { formatStatus, formatTask, formatBatch } from './formatter';
import { promptSetupClient, readStdinIfPiped } from './stdin';
import { enableVerbose } from '../infrastructure/logger';
import type { SetupClient, TaskPhase } from '../domain/types';

interface CliDeps {
  readStdinIfPiped?: typeof readStdinIfPiped;
  promptSetupClient?: () => Promise<SetupClient>;
}

function normalizePulsePhase(raw: string | undefined): TaskPhase {
  const value = (raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'analysis':
    case '分析':
      return 'analysis';
    case 'implementation':
    case '实现':
      return 'implementation';
    case 'verification':
    case '验证':
      return 'verification';
    case 'blocked':
    case '阻塞':
      return 'blocked';
    default:
      throw new Error('需要合法的阶段：analysis|implementation|verification|blocked');
  }
}

export class CLI {
  constructor(
    private readonly service: WorkflowService,
    private readonly deps: CliDeps = {},
  ) {}

  async run(argv: string[]): Promise<void> {
    const args = argv.slice(2);
    // 全局 --verbose 标志，在命令分发前提取
    const verboseIdx = args.indexOf('--verbose');
    if (verboseIdx >= 0) {
      enableVerbose();
      args.splice(verboseIdx, 1);
    }
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
        const force = rest.includes('--force');
        const md = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        let out: string;
        if (md.trim()) {
          const data = await s.init(md, force);
          out = `✅ 已初始化工作流: ${data.name} (${data.tasks.length} 个任务)`;
        } else {
          const client = await (this.deps.promptSetupClient ?? promptSetupClient)();
          out = await s.setup(client);
        }
        return `${out}\n\n**═══ 提示 ═══**\n💡 建议先通过 /plugin 安装插件: superpowers、frontend-design、feature-dev、code-review、context7\n   未安装时，子Agent无法使用专业技能，体验会降级\n   如需查看当前状态，可执行 \`node flow.js status\``;
      }

      case 'next': {
        if (rest.includes('--batch')) {
          const items = await s.nextBatch();
          if (!items.length) return '✅ 全部完成';
          return formatBatch(items);
        }
        const result = await s.next();
        if (!result) return '✅ 全部完成';
        return formatTask(result.task, result.context);
      }

      case 'checkpoint': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        const filesIdx = rest.indexOf('--files');
        const fileIdx = rest.indexOf('--file');
        let detail: string;
        let files: string[] | undefined;

        // 解析 --files（必须在解析detail之前，从rest中剥离）
        if (filesIdx >= 0) {
          files = [];
          for (let i = filesIdx + 1; i < rest.length && !rest[i].startsWith('--'); i++) {
            files.push(rest[i]);
          }
        }

        if (fileIdx >= 0 && rest[fileIdx + 1]) {
          const filePath = resolve(rest[fileIdx + 1]);
          if (relative(process.cwd(), filePath).startsWith('..')) throw new Error('--file 路径不能超出项目目录');
          detail = readFileSync(filePath, 'utf-8');
        } else if (rest.length > 1 && fileIdx < 0 && filesIdx < 0) {
          detail = rest.slice(1).join(' ');
        } else {
          detail = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        }
        return await s.checkpoint(id, detail.trim(), files);
      }

      case 'pulse': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        const phaseIdx = rest.indexOf('--phase');
        const noteIdx = rest.indexOf('--note');
        const phaseSource = phaseIdx >= 0 ? rest[phaseIdx + 1] : rest[1];
        const phase = normalizePulsePhase(phaseSource);
        let note = '';
        if (noteIdx >= 0) {
          note = rest.slice(noteIdx + 1).join(' ').trim();
        } else {
          const startIdx = phaseIdx >= 0 ? phaseIdx + 2 : 2;
          note = rest.slice(startIdx).join(' ').trim();
        }
        return await s.pulse(id, phase, note);
      }

      case 'adopt': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        const filesIdx = rest.indexOf('--files');
        const fileIdx = rest.indexOf('--file');
        let detail: string;
        let files: string[] | undefined;

        if (filesIdx >= 0) {
          files = [];
          for (let i = filesIdx + 1; i < rest.length && !rest[i].startsWith('--'); i++) {
            files.push(rest[i]);
          }
        }

        if (fileIdx >= 0 && rest[fileIdx + 1]) {
          const filePath = resolve(rest[fileIdx + 1]);
          if (relative(process.cwd(), filePath).startsWith('..')) throw new Error('--file 路径不能超出项目目录');
          detail = readFileSync(filePath, 'utf-8');
        } else if (rest.length > 1 && fileIdx < 0 && filesIdx < 0) {
          detail = rest.slice(1).join(' ');
        } else {
          detail = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        }
        return await s.adopt(id, detail.trim(), files);
      }

      case 'restart': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        return await s.restart(id);
      }

      case 'skip': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        return await s.skip(id);
      }

      case 'status': {
        const data = await s.status();
        if (!data) return '⏳ 无活跃工作流';
        return formatStatus(data);
      }

      case 'review':
        return await s.review();

      case 'finish':
        return await s.finish();

      case 'resume':
        return await s.resume();

      case 'abort':
        return await s.abort();

      case 'rollback': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        return await s.rollback(id);
      }

      case 'evolve': {
        const text = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        if (!text.trim()) throw new Error('需要通过 stdin 传入反思结果');
        return await s.evolve(text.trim());
      }

      case 'recall': {
        const query = rest.join(' ');
        if (!query) throw new Error('需要查询关键词');
        return await s.recall(query);
      }

      case 'add': {
        const typeIdx = rest.indexOf('--type');
        const rawType = (typeIdx >= 0 && rest[typeIdx + 1]) || 'general';
        const validTypes = new Set(['frontend', 'backend', 'general']);
        const type = validTypes.has(rawType) ? rawType : 'general';
        const title = rest.filter((_, i) => i !== typeIdx && i !== typeIdx + 1).join(' ');
        if (!title) throw new Error('需要任务描述');
        return await s.add(title, type as any);
      }

      default:
        return USAGE;
    }
  }
}

const USAGE = `**═══ FlowPilot 用法 ═══**
node flow.js [--verbose] <command>

📋 工作流命令:
  init [--force]       初始化工作流 (stdin传入任务markdown，无stdin则显示客户端选项)
  next [--batch]       获取下一批待执行任务 (--batch 返回所有可并行任务)
  checkpoint <id>      记录任务完成 [--file <path> | stdin | 内联文本] [--files f1 f2 ...]
  pulse <id> <phase>   记录任务阶段 [--phase <phase>] [--note <text>]
  adopt <id>           接管中断变更并补 checkpoint [--file <path> | stdin] [--files f1 f2 ...]
  restart <id>         确认变更后允许任务重做 (需先处理归属明确的变更)
  skip <id>            手动跳过任务
  review               标记 code-review 已完成 (finish 前必须执行)
  finish               智能收尾 (验证+总结+提交，需先 review)
  status               查看全局进度
  resume               中断恢复
  abort                中止工作流并清理 .workflow/ 目录
  rollback <id>        回滚到指定任务 (git revert + 重置后续任务)
  evolve               接收 AI 反思结果并执行进化 (stdin 传入)
  recall <关键词>       查询相关记忆
  add <描述>           追加任务 [--type frontend|backend|general]

⚙️ 全局选项:
  --verbose            输出调试日志 (等同 FLOWPILOT_VERBOSE=1)`;
