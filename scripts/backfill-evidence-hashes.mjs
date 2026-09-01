#!/usr/bin/env node
// 锚行哈希存量回填脚本（缺口② 语义绑定增强，2026-08-16）。
// 引擎+脚本交付：本脚本只处理调用方显式传入的侧车；存量活目录（如 <home>/demo-ledger）的回填
// 由编排线在审核后执行，本脚本绝不主动触碰任何固定路径。
//
// 用法：node scripts/backfill-evidence-hashes.mjs --sidecar <atlas-state.json>
//
// 行为：
// - 复用 lib/store 的 loadSidecar/saveSidecar（CAS revision + O_EXCL 锁，与引擎写入同一条安全路径）；
// - 只对绝对锚回填：文件可读且行在界 → 补节点 evidenceMeta { h, at }（已有条目跳过 = 幂等；
//   幂等重跑零写入、零 revision 推进、不产生新备份）；
// - broken（文件缺/不可读/行越界/格式坏）→ 跳过并列入输出清单，exit 0——broken 是数据现状不是脚本失败；
// - 相对锚（存量旧形态）不回填只计数——相对锚的解析依赖读方 --root，哈希语义只钉绝对锚；
// - 首次实际写入前把侧车整份（字节级）备份到 <侧车目录>/../history/atlas-state-pre-hash-backfill-<YYYYMMDD>.json
//   （七区制 history/ 与 state/ 同级）；history 目录不存在时不代建，退到侧车同目录并 fail-loud 说明；
//   同日重跑目标名已存在时追加 -2/-3 序号，绝不覆盖既有备份。
// 零运行时依赖；Node >=18；可移植（路径全部由 --sidecar 推导，无本机假设）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSidecar, saveSidecar } from '../lib/store.mjs';
import { parseLocator, computeLocatorHash } from '../lib/evidence.mjs';

const SCRIPT = path.basename(fileURLToPath(import.meta.url));
const USAGE = '用法：node scripts/' + SCRIPT + ' --sidecar <atlas-state.json>';

function fail(message) {
  console.error(SCRIPT + ' fail：' + message);
  process.exit(1);
}

// ---------- 参数（极简 --key value 解析，不引依赖；脚本非命令注册表成员，不占旗标预算） ----------
const argv = process.argv.slice(2);
let sidecarPath = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--sidecar') {
    sidecarPath = argv[i + 1];
    if (!sidecarPath) fail('--sidecar 需要路径参数。' + USAGE);
    i += 1;
    continue;
  }
  fail('未知参数：' + argv[i] + '。' + USAGE);
}
if (!sidecarPath) fail('缺 --sidecar。' + USAGE);
if (!fs.existsSync(sidecarPath)) fail('侧车不存在：' + sidecarPath);
sidecarPath = path.resolve(sidecarPath);

// ---------- 备份路径：<侧车目录>/../history/（七区制 history 与 state 同级）；不存在退侧车同目录 ----------
const sidecarDir = path.dirname(sidecarPath);
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const backupBase = 'atlas-state-pre-hash-backfill-' + stamp + '.json';
let backupDir = path.join(sidecarDir, '..', 'history');
let backupFallback = false;
if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
  backupDir = sidecarDir;
  backupFallback = true;
  console.error(SCRIPT + ' 注意：' + path.join(sidecarDir, '..', 'history') + ' 不存在（不代建）——备份退到侧车同目录 ' + sidecarDir + '；若为七区制图谱请先建 history/ 区再重跑');
}
function reserveBackupPath() {
  // 同日重跑不覆盖既有备份：基名被占则追加 -2/-3 序号（首个空闲位）。
  let candidate = path.join(backupDir, backupBase);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(backupDir, backupBase.replace(/\.json$/, '-' + n + '.json'));
    n += 1;
  }
  return candidate;
}

// ---------- 回填 ----------
let sidecar;
try {
  sidecar = loadSidecar(sidecarPath);
} catch (e) {
  fail('侧车读取失败（' + (e.code || 'sidecar_error') + '）：' + e.message);
}

const now = new Date().toISOString();
let filled = 0;
let skippedExisting = 0;
let broken = 0;
let relativeSkipped = 0;
const brokenLocators = [];
for (const [id, node] of Object.entries(sidecar.nodes || {})) {
  if (!node || !Array.isArray(node.evidence)) continue;
  for (const locator of node.evidence) {
    const parsed = parseLocator(locator);
    if (!parsed.ok) {
      // 格式坏锚（写入边历史遗留）：同按数据现状跳过列出，不阻断。
      broken += 1;
      brokenLocators.push(locator + '（节点 ' + id + '，bad_locator）');
      continue;
    }
    if (!path.isAbsolute(parsed.file)) {
      relativeSkipped += 1;
      continue;
    }
    const meta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
    const existing = meta[locator];
    if (existing && typeof existing === 'object' && typeof existing.h === 'string' && existing.h) {
      skippedExisting += 1;
      continue;
    }
    const h = computeLocatorHash(locator, process.cwd());
    if (h === null) {
      broken += 1;
      brokenLocators.push(locator + '（节点 ' + id + '，文件缺/不可读/行越界）');
      continue;
    }
    node.evidenceMeta = meta;
    node.evidenceMeta[locator] = { h, at: now };
    filled += 1;
  }
}

// ---------- 写入（先备份再 save；幂等重跑零写入） ----------
let backupPath = null;
if (filled > 0) {
  backupPath = reserveBackupPath();
  try {
    fs.copyFileSync(sidecarPath, backupPath); // 整份字节级备份：回填前原样快照
  } catch (e) {
    fail('备份失败（已中止，侧车未改动）：' + backupPath + '：' + e.message);
  }
  try {
    saveSidecar(sidecarPath, sidecar);
  } catch (e) {
    fail('侧车保存失败（' + (e.code || 'sidecar_error') + '，备份保留在 ' + backupPath + '）：' + e.message);
  }
}

console.log(JSON.stringify({
  script: SCRIPT,
  sidecar: sidecarPath,
  backup: backupPath,
  backupFallback,
  filled,
  skippedExisting,
  broken,
  brokenLocators,
  relativeSkipped,
}, null, 2));
if (brokenLocators.length > 0) {
  console.error(SCRIPT + ' 注意：' + broken + ' 条 broken 锚未回填（数据现状，非脚本失败；清单见输出 brokenLocators）');
}
process.exit(0);
