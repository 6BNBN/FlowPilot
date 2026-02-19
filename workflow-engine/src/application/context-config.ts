/**
 * @module application/context-config
 * @description 上下文注入配置 - 定义和加载 .workflow/context.json
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 上下文配置结构 */
export interface ContextConfig {
  readonly docs: readonly string[];
}

const CONFIG_PATH = '.workflow/context.json';

/** 加载配置，不存在则返回空 docs */
export async function loadContextConfig(basePath: string): Promise<ContextConfig> {
  try {
    const raw = await readFile(join(basePath, CONFIG_PATH), 'utf-8');
    return JSON.parse(raw) as ContextConfig;
  } catch {
    return { docs: [] };
  }
}

/** 扫描 docs/ 下所有 .md 文件，生成配置并写入 */
export async function generateContextConfig(basePath: string): Promise<ContextConfig> {
  const docsDir = join(basePath, 'docs');
  const files: string[] = [];
  try {
    await scanMd(docsDir, 'docs', files);
  } catch {
    // docs/ 不存在，返回空配置
  }
  files.sort();
  const config: ContextConfig = { docs: files };
  await writeFile(
    join(basePath, CONFIG_PATH),
    JSON.stringify(config, null, 2) + '\n',
    'utf-8',
  );
  return config;
}

/** 递归扫描目录下的 .md 文件 */
async function scanMd(dir: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const path = `${rel}/${e.name}`;
    if (e.isDirectory()) await scanMd(join(dir, e.name), path, out);
    else if (e.name.endsWith('.md')) out.push(path);
  }
}
