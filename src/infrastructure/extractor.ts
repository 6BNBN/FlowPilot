/**
 * @module infrastructure/extractor
 * @description 知识提取引擎 - 从 checkpoint summary 智能提取记忆条目
 * 支持 LLM 智能提取（Extract→Decide）+ 规则引擎优雅降级
 */

import { request } from 'https';

/** 提取结果条目 */
export interface ExtractedEntry {
  content: string;
  source: string;
}

/** 调用 Claude API（零外部依赖，使用内置 https） */
async function callClaude(prompt: string, systemPrompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
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
          resolve(json.content?.[0]?.text ?? null);
        } catch { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/** 尝试从文本中解析 JSON 数组 */
function parseJsonArray(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* ignore */ }
    }
  }
  return null;
}

/** LLM 提取：从文本中提取关键事实（返回 JSON 数组） */
async function llmExtract(text: string): Promise<ExtractedEntry[] | null> {
  const system = `You are a knowledge extraction engine. Extract key facts, decisions, and technical insights from the given text. Return a JSON array of objects with "content" and "source" fields. Source should be one of: "decision", "architecture", "tech-stack", "insight". Only extract genuinely important information. Return [] if nothing worth remembering.`;

  const result = await callClaude(`Extract knowledge from:\n\n${text}`, system);
  if (!result) return null;

  const arr = parseJsonArray(result);
  return arr ? (arr as ExtractedEntry[]).filter(e => typeof e.content === 'string' && typeof e.source === 'string') : null;
}

/** LLM 决策：对比已有记忆，决定 ADD/UPDATE/SKIP */
async function llmDecide(
  newFacts: ExtractedEntry[],
  existingMemories: string[]
): Promise<ExtractedEntry[] | null> {
  if (!newFacts.length) return [];

  const system = `You are a memory deduplication engine. Given new facts and existing memories, decide which new facts to ADD (truly new), UPDATE (refines existing), or SKIP (already known). Return a JSON array of objects with "content", "source", and "action" fields. Action is "ADD", "UPDATE", or "SKIP". Only return ADD and UPDATE items.`;

  const prompt = `New facts:\n${JSON.stringify(newFacts)}\n\nExisting memories:\n${existingMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;

  const result = await callClaude(prompt, system);
  if (!result) return null;

  const arr = parseJsonArray(result);
  return arr ? (arr as Array<ExtractedEntry & { action?: string }>).filter(e => typeof e.content === 'string' && e.action !== 'SKIP') : null;
}

/** 提取 [REMEMBER]/[DECISION]/[ARCHITECTURE]/[IMPORTANT] 标记行 */
export function extractTaggedKnowledge(text: string, source: string): ExtractedEntry[] {
  const TAG_RE = /\[(?:REMEMBER|DECISION|ARCHITECTURE|IMPORTANT)\]\s*(.+)/gi;
  const results: ExtractedEntry[] = [];
  for (const line of text.split('\n')) {
    const m = TAG_RE.exec(line);
    if (m) results.push({ content: m[1].trim(), source });
    TAG_RE.lastIndex = 0;
  }
  return results;
}

/** 正则匹配中英文决策模式 */
export function extractDecisionPatterns(text: string, source: string): ExtractedEntry[] {
  const patterns = [
    /选择了(.+?)而非(.+)/g,
    /因为(.+?)所以(.+)/g,
    /决定使用(.+)/g,
    /放弃(.+?)改用(.+)/g,
    /chose\s+(.+?)\s+over\s+(.+)/gi,
    /decided\s+to\s+use\s+(.+)/gi,
    /switched\s+from\s+(.+?)\s+to\s+(.+)/gi,
  ];
  const results: ExtractedEntry[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const content = m[0].trim();
      if (!seen.has(content)) {
        seen.add(content);
        results.push({ content, source });
      }
    }
  }
  return results;
}

/** 匹配常见框架/库名 + 配置项模式 */
export function extractTechStack(text: string, source: string): ExtractedEntry[] {
  const TECH_NAMES = [
    'React', 'Vue', 'Angular', 'Svelte', 'Next\\.js', 'Nuxt',
    'Express', 'Fastify', 'Koa', 'NestJS', 'Hono',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite',
    'TypeScript', 'GraphQL', 'Prisma', 'Drizzle', 'Sequelize',
    'Tailwind', 'Vite', 'Webpack', 'esbuild', 'Rollup',
    'Docker', 'Kubernetes', 'Terraform', 'AWS', 'Vitest', 'Jest',
  ];
  const techRe = new RegExp(`\\b(${TECH_NAMES.join('|')})\\b`, 'gi');
  const configRe = /\b[\w-]+\.config\b|\.\w+rc\b/g;

  const results: ExtractedEntry[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(techRe)) {
    const name = m[1];
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      results.push({ content: `技术栈: ${name}`, source });
    }
  }
  for (const m of text.matchAll(configRe)) {
    const cfg = m[0];
    if (!seen.has(cfg.toLowerCase())) {
      seen.add(cfg.toLowerCase());
      results.push({ content: `配置项: ${cfg}`, source });
    }
  }
  return results;
}

/** 规则引擎提取（降级路径） */
function ruleExtract(text: string, source: string): ExtractedEntry[] {
  const tagged = extractTaggedKnowledge(text, source);
  const decisions = extractDecisionPatterns(text, source);
  const primary = [...tagged, ...decisions];
  const primaryText = primary.map(e => e.content).join(' ').toLowerCase();

  const tech = extractTechStack(text, source).filter(e => {
    const keyword = e.content.replace(/^(技术栈|配置项): /i, '').toLowerCase();
    return !primaryText.includes(keyword);
  });

  const seen = new Set<string>();
  return [...primary, ...tech].filter(e => {
    if (seen.has(e.content)) return false;
    seen.add(e.content);
    return true;
  });
}

/** 统一提取入口：有 LLM 用 LLM，否则降级到规则引擎 */
export async function extractAll(
  text: string,
  source: string,
  existingMemories?: string[]
): Promise<ExtractedEntry[]> {
  // 尝试 LLM 路径
  const llmResult = await llmExtract(text);
  if (llmResult !== null) {
    if (existingMemories?.length) {
      const decided = await llmDecide(llmResult, existingMemories);
      if (decided !== null) return decided;
    }
    return llmResult;
  }

  // 降级到规则引擎
  return ruleExtract(text, source);
}
