/**
 * @module infrastructure/extractor
 * @description 知识提取引擎 - 从 checkpoint summary 智能提取记忆条目
 */

/** 提取结果条目 */
export interface ExtractedEntry {
  content: string;
  source: string;
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

/** 统一提取入口：标记/决策优先，技术栈仅补充未覆盖的关键词 */
export function extractAll(text: string, source: string): ExtractedEntry[] {
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
