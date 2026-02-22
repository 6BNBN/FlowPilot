import { describe, it, expect } from 'vitest';
import { parseTasksMarkdown } from './markdown-parser';

describe('parseTasksMarkdown', () => {
  it('解析名称和描述', () => {
    const md = '# 我的项目\n\n这是描述\n\n1. [backend] 任务一';
    const def = parseTasksMarkdown(md);
    expect(def.name).toBe('我的项目');
    expect(def.description).toBe('这是描述');
  });

  it('解析任务类型和标题', () => {
    const md = '# test\n\n1. [frontend] 创建页面\n2. [backend] 设计API\n3. [general] 写文档';
    const def = parseTasksMarkdown(md);
    expect(def.tasks).toHaveLength(3);
    expect(def.tasks[0]).toMatchObject({ title: '创建页面', type: 'frontend' });
    expect(def.tasks[1]).toMatchObject({ title: '设计API', type: 'backend' });
    expect(def.tasks[2]).toMatchObject({ title: '写文档', type: 'general' });
  });

  it('解析依赖关系', () => {
    const md = '# test\n\n1. [backend] A\n2. [frontend] B (deps: 1)\n3. [general] C (deps: 1,2)';
    const def = parseTasksMarkdown(md);
    expect(def.tasks[0].deps).toEqual([]);
    expect(def.tasks[1].deps).toEqual(['001']);
    expect(def.tasks[2].deps).toEqual(['001', '002']);
  });

  it('解析缩进描述', () => {
    const md = '# test\n\n1. [backend] 任务\n  详细描述第一行\n  详细描述第二行';
    const def = parseTasksMarkdown(md);
    expect(def.tasks[0].description).toBe('详细描述第一行\n详细描述第二行');
  });

  it('支持中文依赖关键字', () => {
    const md = '# test\n\n1. [backend] A\n2. [frontend] B (依赖: 1)';
    const def = parseTasksMarkdown(md);
    expect(def.tasks[1].deps).toEqual(['001']);
  });

  it('空输入返回空结构', () => {
    const def = parseTasksMarkdown('');
    expect(def.name).toBe('');
    expect(def.tasks).toEqual([]);
  });
});

describe('parseTasksMarkdown — OpenSpec 格式', () => {
  it('自动检测 OpenSpec checkbox 格式', () => {
    const md = '# 暗黑模式\n\n## 1. 基础设施\n\n- [ ] 1.1 创建主题配置\n- [ ] 1.2 添加CSS变量';
    const def = parseTasksMarkdown(md);
    expect(def.name).toBe('暗黑模式');
    expect(def.tasks).toHaveLength(2);
  });

  it('解析分组和自动依赖', () => {
    const md = [
      '# test',
      '',
      '## 1. 准备',
      '- [ ] 1.1 任务A',
      '- [ ] 1.2 任务B',
      '',
      '## 2. 实现',
      '- [ ] 2.1 任务C',
    ].join('\n');
    const def = parseTasksMarkdown(md);
    expect(def.tasks).toHaveLength(3);
    // 组1无依赖
    expect(def.tasks[0].deps).toEqual([]);
    expect(def.tasks[1].deps).toEqual([]);
    // 组2依赖组1全部任务
    expect(def.tasks[2].deps).toEqual(['001', '002']);
  });

  it('默认类型为 general', () => {
    const md = '# test\n\n## 1. G\n- [ ] 1.1 普通任务';
    const def = parseTasksMarkdown(md);
    expect(def.tasks[0].type).toBe('general');
  });

  it('支持可选 [type] 前缀', () => {
    const md = '# test\n\n## 1. G\n- [ ] 1.1 [frontend] 创建页面\n- [ ] 1.2 [backend] 设计API';
    const def = parseTasksMarkdown(md);
    expect(def.tasks[0]).toMatchObject({ title: '创建页面', type: 'frontend' });
    expect(def.tasks[1]).toMatchObject({ title: '设计API', type: 'backend' });
  });

  it('无 checkbox 时走原有 FlowPilot 解析', () => {
    const md = '# test\n\n1. [backend] 原生任务';
    const def = parseTasksMarkdown(md);
    expect(def.tasks[0]).toMatchObject({ title: '原生任务', type: 'backend' });
  });

  it('三组依赖链正确传递', () => {
    const md = [
      '# test',
      '## 1. A',
      '- [ ] 1.1 T1',
      '## 2. B',
      '- [ ] 2.1 T2',
      '## 3. C',
      '- [ ] 3.1 T3',
    ].join('\n');
    const def = parseTasksMarkdown(md);
    expect(def.tasks[0].deps).toEqual([]);       // 组1无依赖
    expect(def.tasks[1].deps).toEqual(['001']);   // 组2依赖组1
    expect(def.tasks[2].deps).toEqual(['002']);   // 组3依赖组2
  });
});
