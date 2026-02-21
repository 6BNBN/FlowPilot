import { describe, it, expect } from 'vitest';
import { makeTaskId, findNextTask, findParallelTasks, completeTask, failTask, resumeProgress, isAllDone } from './task-store';
import type { TaskEntry, ProgressData } from './types';

/** 快速创建任务 */
function t(id: string, status: TaskEntry['status'] = 'pending', deps: string[] = []): TaskEntry {
  return { id, title: `task-${id}`, description: '', type: 'general', status, deps, summary: '', retries: 0 };
}

function prog(tasks: TaskEntry[], status: ProgressData['status'] = 'running'): ProgressData {
  return { name: 'test', status, current: null, tasks };
}

describe('makeTaskId', () => {
  it('补零到三位', () => {
    expect(makeTaskId(1)).toBe('001');
    expect(makeTaskId(12)).toBe('012');
    expect(makeTaskId(100)).toBe('100');
  });
});

describe('findNextTask', () => {
  it('返回第一个无依赖的pending任务', () => {
    const tasks = [t('001', 'done'), t('002'), t('003')];
    expect(findNextTask(tasks)?.id).toBe('002');
  });

  it('依赖满足时返回任务', () => {
    const tasks = [t('001', 'done'), t('002', 'pending', ['001'])];
    expect(findNextTask(tasks)?.id).toBe('002');
  });

  it('依赖未满足时跳过', () => {
    const tasks = [t('001'), t('002', 'pending', ['001'])];
    expect(findNextTask(tasks)?.id).toBe('001');
  });

  it('全部完成返回null', () => {
    expect(findNextTask([t('001', 'done')])).toBeNull();
  });

  it('级联跳过：依赖failed的任务自动skipped', () => {
    const tasks = [t('001', 'failed'), t('002', 'pending', ['001']), t('003', 'pending', ['002'])];
    findNextTask(tasks);
    expect(tasks[1].status).toBe('skipped');
    expect(tasks[2].status).toBe('skipped');
  });
});

describe('findParallelTasks', () => {
  it('返回所有可并行任务', () => {
    const tasks = [t('001'), t('002'), t('003', 'pending', ['001'])];
    const result = findParallelTasks(tasks);
    expect(result.map(r => r.id)).toEqual(['001', '002']);
  });

  it('无可执行任务返回空数组', () => {
    expect(findParallelTasks([t('001', 'done')])).toEqual([]);
  });
});

describe('completeTask', () => {
  it('标记done并记录摘要', () => {
    const data = prog([t('001', 'active')]);
    data.current = '001';
    completeTask(data, '001', '完成了');
    expect(data.tasks[0].status).toBe('done');
    expect(data.tasks[0].summary).toBe('完成了');
    expect(data.current).toBeNull();
  });

  it('不存在的任务抛错', () => {
    expect(() => completeTask(prog([]), '999', '')).toThrow('不存在');
  });
});

describe('failTask', () => {
  it('前两次返回retry并重置pending', () => {
    const data = prog([t('001', 'active')]);
    expect(failTask(data, '001')).toBe('retry');
    expect(data.tasks[0].status).toBe('pending');
    expect(data.tasks[0].retries).toBe(1);

    expect(failTask(data, '001')).toBe('retry');
    expect(data.tasks[0].retries).toBe(2);
  });

  it('第三次返回skip并标记failed', () => {
    const data = prog([t('001', 'active')]);
    data.tasks[0].retries = 2;
    expect(failTask(data, '001')).toBe('skip');
    expect(data.tasks[0].status).toBe('failed');
  });
});

describe('resumeProgress', () => {
  it('重置active为pending', () => {
    const data = prog([t('001', 'active'), t('002', 'active'), t('003', 'done')]);
    const id = resumeProgress(data);
    expect(id).toBe('001');
    expect(data.tasks[0].status).toBe('pending');
    expect(data.tasks[1].status).toBe('pending');
    expect(data.tasks[2].status).toBe('done');
  });

  it('无active任务返回null', () => {
    const data = prog([t('001', 'done')]);
    expect(resumeProgress(data)).toBeNull();
  });
});

describe('isAllDone', () => {
  it('全部终态返回true', () => {
    expect(isAllDone([t('001', 'done'), t('002', 'skipped'), t('003', 'failed')])).toBe(true);
  });

  it('有pending返回false', () => {
    expect(isAllDone([t('001', 'done'), t('002')])).toBe(false);
  });
});
