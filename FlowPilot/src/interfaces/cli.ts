/**
 * @module interfaces/cli
 * @description CLI 命令路由
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, relative, join } from 'path';
import type { WorkflowService } from '../application/workflow-service';
import { formatStatus, formatTask, formatBatch } from './formatter';
import { promptSetupClient, readStdinIfPiped } from './stdin';
import { enableVerbose } from '../infrastructure/logger';
import { checkForUpdate } from '../infrastructure/updater';
import type { SetupClient } from '../domain/types';

interface CliDeps {
  readStdinIfPiped?: typeof readStdinIfPiped;
  promptSetupClient?: () => Promise<SetupClient>;
}

export class CLI {
  constructor(
    private readonly service: WorkflowService,
    private readonly deps: CliDeps = {},
  ) {}

  async run(argv: string[]): Promise<void> {
    const args = argv.slice(2);
    // 全局 --verbose 标志
    const verboseIdx = args.indexOf('--verbose');
    if (verboseIdx >= 0) {
      enableVerbose();
      args.splice(verboseIdx, 1);
    }
    // 跳过更新检查的命令
    const cmd = args[0] || '';
    const noUpdateCheck = cmd === 'version' || cmd === 'help' || cmd === '-h' || cmd === '--help' || cmd === 'status' || cmd === 'recall';

    try {
      let output = await this.dispatch(args);
      
      // 检查更新（排除 version/help 命令）
      if (!noUpdateCheck) {
        const updateMsg = checkForUpdate();
        if (updateMsg) {
          output = output + ' ' + updateMsg;
        }
      }
      
      process.stdout.write(output + '\n');
    } catch (e) {
      process.stderr.write('错误: ' + (e instanceof Error ? e.message : e) + '\n');
      process.exitCode = 1;
    }
  }

  private async dispatch(args: string[]): Promise<string> {
    const [cmd, ...rest] = args;
    const s = this.service;

    // version 命令单独处理
    if (cmd === 'version') {
      const cwd = process.cwd();
      const flowPath = existsSync(join(cwd, 'flow.js')) 
        ? join(cwd, 'flow.js') 
        : join(cwd, 'dist', 'flow.js');
      let version = 'unknown';
      if (existsSync(flowPath)) {
        const content = readFileSync(flowPath, 'utf-8');
        const match = content.match(/\/\/ FLOWPILOT_VERSION:\s*(\d+\.\d+\.\d+)/);
        if (match) version = match[1];
      }
      return 'FlowPilot v' + version;
    }

    switch (cmd) {
      case 'init': {
        const force = rest.includes('--force');
        const md = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        let out;
        if (md.trim()) {
          const data = await s.init(md, force);
          out = '已初始化工作流: ' + data.name + ' (' + data.tasks.length + ' 个任务)';
        } else {
          const client = await (this.deps.promptSetupClient ?? promptSetupClient)();
          out = await s.setup(client);
        }
        return out + '\n\n提示: 建议先通过 /plugin 安装插件 superpowers、frontend-design、feature-dev、code-review、context7，未安装则子Agent无法使用专业技能，功能会降级';
      }

      case 'next': {
        if (rest.includes('--batch')) {
          const items = await s.nextBatch();
          if (!items.length) return '全部完成';
          return formatBatch(items);
        }
        const result = await s.next();
        if (!result) return '全部完成';
        return formatTask(result.task, result.context);
      }

      case 'checkpoint': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        const filesIdx = rest.indexOf('--files');
        const fileIdx = rest.indexOf('--file');
        let detail;
        let files;
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

      case 'adopt': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        const filesIdx = rest.indexOf('--files');
        const fileIdx = rest.indexOf('--file');
        let detail;
        let files;
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
        if (!data) return '无活跃工作流';
        return formatStatus(data);
      }

      case 'pulse': {
        const id = rest[0];
        if (!id) throw new Error('需要任务ID');
        // 解析 phase 参数
        let phase: string = 'analysis';
        const phaseIdx = rest.indexOf('--phase');
        if (phaseIdx >= 0 && rest[phaseIdx + 1]) {
          phase = rest[phaseIdx + 1];
        } else if (rest.length > 1 && !rest[1].startsWith('--')) {
          phase = rest[1];
        }
        // 中文别名映射
        const phaseMap: Record<string, string> = {
          '分析': 'analysis',
          '实施': 'implementation',
          '验证': 'verification',
          '阻塞': 'blocked',
        };
        const normalizedPhase = phaseMap[phase] || phase;
        const validPhases = ['analysis', 'implementation', 'verification', 'blocked'];
        if (!validPhases.includes(normalizedPhase)) {
          throw new Error(`无效的 phase: ${phase}，可选值: analysis, implementation, verification, blocked`);
        }
        // 解析 note 参数
        let note = '';
        const noteIdx = rest.indexOf('--note');
        if (noteIdx >= 0 && rest[noteIdx + 1]) {
          note = rest.slice(noteIdx + 1).join(' ');
        } else if (rest.length > 2 && !rest[2].startsWith('--')) {
          note = rest.slice(2).join(' ');
        }
        return await s.pulse(id, normalizedPhase as any, note);
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

const USAGE = '用法: node flow.js [--verbose] <command>\n  init [--force]       初始化工作流\n  next [--batch]       获取下一个待执行任务\n  checkpoint <id>      记录任务完成\n  adopt <id>           接管变更\n  restart <id>         任务重做\n  skip <id>            跳过任务\n  review               标记 review 完成\n  finish               收尾\n  status               查看进度\n  resume               恢复\n  abort                中止\n  rollback <id>        回滚\n  evolve               反思\n  recall <关键词>        记忆查询\n  add <描述>           追加任务\n  version              版本\n\n全局选项:\n  --verbose            调试日志';
