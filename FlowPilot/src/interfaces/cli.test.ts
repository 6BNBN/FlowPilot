import { describe, expect, it, vi } from 'vitest';
import { CLI } from './cli';
import { resolveSetupClientChoice } from './stdin';

describe('resolveSetupClientChoice', () => {
  it('maps numbered options and defaults to other', () => {
    expect(resolveSetupClientChoice('1')).toBe('claude');
    expect(resolveSetupClientChoice('2')).toBe('codex');
    expect(resolveSetupClientChoice('3')).toBe('cursor');
    expect(resolveSetupClientChoice('4')).toBe('snow-cli');
    expect(resolveSetupClientChoice('')).toBe('other');
    expect(resolveSetupClientChoice('9')).toBe('other');
  });
});

describe('CLI init setup mode', () => {
  it('uses setup client selector when init runs without piped tasks', async () => {
    const service = {
      setup: vi.fn(async () => '项目已接管，工作流工具就绪'),
    } as any;
    const cli = new CLI(service, {
      readStdinIfPiped: async () => '',
      promptSetupClient: async () => 'snow-cli',
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await cli.run(['node', 'flow.js', 'init']);

    expect(service.setup).toHaveBeenCalledWith('snow-cli');
    expect(stdoutSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});
