/**
 * @module domain/capabilities
 * @description 原子能力清单 - 定义 AI 代理可执行的所有原子操作
 * 工作流叶子节点必须引用此清单中的操作，否则拒绝执行
 */

/** 原子能力定义 */
export interface Capability {
  /** 唯一标识 */
  readonly name: string;
  /** 中文描述 */
  readonly description: string;
  /** 是否有副作用（修改文件系统、网络请求等） */
  readonly hasSideEffect: boolean;
  /** 参数说明 */
  readonly params: readonly string[];
}

/** 预定义的原子能力清单 */
export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'read-file',
    description: '读取文件内容',
    hasSideEffect: false,
    params: ['path'],
  },
  {
    name: 'write-file',
    description: '创建或覆盖文件',
    hasSideEffect: true,
    params: ['path', 'content'],
  },
  {
    name: 'edit-file',
    description: '编辑文件局部内容',
    hasSideEffect: true,
    params: ['path', 'old', 'new'],
  },
  {
    name: 'delete-file',
    description: '删除文件',
    hasSideEffect: true,
    params: ['path'],
  },
  {
    name: 'run-command',
    description: '执行 shell 命令',
    hasSideEffect: true,
    params: ['command'],
  },
  {
    name: 'search-code',
    description: '搜索代码或文件',
    hasSideEffect: false,
    params: ['pattern', 'scope'],
  },
  {
    name: 'search-web',
    description: '搜索网络信息',
    hasSideEffect: false,
    params: ['query'],
  },
  {
    name: 'ask-user',
    description: '向用户提问并等待回答',
    hasSideEffect: false,
    params: ['question'],
  },
  {
    name: 'think',
    description: '纯思考与分析（无副作用）',
    hasSideEffect: false,
    params: ['topic'],
  },
] as const;

/** 能力名称集合，用于快速校验 */
export const CAPABILITY_NAMES = new Set(CAPABILITIES.map(c => c.name));

/** 校验操作名是否在清单中 */
export function isValidCapability(name: string): boolean {
  return CAPABILITY_NAMES.has(name);
}

/** 获取能力定义 */
export function getCapability(name: string): Capability | undefined {
  return CAPABILITIES.find(c => c.name === name);
}
