/**
 * @module application/context-service
 * @description 上下文注入服务 - 组装完整的 AI 上下文提示，用于状态注入
 */

import type { WorkflowService } from './workflow-service';
import type { ContextConfig } from './context-config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatTaskTree } from '../interfaces/formatter';

/** 上下文注入服务 - 将工作流状态组装为结构化提示文本 */
export class ContextService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly promptsDir: string,
    private readonly basePath: string,
    private readonly config: ContextConfig,
  ) {}

  /** 构建完整上下文：纪律 + 配置文档 + 工作流状态 + 活跃步骤 + 制品 */
  async buildContext(name: string): Promise<string> {
    const [protocol, ...docs] = await Promise.all([
      this.loadFile(join(this.promptsDir, 'iteration-protocol.md')),
      ...this.config.docs.map(p => this.loadFile(join(this.basePath, p))),
    ]);
    const state = await this.workflowService.getStatus(name);

    const { definition, runtime, taskTree } = state;
    const sections: string[] = [];

    sections.push('## 迭代纪律（强制）\n' + protocol);
    for (let i = 0; i < this.config.docs.length; i++) {
      sections.push(`## ${this.config.docs[i]}\n` + docs[i]);
    }

    const doneCount = [...runtime.stepStates.values()]
      .filter(s => s.status === 'done').length;
    sections.push(
      '## 工作流状态\n' +
      `- 名称: ${definition.name}\n` +
      `- 状态: ${runtime.status}\n` +
      `- 进度: ${doneCount}/${definition.steps.length}`,
    );

    const cur = runtime.getCurrentStep();
    if (runtime.currentStepId && cur) {
      const stepDef = definition.steps.find(s => s.id === runtime.currentStepId);
      sections.push(
        '## 当前活跃步骤\n' +
        `- ID: ${runtime.currentStepId}\n` +
        `- 名称: ${stepDef?.title ?? '(未知)'}\n` +
        `- 类型: ${stepDef?.type ?? 'sequence'}`,
      );
    }

    const allArtifacts = [...runtime.stepStates.values()]
      .flatMap(s => s.artifacts);
    if (allArtifacts.length > 0) {
      const list = allArtifacts.map(a => `- ${a.path}: ${a.description}`).join('\n');
      sections.push('## 近期制品\n' + list);
    }

    sections.push('## 任务树\n' + formatTaskTree(taskTree));

    return sections.join('\n\n');
  }

  /** 加载文件，找不到时返回占位文本 */
  private async loadFile(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return `（未找到 ${path}）`;
    }
  }
}
