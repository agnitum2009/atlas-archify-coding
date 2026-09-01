#!/usr/bin/env node
// RELEASES↔版本对账门禁（增长控制开发规范批一#1，2026-08-15）：
// 解析 RELEASES 顶部首个 [x.y.z]（Keep-a-Changelog 条目头 `## [x.y.z] - 日期`）
// 与 package.json version 比对，不一致 exit 1 并列两值；文件缺失/不可解析同样 exit 1（fail-loud）。
// 可移植性（DEFENSIVE.md §7 教训）：根路径取自身位置解析，无 TTY/本机路径假设；零依赖。
// 用法：node scripts/verify-release-version.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const changelogPath = path.join(root, 'RELEASES.md');
const pkgPath = path.join(root, 'package.json');

if (!fs.existsSync(changelogPath)) {
  console.error('RELEASES.md 不存在（版本纪律要求每次发版先写变更记录）');
  process.exit(1);
}
const changelog = fs.readFileSync(changelogPath, 'utf8');
const top = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
if (!top) {
  console.error('RELEASES.md 找不到顶部版本条目（Keep-a-Changelog 格式：## [x.y.z] - 日期）');
  process.exit(1);
}

let pkgVersion;
try {
  pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
} catch (e) {
  console.error('package.json 不可读或不可解析：' + e.message);
  process.exit(1);
}
if (typeof pkgVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkgVersion)) {
  console.error('package.json version 非合法 semver：' + JSON.stringify(pkgVersion));
  process.exit(1);
}

if (top[1] !== pkgVersion) {
  console.error(`release-version mismatch：RELEASES 顶部 [${top[1]}] ≠ package.json version ${pkgVersion}（版本纪律：发版必须先写 RELEASES）`);
  process.exit(1);
}
console.log(`release-version ok：RELEASES 顶部 [${top[1]}] = package.json version`);
