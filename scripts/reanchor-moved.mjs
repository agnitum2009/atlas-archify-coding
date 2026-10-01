#!/usr/bin/env node
// 纯移位漂移锚的批量自动 reanchor（0.12.0，实战反馈档-2026-08-23 P0-2 吸收）。
//
// 为什么是脚本不是 doctor --fix-moved（交叉验证 glm/reviewer-B 双席一致裁定）：
//   依据是能力准入五问②——「现有命令+脚本能组合达成 = 拒进内核，落 scripts/」。
//   执行席的 PoC（113/113 零误）本身就证明了脚本可达成；scripts/ 是明示泄压区。
// 为什么进程内 import lib 而非逐锚 spawn CLI（吸收 P2-7，无需新批量接口）：
//   实测 113 次独立进程 = 13.6s，其中 ~93% 是 node 启动；进程内单进程 N 改一存，CAS 一次。
//   先例：scripts/backfill-evidence-hashes.mjs 同法。
// 语义：逐锚镜像 state evidence-reanchor——evidence 数组原位替换（去重）、evidenceMeta 删旧立新、
//   history 记 kind='evidence-reanchor'（附 via 字段可审计）；apply 前逐候选用 computeLocatorHash
//   反验（新锚哈希必须等于旧哈希——顺带自校验脚本与引擎的归一化一致性，不一致即拒）。
// 守卫：目标行 trim 后 < --min-len（缺省 4）不自动（弱内容）；零命中/文件缺失 → 人工清单；
//   缺省 dry-run 只出报告，--apply 才写；只处理显式传入的侧车，绝不猜路径。
//
// 用法：node scripts/reanchor-moved.mjs --sidecar <atlas-state.json> [--apply] [--min-len 4]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadSidecar, saveSidecar, appendHistory } from '../lib/store.mjs';
import { computeLocatorHash } from '../lib/evidence.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const APPLY = argv.includes('--apply');
const MIN_LEN = Number(arg('min-len', '4'));
const sidecarPath = arg('sidecar');
if (!sidecarPath) {
  console.error(JSON.stringify({ schemaVersion: 1, command: 'reanchor-moved', status: 'failed',
    diagnostics: [{ rule: 'bad_args', severity: 'error', subject: '--sidecar',
      evidence: '用法：--sidecar <atlas-state.json> [--apply] [--min-len 4]（只处理显式传入，不猜路径）' }] }, null, 2));
  process.exit(1);
}

let sc;
try { sc = loadSidecar(sidecarPath); } catch (e) {
  console.error(JSON.stringify({ schemaVersion: 1, command: 'reanchor-moved', status: 'failed',
    diagnostics: [{ rule: e.code || 'sidecar_error', severity: 'error', subject: sidecarPath, evidence: e.message }] }, null, 2));
  process.exit(1);
}

const lineHash = (s) => crypto.createHash('sha256').update(s.trim()).digest('hex').slice(0, 12);
const stats = { anchorsScanned: 0, hashed: 0, okUnmoved: 0, moved: [], manual: [], weak: [], missingFile: [] };

for (const [nodeId, node] of Object.entries(sc.nodes || {})) {
  const evidence = node.evidence || [];
  const meta = node.evidenceMeta || {};
  for (const loc of [...evidence]) {
    stats.anchorsScanned += 1;
    const m = meta[loc];
    if (!m || !m.h) continue; // unhashed 存量：无旧哈希无从判移位
    stats.hashed += 1;
    const parsed = loc.match(/^(.*):(\d+)$/);
    if (!parsed) continue;
    const [, file, lineStr] = parsed;
    const oldLine = Number(lineStr);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { stats.missingFile.push({ node: nodeId, locator: loc }); continue; }
    const lines = src.split('\n');
    if (oldLine >= 1 && oldLine <= lines.length && lineHash(lines[oldLine - 1]) === m.h) { stats.okUnmoved += 1; continue; }
    // drifted：全文件扫同哈希行（内容只是移位则必命中）
    const candidates = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim().length >= MIN_LEN && lineHash(lines[i]) === m.h) candidates.push(i + 1);
    }
    if (candidates.length === 0) {
      const weakSomewhere = lines.some((l, i) => l.trim().length < MIN_LEN && l.trim().length > 0 && lineHash(l) === m.h);
      (weakSomewhere ? stats.weak : stats.manual).push({ node: nodeId, locator: loc, reason: weakSomewhere ? '命中行过弱（<' + MIN_LEN + ' 字符）不自动' : '同哈希零命中=内容真变' });
      continue;
    }
    candidates.sort((a, b) => Math.abs(a - oldLine) - Math.abs(b - oldLine) || a - b);
    const to = file + ':' + candidates[0];
    // 反验：引擎口径的新锚哈希必须等于旧哈希（同时自校验脚本/引擎归一化一致）
    if (computeLocatorHash(to, process.cwd()) !== m.h) {
      stats.manual.push({ node: nodeId, locator: loc, reason: '候选行引擎哈希反验不一致（归一化差异），拒自动' });
      continue;
    }
    stats.moved.push({ node: nodeId, from: loc, to, distance: Math.abs(candidates[0] - oldLine), candidates: candidates.length });
  }
}

if (APPLY && stats.moved.length > 0) {
  const byNode = new Map();
  for (const mv of stats.moved) {
    const expected = sc.nodes[mv.node].evidenceMeta[mv.from].h;
    if (computeLocatorHash(mv.to, process.cwd()) !== expected) {
      console.error(JSON.stringify({ schemaVersion: 1, command: 'reanchor-moved', status: 'failed',
        diagnostics: [{ rule: 'bad_input', severity: 'error', subject: mv.to,
          evidence: '移锚目标在计划后变动，整批拒写；请重新 dry-run' }] }, null, 2));
      process.exit(1);
    }
    if (!byNode.has(mv.node)) byNode.set(mv.node, []);
    byNode.get(mv.node).push(mv);
  }
  const at = new Date().toISOString();
  for (const [nodeId, moves] of byNode) {
    const node = sc.nodes[nodeId];
    const originalMeta = node.evidenceMeta || {};
    const targets = new Map(moves.map(mv => [mv.from, mv.to]));
    // 同一原始快照一次映射：相邻移位/循环不能把尚未处理的源锚当成目标合并掉。
    const evidence = [...new Set((node.evidence || []).map(loc => targets.get(loc) || loc))];
    const meta = { ...originalMeta };
    for (const mv of moves) delete meta[mv.from];
    for (const mv of moves) {
      meta[mv.to] = { ...meta[mv.to], ...originalMeta[mv.from], at };
      appendHistory(node, { at, kind: 'evidence-reanchor', from: mv.from, to: mv.to, via: 'reanchor-moved' });
    }
    node.evidence = evidence;
    node.evidenceMeta = meta;
  }
  saveSidecar(sidecarPath, sc); // 单进程一次 CAS 保存
}

console.log(JSON.stringify({ schemaVersion: 1, command: 'reanchor-moved', status: 'ok',
  data: { sidecar: sidecarPath, mode: APPLY ? 'apply' : 'dry-run', minLen: MIN_LEN,
    ...stats, movedCount: stats.moved.length, manualCount: stats.manual.length, weakCount: stats.weak.length },
  ...(APPLY ? {} : { diagnostics: [{ rule: 'dry_run', severity: 'warning', subject: 'reanchor-moved',
    evidence: '缺省 dry-run 未写入；确认清单后加 --apply 执行', supportedFixes: [] }] }) }, null, 2));
