/**
 * @module infrastructure/embedding
 * @description Dense vector embedding 客户端 - 通用 OpenAI-compatible embedding API
 * 支持 Voyage AI / OpenAI / 任意兼容端点，无 API key 时返回 null 降级
 */

import { request } from 'https';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { log } from './logger';

const TIMEOUT_MS = 15_000;
const CACHE_FILE = 'embedding-cache.json';

/** SHA-256 缓存：text hash → vector */
interface EmbeddingCache {
  [hash: string]: number[];
}

let memCache: EmbeddingCache | null = null;

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cachePath(basePath: string): string {
  return join(basePath, '.flowpilot', CACHE_FILE);
}

async function loadEmbeddingCache(basePath: string): Promise<EmbeddingCache> {
  if (memCache) return memCache;
  try {
    memCache = JSON.parse(await readFile(cachePath(basePath), 'utf-8'));
    return memCache!;
  } catch {
    memCache = Object.create(null) as EmbeddingCache;
    return memCache;
  }
}

async function saveEmbeddingCache(basePath: string, cache: EmbeddingCache): Promise<void> {
  const p = cachePath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(cache), 'utf-8');
}

/** 获取 embedding 配置，无 key 返回 null */
function getConfig(): { url: URL; apiKey: string; model: string } | null {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;
  const rawUrl = process.env.EMBEDDING_API_URL || 'https://api.voyageai.com/v1/embeddings';
  const model = process.env.EMBEDDING_MODEL || 'voyage-3-lite';
  try {
    return { url: new URL(rawUrl), apiKey, model };
  } catch {
    return null;
  }
}

/** 调用 embedding API（OpenAI-compatible 格式） */
function callEmbeddingAPI(text: string, config: { url: URL; apiKey: string; model: string }): Promise<number[] | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ input: text, model: config.model });
    const req = request({
      hostname: config.url.hostname,
      port: config.url.port || undefined,
      path: config.url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) { resolve(null); return; }
          const json = JSON.parse(data);
          const embedding = json.data?.[0]?.embedding;
          resolve(Array.isArray(embedding) ? embedding : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/**
 * 获取文本的 dense embedding 向量
 * 无 API key 或调用失败时返回 null（降级信号）
 */
export async function embedText(text: string, basePath?: string): Promise<number[] | null> {
  const config = getConfig();
  if (!config) return null;

  const hash = sha256(text);

  // 检查缓存
  if (basePath) {
    const cache = await loadEmbeddingCache(basePath);
    if (cache[hash]) return cache[hash];
  }

  const vector = await callEmbeddingAPI(text, config);
  if (!vector) {
    log.debug('embedding: API 调用失败，降级');
    return null;
  }

  // 写入缓存
  if (basePath) {
    const cache = await loadEmbeddingCache(basePath);
    memCache = { ...cache, [hash]: vector };
    await saveEmbeddingCache(basePath, memCache);
  }

  log.debug(`embedding: 获取 ${vector.length} 维向量`);
  return vector;
}

const VISION_TIMEOUT_MS = 30_000;

/**
 * 调用 Claude Vision API 生成图片文本描述（<200字）
 * 无 API key 或失败时返回 null
 */
export async function describeImage(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: '用简短文本描述这张图片的内容，不超过200字。' },
        ],
      }],
    });

    const req = request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) { resolve(null); return; }
          const json = JSON.parse(data);
          const text = json.content?.[0]?.text;
          resolve(typeof text === 'string' ? text : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(VISION_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/** 清除内存缓存（用于测试） */
export function clearEmbeddingMemCache(): void {
  memCache = null;
}
