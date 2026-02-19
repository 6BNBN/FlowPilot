/**
 * @module domain/runtime
 * @description 工作流运行时聚合根 (DDD Aggregate Root - Runtime State)
 * 可变状态，跟踪工作流执行进度
 */

import { Artifact, StepId, StepStatus, WorkflowId, WorkflowStatus } from './types';
import { WorkflowDefinition } from './workflow';

/** 步骤运行时状态 - 实体 */
export interface StepState {
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  artifacts: Artifact[];
  notes: string;
}

/** 历史记录条目 - 值对象 */
export interface HistoryEntry {
  readonly stepId: StepId;
  readonly action: string;
  readonly timestamp: Date;
}

/** 工作流运行时 - 聚合根 */
export class WorkflowRuntime {
  readonly id: WorkflowId;
  readonly definition: WorkflowDefinition;
  status: WorkflowStatus = 'draft';
  currentStepId: StepId | null = null;
  readonly stepStates: Map<string, StepState> = new Map();
  readonly history: HistoryEntry[] = [];
  /** 步骤 → 子工作流名称的映射（分子节点必须 spawn 子工作流） */
  readonly subWorkflows: Map<string, string> = new Map();

  constructor(id: WorkflowId, definition: WorkflowDefinition) {
    this.id = id;
    this.definition = definition;
    for (const step of definition.steps) {
      this.stepStates.set(step.id, { status: 'pending', artifacts: [], notes: '' });
    }
  }

  /** 从序列化数据恢复运行时实例 */
  static fromJSON(data: Record<string, unknown>, definition: WorkflowDefinition): WorkflowRuntime {
    const rt = new WorkflowRuntime(data.id as WorkflowId, definition);
    rt.status = data.status as WorkflowStatus;
    rt.currentStepId = (data.currentStepId as StepId) ?? null;
    const states = data.stepStates as Record<string, StepState>;
    if (states) {
      for (const [k, v] of Object.entries(states)) {
        rt.stepStates.set(k, { ...v, artifacts: v.artifacts ?? [], notes: v.notes ?? '' });
      }
    }
    const subs = data.subWorkflows as Record<string, string> | undefined;
    if (subs) {
      for (const [k, v] of Object.entries(subs)) rt.subWorkflows.set(k, v);
    }
    return rt;
  }

  /** 获取当前步骤状态 */
  getCurrentStep(): StepState | null {
    return this.currentStepId ? this.stepStates.get(this.currentStepId) ?? null : null;
  }

  /** 判断是否可以推进到下一步 */
  canAdvance(): boolean {
    if (this.status !== 'running') return false;
    const current = this.getCurrentStep();
    return !current || current.status === 'done' || current.status === 'skipped';
  }

  /** 推进到指定步骤 */
  advance(nextStepId: StepId): void {
    if (!this.canAdvance()) throw new Error('当前状态不允许推进');
    const next = this.stepStates.get(nextStepId);
    if (!next) throw new Error(`步骤 ${nextStepId} 不存在`);
    this.currentStepId = nextStepId;
    next.status = 'active';
    next.startedAt = new Date();
    this.history.push({ stepId: nextStepId, action: 'advance', timestamp: new Date() });
  }

  /** 分支选择 - 激活指定子步骤，跳过其余 */
  branch(selectedId: StepId, skippedIds: StepId[]): void {
    for (const id of skippedIds) {
      const s = this.stepStates.get(id);
      if (s) s.status = 'skipped';
    }
    this.advance(selectedId);
  }

  /** 获取从当前位置可见的步骤 ID 列表（到下一个 loop/branch 为止） */
  getVisibleSteps(): StepId[] {
    const visible: StepId[] = [];
    let found = !this.currentStepId;
    for (const step of this.definition.steps) {
      if (step.id === this.currentStepId) found = true;
      if (!found) continue;
      if ((step.type === 'loop' || step.type === 'branch') && step.id !== this.currentStepId) break;
      visible.push(step.id);
    }
    return visible;
  }
}
