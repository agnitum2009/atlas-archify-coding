#!/usr/bin/env node
// 边级对账（P-2，负责人令 2026-09-01 批落）：图上的 connection ↔ codegraph 边 ↔ 真码 三方核。
//
// 立法动机（同一批两令）：
//  ① 实测：archify 的 connections 只有 from/id/label/to/variant 五字段——边是无证据断言；
//     codegraph 的 edges 表（calls/imports/references/instantiates/implements/extends）恰是
//     "边"的唯一机器来源。本脚本把"边是否有据"从模型自觉变成机器可核。
//  ② 精度红线（纪律）：codegraph 行号有偏移、calls 边是 I 级提名——所以本脚本只做
//     "有/无"层面提名对账，绝不裁决语义；无据边=提示复核，漏边=提示候选，均不自动改图。
//
// 粒度桥：连接端点（图 id）→ 账本节点（同 id）→ 证据锚（绝对路径）→ 仓内相对路径（向上找 .git）
// → codegraph.db 的 nodes.file_path 匹配。读库用 node:sqlite（Node ≥22；更低版本 N/A 不谎报）。
// 降级：无索引/无 sqlite/无账本节点 → 全部如实记 N/A（口径纪律：空对象不报 0）。
//
// 用法：node scripts/reconcile-graph-edges.mjs --spec <图.json> [--spec ...] --sidecar <账> [--repo <仓> ...] [--strict] [--json] [--cap N]
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const multi = (k) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === k && argv[i + 1]) out.push(argv[i + 1]); return out; };
const one = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const JSON_OUT = argv.includes('--json');
const STRICT = argv.includes('--strict');
const CAP = one('--cap', 20);
const specs = multi('--spec');
const sidecars = multi('--sidecar');
const extraRepos = multi('--repo');

function fail(msg) {
  console.log(JSON.stringify({ schemaVersion: 1, command: 'reconcile-graph-edges', status: 'failed',
    diagnostics: [{ rule: 'bad_args', severity: 'error', evidence: msg }] }, null, 2));
  process.exit(2);
}
if (specs.length === 0 || sidecars.length === 0) fail('需要 --spec <图.json>（可重复）与 --sidecar <账>（只处理显式传入，不猜路径）');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node <22：N/A 降级 */ }

function repoRootOf(absPath) {
  let d = path.dirname(absPath);
  for (let i = 0; i < 20; i += 1) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

// ---------- 图与账 ----------
const connections = [];
for (const sp of specs) {
  let d;
  try { d = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (e) { fail('spec 非合法 JSON：' + sp + '（' + e.message + '）'); }
  for (const c of d.connections || []) {
    if (c && c.from && c.to) connections.push({ spec: path.basename(sp), id: c.id || null, from: String(c.from), to: String(c.to), label: c.label || '' });
  }
}
let ledger = { nodes: {} };
for (const sc of sidecars) {
  let d;
  try { d = JSON.parse(fs.readFileSync(sc, 'utf8')); } catch (e) { fail('侧车非合法 JSON：' + sc + '（' + e.message + '）'); }
  Object.assign(ledger.nodes, d.nodes || {});
}
const anchoredFiles = (id) => {
  const n = ledger.nodes[id];
  if (!n) return null;
  return (n.evidence || []).map((l) => String(l).match(/^(.*):(\d+)$/)?.[1]).filter(Boolean);
};

// ---------- codegraph 只读口 ----------
const edgeKinds = new Set(['calls', 'imports', 'references', 'instantiates', 'extends', 'implements']);
function openDb(repoPath) {
  if (!DatabaseSync) return { err: 'node:sqlite 不可用（需 Node ≥22）' };
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) return { err: '无 codegraph 索引（' + dbPath + '）' };
  try { return { db: new DatabaseSync(dbPath, { readOnly: true }) }; } catch (e) { return { err: '索引打不开：' + e.message }; }
}
function dbHasEdgeBetween(db, fromRelFiles, toRelFiles) {
  if (fromRelFiles.length === 0 || toRelFiles.length === 0) return false;
  const f1 = fromRelFiles.map(() => '?').join(',');
  const f2 = toRelFiles.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT COUNT(*) c FROM edges e
     JOIN nodes s ON e.source = s.id JOIN nodes t ON e.target = t.id
     WHERE e.kind != 'contains' AND (
       (s.file_path IN (${f1}) AND t.file_path IN (${f2})) OR
       (s.file_path IN (${f2}) AND t.file_path IN (${f1}))
     )`
  ).get(...fromRelFiles, ...toRelFiles, ...toRelFiles, ...fromRelFiles);
  return (row?.c || 0) > 0;
}

// ---------- 判定 ----------
const findings = [];
let calibrated = 0;
let ungrounded = 0;
let withoutEvidence = 0;
let withoutEdge = 0;
const naRepos = new Set();

for (const conn of connections) {
  const af = anchoredFiles(conn.from);
  const bf = anchoredFiles(conn.to);
  if (!af || !bf || af.length === 0 || bf.length === 0) {
    ungrounded += 1;
    findings.push({ rule: 'edge-ungrounded', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
      evidence: `边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）端点无账或无锚，不可核对` });
    continue;
  }
  // 逐仓核对：任一端点同仓有边即校准（边方向在提名级从宽：双向任一命中即算）
  const byRepo = (files) => {
    const m = new Map();
    for (const f of files) {
      const root = repoRootOf(f);
      if (!root) continue;
      if (!m.has(root)) m.set(root, []);
      m.get(root).push(path.relative(root, f));
    }
    return m;
  };
  const ra = byRepo(af);
  const rb = byRepo(bf);
  let hit = false;
  let checked = false;
  for (const [root, fa] of ra) {
    if (!rb.has(root)) continue; // 异仓边本提名器不可见（跨仓归人工）
    const opened = openDb(root);
    if (opened.err) { naRepos.add(path.basename(root)); continue; }
    checked = true;
    if (dbHasEdgeBetween(opened.db, fa, rb.get(root))) { hit = true; }
    opened.db.close();
  }
  if (hit) { calibrated += 1; continue; }
  withoutEvidence += 1;
  findings.push({ rule: 'edge-without-code-evidence', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
    evidence: `图边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）在同仓索引里无调用/引用边——I 级提名：不证明码无此边，但值得复核两端锚行是否真支撑这条连线`,
    supportedFixes: ['实读两端锚行核对；确无此关系则删边，确有关系则给端点补更准的锚'] });
}

// 漏边：同仓锚文件间有边而图上无连线（方向从宽）
const fileToComponent = new Map();
for (const [id, node] of Object.entries(ledger.nodes)) {
  for (const l of node.evidence || []) {
    const m = String(l).match(/^(.*):(\d+)$/);
    if (m) fileToComponent.set(m[1], id);
  }
}
const edgeKey = new Set(connections.map((c) => `${c.from}→${c.to}`));
const byRepoAll = new Map();
for (const f of fileToComponent.keys()) {
  const root = repoRootOf(f);
  if (!root) continue;
  if (!byRepoAll.has(root)) byRepoAll.set(root, []);
  byRepoAll.get(root).push(path.relative(root, f));
}
for (const [root, relFiles] of byRepoAll) {
  const opened = openDb(root);
  if (opened.err) { naRepos.add(path.basename(root)); continue; }
  const uniq = [...new Set(relFiles)];
  if (uniq.length < 2) { opened.db.close(); continue; }
  const marks = uniq.map(() => '?').join(',');
  const rows = opened.db.prepare(
    `SELECT DISTINCT s.file_path sf, t.file_path tf FROM edges e
     JOIN nodes s ON e.source = s.id JOIN nodes t ON e.target = t.id
     WHERE e.kind != 'contains' AND s.file_path IN (${marks}) AND t.file_path IN (${marks}) AND s.file_path != t.file_path
     LIMIT ${CAP * 4}`
  ).all(...uniq, ...uniq);
  opened.db.close();
  let n = 0;
  for (const r of rows) {
    if (n >= CAP) break;
    const ca = fileToComponent.get(path.join(root, r.sf));
    const cb = fileToComponent.get(path.join(root, r.tf));
    if (!ca || !cb || ca === cb) continue;
    if (!edgeKey.has(`${ca}→${cb}`) && !edgeKey.has(`${cb}→${ca}`)) {
      withoutEdge += 1; n += 1;
      findings.push({ rule: 'code-evidence-without-edge', severity: 'warning', subject: `${ca}→${cb}`,
        evidence: `码上有据（${r.sf} ↔ ${r.tf}）而图上无边——候选漏边（I 级提名：先实读两文件确认关系再决定是否入图）` });
    }
  }
}

const data = {
  connections: connections.length,
  calibrated, ungrounded, withoutEvidence, withoutEdge,
  noIndexRepos: [...naRepos],
  ...(connections.length === 0 ? { note: 'spec 无 connections——本报告是"无对象"，不是"全部有边"' } : {}),
};
const receipt = { schemaVersion: 1, command: 'reconcile-graph-edges', status: 'ok',
  data: { ...data },
  diagnostics: findings };
if (JSON_OUT) console.log(JSON.stringify(receipt, null, 2));
else {
  console.log(`edge-reconcile ok：连接 ${data.connections} · 已校准 ${calibrated} · 无端点 ${ungrounded} · 无据边 ${withoutEvidence} · 漏边 ${withoutEdge} · N/A 仓 ${naRepos.size}`);
  for (const f of findings.slice(0, CAP * 2)) console.log(`  [${f.severity}] ${f.subject} ${f.evidence}`.trim());
  if (findings.length > CAP * 2) console.log(`  …另 ${findings.length - CAP * 2} 条（--cap 可调）`);
}
process.exit(STRICT && findings.length > 0 ? 1 : 0);
