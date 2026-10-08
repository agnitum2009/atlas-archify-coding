// archify 内核路径解析（消灭机器相关硬编码默认值）。
// 解析顺序：①ARCHIFY_BIN（存在于磁盘才算）→ ②PATH 上的 archify → ③none（0.37.0 起无本机回退路径：本体不含任何机器相关默认值）。
// 找不到时调用方维持 fail-closed（gate 停 archify-missing / doctor 检出失败），绝不伪装成功。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';


// 耦合基线（0.14.0，关闭 2026-08-17 评估记录的「纸面钉版无机器验证」缺口）：
// 三闸（validate/deliver --quality showcase --json / visual-check --json）自此版本起行为稳定；
// doctor 机器探测实际版本并在低于基线时提示（提示级，不改 ok/exit——数据债不阻断环境自检）。
export const ARCHIFY_BASELINE = '2.14.0';

export function resolveArchify() {
  const envBin = process.env.ARCHIFY_BIN;
  if (envBin && fs.existsSync(envBin)) {
    return { bin: envBin, source: 'env' };
  }
  // 0.21.1：探测子进程同守「不得无限挂起」（裁定5 的例外收口）——超时按探测失败走回退链，fail-closed 不变。
  const which = spawnSync('which', ['archify'], { encoding: 'utf8', timeout: 5000 });
  if (which.status === 0) {
    const onPath = String(which.stdout || '').split('\n')[0].trim();
    if (onPath && fs.existsSync(onPath)) {
      return { bin: onPath, source: 'path' };
    }
  }
  return { bin: null, source: 'none' };
}

// 版本探测（零依赖零 spawn）：bin 位于 <root>/bin/ 时 package.json 在上级，也容忍与 bin 同目录。
// 探不到返回 null（不伪装）——版本未知时由 doctor 出提示级 note。
export function probeArchifyVersion(bin) {
  if (!bin || !fs.existsSync(bin)) return null;
  // 先解析符号链接（npm i -g / npm link 在 PATH 上放的是链接）：否则 v3 内核读不到版本、被静默当作 2.x（0.32.0 审阅修复）。
  let real = bin;
  try { real = fs.realpathSync(bin); } catch { /* 保留原路径 */ }
  const dirs = [...new Set([path.dirname(real), path.dirname(bin)])];
  for (const p of dirs.flatMap((dir) => [path.join(dir, '..', 'package.json'), path.join(dir, 'package.json')])) {
    try {
      const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {
      // 尝试下一个候选位置
    }
  }
  return null;
}

// 低于耦合基线判定：只比较 major.minor（prerelease 后缀如 -dev.0 忽略）；解析失败返回 false（不误报）。
export function isBelowBaseline(version) {
  if (typeof version !== 'string') return false;
  const m = version.match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  const b = ARCHIFY_BASELINE.match(/^(\d+)\.(\d+)/);
  return b ? major < Number(b[1]) || (major === Number(b[1]) && minor < Number(b[2])) : false;
}

// 内核契约族判定（0.32.0，双版本兼容）：major ≥ 3 → v3（meta.output 必填、views 退役、溯源 check）；其余 → v2。
// 只判定契约族，不作门禁；探测不到或不可解析按 2.x 并如实标 versionKnown:false。
export function kernelProfile(version) {
  const m = typeof version === 'string' ? version.match(/^(\d+)\./) : null;
  if (!m) return { version: typeof version === 'string' ? version : null, profile: 'v2', versionKnown: false };
  return { version, profile: Number(m[1]) >= 3 ? 'v3' : 'v2', versionKnown: true };
}
export const kernelOf = (bin) => kernelProfile(probeArchifyVersion(bin));
