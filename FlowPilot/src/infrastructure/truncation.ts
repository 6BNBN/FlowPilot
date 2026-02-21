/**
 * @module infrastructure/truncation
 * @description CJK 感知 token 估算与智能截断
 */

/** 基于 CJK 比例估算每 token 字符数：CJK ~1.5, Latin ~3.5 */
export function estimateCharsPerToken(text: string): number {
  const sample = text.slice(0, 300);
  let cjk = 0;
  for (const ch of sample) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af)) cjk++;
  }
  const ratio = sample.length > 0 ? cjk / sample.length : 0;
  return 1.5 * ratio + 3.5 * (1 - ratio);
}

/** Head/Tail 截断：保留 head 70% + tail 20%，中间插入 [...truncated...] */
export function truncateHeadTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.floor(maxChars * 0.2);
  return `${text.slice(0, head)}\n\n[...truncated ${text.length - head - tail} chars...]\n\n${text.slice(-tail)}`;
}

/** 计算最大工具结果字符数：contextWindow × 0.3 × charsPerToken */
export function computeMaxChars(contextWindow = 128_000, sample?: string): number {
  const cpt = sample ? estimateCharsPerToken(sample) : 3.5;
  return Math.floor(contextWindow * 0.3 * cpt);
}
