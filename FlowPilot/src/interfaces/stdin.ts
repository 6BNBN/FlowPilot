/**
 * @module interfaces/stdin
 * @description stdin 工具
 */

/** 检测是否为交互式终端 */
export function isTTY(): boolean {
  return process.stdin.isTTY === true;
}

/** 非TTY时读取stdin，TTY时返回空，超时返回空 */
export function readStdinIfPiped(timeout = 30_000): Promise<string> {
  if (isTTY()) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { process.stdin.destroy(); resolve(''); }, timeout);
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')); });
    process.stdin.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
