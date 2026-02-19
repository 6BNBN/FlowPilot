#!/usr/bin/env node
/**
 * @module main
 * @description 入口 - 依赖注入组装，启动 CLI
 */

import { FsWorkflowRepository } from './infrastructure/fs-repository';
import { parseTasksMarkdown } from './infrastructure/markdown-parser';
import { WorkflowService } from './application/workflow-service';
import { CLI } from './interfaces/cli';

const repo = new FsWorkflowRepository(process.cwd());
const service = new WorkflowService(repo, parseTasksMarkdown);
const cli = new CLI(service);

cli.run(process.argv);
