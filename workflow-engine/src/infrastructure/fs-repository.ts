/**
 * @module infrastructure/fs-repository
 * @description 文件系统工作流仓储实现 - 基于 .workflow/ 目录结构
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { WorkflowRuntime } from '../domain/runtime';
import { parseWorkflowMarkdown } from './markdown-parser';
import { ActivePointer, WorkflowRepository } from './repository';

/** 文件系统工作流仓储 */
export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;

  constructor(basePath: string) {
    this.root = join(basePath, '.workflow');
  }

  /** 确保目录存在 */
  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /** 获取工作流目录路径 */
  private flowDir(name: string): string {
    return join(this.root, 'flows', name);
  }

  async saveDefinition(name: string, markdown: string): Promise<void> {
    const dir = this.flowDir(name);
    await this.ensureDir(dir);
    await this.ensureDir(join(dir, 'artifacts'));
    await this.ensureDir(join(dir, 'children'));
    await writeFile(join(dir, 'definition.md'), markdown, 'utf-8');
  }

  async loadDefinitionRaw(name: string): Promise<string> {
    return readFile(join(this.flowDir(name), 'definition.md'), 'utf-8');
  }

  async deleteWorkflow(name: string): Promise<void> {
    await rm(this.flowDir(name), { recursive: true, force: true });
  }

  async listWorkflows(): Promise<string[]> {
    const dir = join(this.root, 'flows');
    await this.ensureDir(dir);
    return readdir(dir);
  }

  async saveRuntime(name: string, runtime: WorkflowRuntime): Promise<void> {
    await this.ensureDir(this.flowDir(name));
    const serializable = {
      id: runtime.id,
      status: runtime.status,
      currentStepId: runtime.currentStepId,
      stepStates: Object.fromEntries(runtime.stepStates),
      history: runtime.history,
      subWorkflows: Object.fromEntries(runtime.subWorkflows),
    };
    await writeFile(
      join(this.flowDir(name), 'runtime.json'),
      JSON.stringify(serializable, null, 2),
      'utf-8',
    );
  }

  async loadRuntime(name: string): Promise<WorkflowRuntime | null> {
    try {
      const raw = await readFile(join(this.flowDir(name), 'runtime.json'), 'utf-8');
      const data = JSON.parse(raw);
      const md = await readFile(join(this.flowDir(name), 'definition.md'), 'utf-8');
      const def = parseWorkflowMarkdown(md);
      return WorkflowRuntime.fromJSON(data, def);
    } catch {
      return null;
    }
  }

  async deleteRuntime(name: string): Promise<void> {
    await rm(join(this.flowDir(name), 'runtime.json'), { force: true });
  }

  async saveTaskTree(name: string, tree: unknown): Promise<void> {
    await this.ensureDir(this.flowDir(name));
    await writeFile(
      join(this.flowDir(name), 'tasks.json'),
      JSON.stringify(tree, null, 2),
      'utf-8',
    );
  }

  async getActive(): Promise<ActivePointer> {
    try {
      const raw = await readFile(join(this.root, 'active.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { workflow: null };
    }
  }

  async setActive(name: string | null): Promise<void> {
    await this.ensureDir(this.root);
    const pointer: ActivePointer = { workflow: name };
    await writeFile(
      join(this.root, 'active.json'),
      JSON.stringify(pointer, null, 2),
      'utf-8',
    );
  }
}
