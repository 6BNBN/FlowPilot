#!/usr/bin/env node
/**
 * @module main
 * @description 入口 - 依赖注入组装，启动 CLI
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsWorkflowRepository } from './infrastructure/fs-repository';
import { parseWorkflowMarkdown } from './infrastructure/markdown-parser';
import { WorkflowService } from './application/workflow-service';
import { ContextService } from './application/context-service';
import { loadContextConfig, generateContextConfig } from './application/context-config';
import { CLI } from './interfaces/cli';

const basePath = process.cwd();
const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');

const config = await loadContextConfig(basePath);
const repo = new FsWorkflowRepository(basePath);
const workflowService = new WorkflowService(repo, parseWorkflowMarkdown);
const contextService = new ContextService(workflowService, promptsDir, basePath, config);
const cli = new CLI(workflowService, contextService, () => generateContextConfig(basePath));

cli.run(process.argv);
