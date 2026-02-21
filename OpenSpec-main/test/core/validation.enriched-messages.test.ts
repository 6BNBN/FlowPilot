import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { Validator } from '../../src/core/validation/validator.js';

describe('Validator enriched messages', () => {
  const testDir = path.join(process.cwd(), 'test-validation-enriched-tmp');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('adds guidance for no deltas in change', async () => {
    const changeContent = `# Test Change

## Why
This is a sufficiently long explanation to pass the why length requirement for validation purposes.

## What Changes
There are changes proposed, but no delta specs provided yet.`;
    const changePath = path.join(testDir, 'proposal.md');
    await fs.writeFile(changePath, changeContent);

    const validator = new Validator();
    const report = await validator.validateChange(changePath);
    expect(report.valid).toBe(false);
    const msg = report.issues.map(i => i.message).join('\n');
    expect(msg).toContain('Change must have at least one delta');
    expect(msg).toContain('Ensure your change has a specs/ directory');
    expect(msg).toContain('## ADDED/MODIFIED/REMOVED/RENAMED Requirements');
  });

  it('adds guidance when spec missing Purpose/Requirements', async () => {
    const specContent = `# Test Spec\n\n## Requirements\n\n### Requirement: Foo\nFoo SHALL ...\n\n#### Scenario: Bar\nWhen...`;
    const specPath = path.join(testDir, 'spec.md');
    await fs.writeFile(specPath, specContent);

    const validator = new Validator();
    const report = await validator.validateSpec(specPath);
    expect(report.valid).toBe(false);
    const msg = report.issues.map(i => i.message).join('\n');
    expect(msg).toContain('Spec must have a Purpose section');
    expect(msg).toContain('Expected headers: "## Purpose" and "## Requirements"');
  });

  it('warns with scenario conversion template when missing scenarios', async () => {
    const specContent = `# Test Spec

## Purpose
This is a sufficiently long purpose section to avoid warnings about brevity.

## Requirements

### Requirement: Foo SHALL be described
Text of requirement
`;
    const specPath = path.join(testDir, 'spec.md');
    await fs.writeFile(specPath, specContent);

    const validator = new Validator();
    const report = await validator.validateSpec(specPath);
    expect(report.valid).toBe(false);
    const warn = report.issues.find(i => i.path.includes('requirements[0].scenarios'));
    expect(warn?.message).toContain('Requirement must have at least one scenario');
    expect(warn?.message).toContain('Scenarios must use level-4 headers');
    expect(warn?.message).toContain('#### Scenario:');
  });
});


