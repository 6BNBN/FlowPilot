/**
 * @module infrastructure/updater
 * @description 自动更新检查模块
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

const REPO_OWNER = '6BNBN';
const REPO_NAME = 'FlowPilot';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const RELEASE_URL = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/releases';

interface UpdateCache {
  checkedAt: number;
  latestVersion: string;
  currentVersion: string;
}

function getCachePath(): string {
  return join(process.cwd(), '.flowpilot', 'update-cache.json');
}

function getCurrentVersion(): string {
  try {
    const cwd = process.cwd();
    const flowPath = existsSync(join(cwd, 'flow.js')) 
      ? join(cwd, 'flow.js') 
      : join(cwd, 'dist', 'flow.js');
    if (existsSync(flowPath)) {
      const content = readFileSync(flowPath, 'utf-8');
      const match = content.match(/\/\/ FLOWPILOT_VERSION:\s*(\d+\.\d+\.\d+)/);
      if (match) return match[1];
    }
  } catch {}
  return '0.0.0';
}

function parseVersion(version: string): number[] {
  return version.replace(/^v/, '').split('.').map(Number);
}

function compareVersions(current: string, latest: string): boolean {
  const cur = parseVersion(current);
  const lat = parseVersion(latest);
  for (let i = 0; i < 3; i++) {
    const c = cur[i] || 0;
    const l = lat[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

function fetchLatestInfo(): { version: string } | null {
  try {
    const apiUrl = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/releases/latest';
    const cmd = 'curl -s -H "Accept: application/vnd.github+json" "' + apiUrl + '"';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
    const data = JSON.parse(result);
    const version = data.tag_name ? data.tag_name.replace(/^v/, '') : null;
    if (!version) return null;
    return { version };
  } catch {
    return null;
  }
}

function loadCache(): UpdateCache | null {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(cache: UpdateCache): void {
  const cachePath = getCachePath();
  const dir = dirname(cachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * 检查更新并返回提示信息
 * @returns 有新版本返回提示字符串，无更新或检查失败返回 null
 */
export function checkForUpdate(): string | null {
  const currentVersion = getCurrentVersion();
  if (currentVersion === '0.0.0') return null;

  const cache = loadCache();
  const now = Date.now();

  // 缓存有效期内，直接返回缓存结果
  if (cache && now - cache.checkedAt < CACHE_DURATION_MS) {
    if (compareVersions(currentVersion, cache.latestVersion)) {
      return '💡 发现新版本 v' + cache.latestVersion + ' (当前 v' + currentVersion + ')，运行: curl -L ' + RELEASE_URL + '/latest/download/flow.js -o flow.js';
    }
    return null;
  }

  // 尝试获取最新版本
  const latestInfo = fetchLatestInfo();
  if (!latestInfo) {
    return null;
  }

  const hasUpdate = compareVersions(currentVersion, latestInfo.version);
  const newCache: UpdateCache = {
    checkedAt: now,
    latestVersion: latestInfo.version,
    currentVersion,
  };
  saveCache(newCache);

  if (hasUpdate) {
    return '💡 发现新版本 v' + latestInfo.version + ' (当前 v' + currentVersion + ')，运行: curl -L ' + RELEASE_URL + '/latest/download/flow.js -o flow.js';
  }
  
  return null;
}
