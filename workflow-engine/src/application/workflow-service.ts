/**
 * @module application/workflow-service
 * @description 工作流应用服务 - 编排领域对象与基础设施，实现核心用例
 */

import { WorkflowId, Artifact, WorkflowStatus, StepId } from '../domain/types';
import { WorkflowDefinition, validateWorkflow } from '../domain/workflow';
import { WorkflowRuntime } from '../domain/runtime';
import { TaskNode, deriveTaskTree } from '../domain/task-tree';
import type { WorkflowRepository } from '../infrastructure/repository';

/** 工作流摘要信息 */
export interface WorkflowSummary {
  readonly name: string;
  readonly status: WorkflowStatus | 'draft';
}

/** 工作流完整状态 */
export interface WorkflowState {
  readonly definition: WorkflowDefinition;
  readonly runtime: WorkflowRuntime;
  readonly taskTree: TaskNode[];
}

/** 工作流应用服务 - 协调领域逻辑与持久化 */
export class WorkflowService {
  constructor(
    private readonly repo: WorkflowRepository,
    private readonly parse: (md: string) => WorkflowDefinition,
  ) {}

  /** 创建工作流：解析 Markdown 定义，校验后持久化 */
  async createWorkflow(name: string, content: string): Promise<string> {
    const def = this.parse(content);
    const errors = validateWorkflow(def);
    if (errors.length > 0) {
      throw new Error(`工作流校验失败:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }
    await this.repo.saveDefinition(name, content);
    return name;
  }

  /** 启动工作流：从定义创建运行时实例 */
  async startWorkflow(name: string): Promise<WorkflowRuntime> {
    const md = await this.repo.loadDefinitionRaw(name);
    const definition = this.parse(md);
    const runtime = new WorkflowRuntime(WorkflowId(name), definition);
    runtime.status = 'running';
    if (definition.steps.length > 0) {
      runtime.advance(definition.steps[0].id);
    }
    await this.repo.saveRuntime(name, runtime);
    await this.repo.setActive(name);
    return runtime;
  }

  /** 推进步骤：完成当前步骤并前进到下一步 */
  async advanceStep(
    name: string,
    notes?: string,
    artifacts?: Artifact[],
  ): Promise<WorkflowRuntime> {
    const runtime = await this.loadRuntime(name);
    const curDef = runtime.definition.steps.find(s => s.id === runtime.currentStepId);
    const isMolecular = curDef?.children && curDef.children.length > 0;
    if (isMolecular) {
      const subName = runtime.subWorkflows.get(curDef!.id);
      if (!subName) throw new Error(`分子节点 ${curDef!.id} 必须先 spawn 子工作流`);
      const subRt = await this.repo.loadRuntime(subName);
      if (!subRt || subRt.status !== 'completed') {
        throw new Error(`分子节点 ${curDef!.id} 的子工作流 ${subName} 尚未完成`);
      }
    }
    const cur = runtime.getCurrentStep();
    if (cur) {
      cur.status = 'done';
      cur.completedAt = new Date();
      if (notes) cur.notes = notes;
      if (artifacts) cur.artifacts.push(...artifacts);
    }
    const nextId = this.findNextStep(runtime);
    if (nextId) {
      runtime.advance(nextId);
    } else {
      runtime.status = 'completed';
    }
    await this.saveWithTree(name, runtime);
    return runtime;
  }

  /** 分支选择：在分支节点选择路径 */
  async branchStep(name: string, choice: string): Promise<WorkflowRuntime> {
    const runtime = await this.loadRuntime(name);
    const curStep = runtime.definition.steps.find(s => s.id === runtime.currentStepId);
    if (!curStep?.children) throw new Error('当前步骤不是分支节点');
    const selected = curStep.children.find(c => c.id === StepId(choice));
    if (!selected) throw new Error(`分支 ${choice} 不存在`);
    const skipped = curStep.children.filter(c => c.id !== selected.id).map(c => c.id);
    runtime.branch(selected.id, skipped);
    await this.saveWithTree(name, runtime);
    return runtime;
  }

  /** 工厂派生：在当前步骤生成子工作流并进入 */
  async spawnFactory(name: string, content: string): Promise<void> {
    const runtime = await this.loadRuntime(name);
    const subName = `${name}-sub-${Date.now()}`;
    if (runtime.currentStepId) {
      runtime.subWorkflows.set(runtime.currentStepId, subName);
      await this.repo.saveRuntime(name, runtime);
    }
    await this.repo.saveDefinition(subName, content);
    await this.repo.setActive(subName);
  }

  /** 返回父流程：完成子工作流并回到父级 */
  async returnFromSub(parentName: string): Promise<void> {
    await this.repo.setActive(parentName);
  }

  /** 获取状态：返回当前运行时状态与派生任务树 */
  async getStatus(name: string): Promise<WorkflowState> {
    const md = await this.repo.loadDefinitionRaw(name);
    const definition = this.parse(md);
    const runtime = await this.loadRuntime(name);
    const taskTree = deriveTaskTree(runtime);
    return { definition, runtime, taskTree };
  }

  /** 列出所有工作流及其状态摘要 */
  async listWorkflows(): Promise<WorkflowSummary[]> {
    const names = await this.repo.listWorkflows();
    const summaries: WorkflowSummary[] = [];
    for (const n of names) {
      const rt = await this.repo.loadRuntime(n);
      summaries.push({ name: n, status: rt?.status ?? 'draft' });
    }
    return summaries;
  }

  /** 获取当前活跃工作流名称 */
  async getActiveName(): Promise<string | null> {
    const ptr = await this.repo.getActive();
    return ptr.workflow;
  }

  /** 加载运行时，不存在则抛错 */
  private async loadRuntime(name: string): Promise<WorkflowRuntime> {
    const rt = await this.repo.loadRuntime(name);
    if (!rt) throw new Error(`工作流 ${name} 未启动`);
    return rt;
  }

  /** 查找下一个步骤 ID */
  private findNextStep(runtime: WorkflowRuntime): StepId | null {
    const steps = runtime.definition.steps;
    const curIdx = steps.findIndex(s => s.id === runtime.currentStepId);
    return curIdx >= 0 && curIdx + 1 < steps.length ? steps[curIdx + 1].id : null;
  }

  /** 保存运行时并同步派生任务树 */
  private async saveWithTree(name: string, runtime: WorkflowRuntime): Promise<void> {
    await this.repo.saveRuntime(name, runtime);
    const tree = deriveTaskTree(runtime);
    await this.repo.saveTaskTree(name, tree);
  }
}
