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

describe('CLI pulse command', () => {
  it('parses pulse phase and note then forwards to service', async () => {
    const service = {
      pulse: vi.fn(async () => '已记录任务 001 阶段 analysis'),
    } as any;
    const cli = new CLI(service);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await cli.run(['node', 'flow.js', 'pulse', '001', '--phase', 'analysis', '--note', '正在读 README']);

    expect(service.pulse).toHaveBeenCalledWith('001', 'analysis', '正在读 README');
    expect(stdoutSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('accepts chinese phase aliases', async () => {
    const service = {
      pulse: vi.fn(async () => '已记录任务 001 阶段 blocked'),
    } as any;
    const cli = new CLI(service);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await cli.run(['node', 'flow.js', 'pulse', '001', '阻塞', '等待测试完成']);

    expect(service.pulse).toHaveBeenCalledWith('001', 'blocked', '等待测试完成');
    stdoutSpy.mockRestore();
  });
});
