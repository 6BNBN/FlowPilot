/**
 * @module infrastructure/truncation
 * @description CJK 感知 token 估算与智能截断
 */

import { fastDetectLanguage } from './memory';

/** 基于语言自动检测估算每 token 字符数：CJK ~1.5, Latin ~3.5 */
export function estimateCharsPerToken(text: string): number {
  return fastDetectLanguage(text) === 'cjk' ? 1.5 : 3.5;
}

/** 便捷 token 估算：text.length / charsPerToken */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / estimateCharsPerToken(text));
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
