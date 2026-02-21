/**
 * @module infrastructure/logger
 * @description Verbose 日志模块 - 通过 FLOWPILOT_VERBOSE=1 或 --verbose 启用
 */

let verbose = process.env.FLOWPILOT_VERBOSE === '1';

/** 启用 verbose 模式 */
export function enableVerbose(): void {
  verbose = true;
  process.env.FLOWPILOT_VERBOSE = '1';
}

export const log = {
  debug(msg: string): void {
    if (verbose) process.stderr.write(`[DEBUG] ${msg}\n`);
  },
  info(msg: string): void {
    process.stderr.write(`[INFO] ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`[WARN] ${msg}\n`);
  },
};
