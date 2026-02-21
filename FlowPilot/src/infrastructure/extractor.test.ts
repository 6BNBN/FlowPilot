import { describe, it, expect } from 'vitest';
import { extractTaggedKnowledge, extractDecisionPatterns, extractTechStack, extractAll } from './extractor';

describe('extractTaggedKnowledge', () => {
  it('extracts [REMEMBER] tagged lines', () => {
    const text = 'some text\n[REMEMBER] Use PostgreSQL for storage\nother';
    const results = extractTaggedKnowledge(text, 'task-001');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Use PostgreSQL for storage');
    expect(results[0].source).toBe('task-001');
  });

  it('extracts [DECISION] tagged lines', () => {
    const results = extractTaggedKnowledge('[DECISION] chose REST over GraphQL', 'task-002');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('chose REST over GraphQL');
  });

  it('extracts [ARCHITECTURE] and [IMPORTANT] tags', () => {
    const text = '[ARCHITECTURE] microservices\n[IMPORTANT] no shared DB';
    const results = extractTaggedKnowledge(text, 's');
    expect(results).toHaveLength(2);
  });

  it('returns empty for no tags', () => {
    expect(extractTaggedKnowledge('plain text', 's')).toEqual([]);
  });
});

describe('extractDecisionPatterns', () => {
  it('matches Chinese decision patterns', () => {
    const r1 = extractDecisionPatterns('选择了REST而非GraphQL', 's');
    expect(r1.length).toBeGreaterThanOrEqual(1);

    const r2 = extractDecisionPatterns('决定使用PostgreSQL', 's');
    expect(r2.length).toBeGreaterThanOrEqual(1);

    const r3 = extractDecisionPatterns('放弃MySQL改用PostgreSQL', 's');
    expect(r3.length).toBeGreaterThanOrEqual(1);
  });

  it('matches English decision patterns', () => {
    const r1 = extractDecisionPatterns('chose REST over GraphQL', 's');
    expect(r1.length).toBeGreaterThanOrEqual(1);

    const r2 = extractDecisionPatterns('decided to use PostgreSQL', 's');
    expect(r2.length).toBeGreaterThanOrEqual(1);

    const r3 = extractDecisionPatterns('switched from MySQL to PostgreSQL', 's');
    expect(r3.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates identical matches', () => {
    const text = '选择了A而非B\n选择了A而非B';
    const results = extractDecisionPatterns(text, 's');
    expect(results).toHaveLength(1);
  });

  it('returns empty for no patterns', () => {
    expect(extractDecisionPatterns('plain text here', 's')).toEqual([]);
  });
});

describe('extractTechStack', () => {
  it('extracts framework names', () => {
    const results = extractTechStack('We use React and PostgreSQL', 's');
    expect(results.some(r => r.content.includes('React'))).toBe(true);
    expect(results.some(r => r.content.includes('PostgreSQL'))).toBe(true);
  });

  it('extracts config file patterns', () => {
    const results = extractTechStack('check vite.config and .eslintrc', 's');
    expect(results.some(r => r.content.includes('vite.config'))).toBe(true);
    expect(results.some(r => r.content.includes('.eslintrc'))).toBe(true);
  });

  it('deduplicates case-insensitive', () => {
    const results = extractTechStack('react React REACT', 's');
    expect(results).toHaveLength(1);
  });
});

describe('extractAll', () => {
  it('combines tagged + decisions + tech, deduplicates', () => {
    const text = '[REMEMBER] Use React for frontend\n决定使用PostgreSQL\nWe also use Docker';
    const results = extractAll(text, 's');
    // tagged: React line, decision: PostgreSQL line, tech: Docker (React already covered)
    expect(results.length).toBeGreaterThanOrEqual(2);
    // No duplicate content
    const contents = results.map(r => r.content);
    expect(new Set(contents).size).toBe(contents.length);
  });

  it('tech stack filtered if already in tagged/decisions', () => {
    const text = '[REMEMBER] Use React component pattern';
    const results = extractAll(text, 's');
    // React is in tagged content, so tech stack should not add it again
    expect(results.filter(r => r.content.includes('React'))).toHaveLength(1);
  });
});
