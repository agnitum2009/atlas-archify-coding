#!/usr/bin/env node
// codegraph 索引新鲜度门禁（P-0，负责人令 2026-09-01 批落）。
//
// 立法动机（两线实证）：
//  ① 实测：29 个索引仓 19 个比自身末次提交还旧（最狠 69 天）——「提名器」一旦陈旧，
//    它给出的"发现更多细节"就是看着权威的错细节（漏掉新加的调用者），比盲读更危险。
//  ② codegraph 自带的 status 判的是 git 工作树不是索引库（纪律节已写但无人执行）；
//    引擎/契约零 codegraph 引用不变，本脚本放 scripts/（泄压区，harness 知识收容区）。
//
// 分母口径（0/0 判据，不写死清单）：projects.json 注册表（sourcePath）∪ 账本锚实际指向的仓
// （锚是绝对路径，向上找最近 .git）。两源都空 → 报 N/A（null）而不是 0/100（口径纪律）。
// 无索引仓 → state=no-index 记 warning（那是"发现更多细节"未覆盖处），不红。
// 出域策略：exit 1 仅当某仓 lag > --fail-days（默认 3）；lag > --warn-days（默认 1）记 warning。
// 判据换源（O4，2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O4）：索引构建时间取
//   ① .codegraph/last-sync.json（codegraph sync 侧写，timestamp 字段或文件 mtime）；
//   ② .codegraph/codegraph.db 的 mtime；
// 两者取较新，无 marker 时回退 db mtime 并标 mtime_fallback warning。**不再取 .codegraph/ 目录内 max mtime**
// ——实测：对索引做一次只读查询即刷新目录内文件（-shm/-wal/日志）mtime，闸假绿（根仓真 lag 4.63 天未被发现）；
// 「被摸过」不是「重建过」。 --source mtime 只读 db mtime（回滚档，仍不读目录 max）。
// 落盘（O4）：写前把本次运行 append 为一行 JSONL 到 <atlas>/data/<project>/codegraph-freshness.jsonl
// （目录不存在即建，只追加不覆盖；派生见 lib/atlas-data.mjs；无 atlas 语境则不落盘，零副作用）。
//
// 用法：node scripts/check-codegraph-freshness.mjs --sidecar <账> [--sidecar ...] [--repo <仓> ...] [--exempt <名> ...] [--warn-days N] [--fail-days N] [--source manifest|mtime] [--json]
import fs from 'node:fs';
import { readProjectsRegistry } from '../lib/projects-registry.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveAtlasContext, appendJsonl } from '../lib/atlas-data.mjs';

const argv = process.argv.slice(2);
const multi = (k) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === k && argv[i + 1]) out.push(argv[i + 1]); return out; };
const one = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const JSON_OUT = argv.includes('--json');
const sidecars = multi('--sidecar');
const extraRepos = multi('--repo');
const exempt = new Set(multi('--exempt'));
const WARN_DAYS = one('--warn-days', 1);
const FAIL_DAYS = one('--fail-days', 3);
const SOURCE = (() => { const i = argv.indexOf('--source'); return i >= 0 && argv[i + 1] ? argv[i + 1] : 'manifest'; })();
if (SOURCE !== 'manifest' && SOURCE !== 'mtime') fail('--source 只接受 manifest|mtime，实际：' + SOURCE);

function fail(msg) {
  console.log(JSON.stringify({ schemaVersion: 1, command: 'check-codegraph-freshness', status: 'failed',
    diagnostics: [{ rule: 'bad_args', severity: 'error', evidence: msg }] }, null, 2));
  process.exit(2);
}

if (sidecars.length === 0 && extraRepos.length === 0) {
  fail('至少给一个 --sidecar 或 --repo（只处理显式传入，不猜路径）');
}

// ---------- 分母收集 ----------
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

const repos = new Map(); // canonical absolute path → { path, sources: Set<string> }
const addRepo = (p, source) => {
  if (typeof p !== 'string' || !p.trim() || p.includes('\0')) return;
  let abs = path.resolve(p);
  try { abs = fs.realpathSync(abs); } catch { /* Missing paths remain visible in coverage. */ }
  if (!repos.has(abs)) repos.set(abs, { path: abs, sources: new Set() });
  repos.get(abs).sources.add(source);
};

for (const sc of sidecars) {
  if (!fs.existsSync(sc)) fail('侧车不存在：' + sc);
  // ① 锚指向的仓
  let data;
  try { data = JSON.parse(fs.readFileSync(sc, 'utf8')); } catch (e) { fail('侧车非合法 JSON：' + sc + '（' + e.message + '）'); }
  let anchorRepoCount = 0;
  for (const node of Object.values(data.nodes || {})) {
    for (const loc of node.evidence || []) {
      const m = String(loc).match(/^(.*):(\d+)$/);
      if (!m) continue;
      const root = repoRootOf(m[1]);
      if (root) { addRepo(root, 'anchor'); anchorRepoCount += 1; }
    }
  }
  // ② 注册表（与 project-gate 同源：侧车同目录的 projects.json）
  const regPath = path.join(path.dirname(path.resolve(sc)), 'projects.json');
  const registry = readProjectsRegistry(regPath);
  if (registry.status === 'invalid') fail('注册表不可用：' + regPath + '（' + registry.error.message + '）');
  for (const entry of registry.entries) if (entry) addRepo(entry.sourcePath, 'registry');

  if (anchorRepoCount === 0 && !fs.existsSync(regPath)) {
    // 该侧车对分母零贡献——如实披露，不计入 0
  }
}
for (const r of extraRepos) addRepo(r, 'explicit');

// ---------- 逐仓判新鲜 ----------
// 判据：索引构建时间（O4 换源，见头注）。marker = .codegraph/last-sync.json（字段时间戳优先，退文件 mtime）。
const MARKER_FILE = 'last-sync.json';
const MARKER_TIME_KEYS = ['at', 'syncedAt', 'completedAt', 'finishedAt', 'time', 'timestamp', 'lastSync', 'lastSyncedAt'];

function markerTime(markerPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    for (const key of MARKER_TIME_KEYS) {
      const v = parsed && parsed[key];
      if (v === undefined || v === null) continue;
      const ms = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v));
      if (Number.isFinite(ms)) return ms;
    }
  } catch { /* 坏 JSON：退回文件 mtime（不因 marker 坏而判无索引） */ }
  try { return fs.statSync(markerPath).mtimeMs; } catch { return null; }
}

function indexBuildInfo(repoPath) {
  const dir = path.join(repoPath, '.codegraph');
  const dbPath = path.join(dir, 'codegraph.db');
  const markerPath = path.join(dir, MARKER_FILE);
  let dbMs = null;
  try { dbMs = fs.statSync(dbPath).mtimeMs; } catch { dbMs = null; }
  const markerMs = fs.existsSync(markerPath) ? markerTime(markerPath) : null;
  if (SOURCE === 'mtime') {
    return dbMs === null ? null : { ms: dbMs, source: 'db-mtime', fallback: false };
  }
  if (markerMs !== null && dbMs !== null) {
    return { ms: Math.max(dbMs, markerMs), source: markerMs >= dbMs ? 'marker' : 'db-mtime-newer', fallback: false };
  }
  if (markerMs !== null) return { ms: markerMs, source: 'marker', fallback: false };
  if (dbMs !== null) return { ms: dbMs, source: 'db-mtime', fallback: true }; // 无 marker → 回退 db mtime + warning
  return null;
}

function lastCommitTs(repoPath) {
  const r = spawnSync('git', ['-C', repoPath, 'log', '-1', '--format=%ct'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const rows = [];
let failCount = 0;
let warnCount = 0;
for (const [, info] of [...repos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const name = path.basename(info.path);
  if (exempt.has(name)) { rows.push({ repo: name, path: info.path, state: 'exempt', sources: [...info.sources] }); continue; }
  if (!fs.existsSync(info.path)) { rows.push({ repo: name, path: info.path, state: 'missing-repo', sources: [...info.sources], note: '仓目录不存在' }); continue; }
  const idx = indexBuildInfo(info.path);
  if (idx === null) { rows.push({ repo: name, path: info.path, state: 'no-index', sources: [...info.sources], note: '锚/注册表指向但无索引（无 codegraph.db 也无 last-sync.json）——提名能力缺失（读码靠盲翻，是 token 重灾区）' }); warnCount += 1; continue; }
  const commitTs = lastCommitTs(info.path);
  if (commitTs === null) { rows.push({ repo: name, path: info.path, state: 'no-git', sources: [...info.sources], note: '无 git 提交可比对' }); continue; }
  const lagDays = (commitTs * 1000 - idx.ms) / 86400000;
  const state = lagDays > FAIL_DAYS ? 'stale' : lagDays > WARN_DAYS ? 'aging' : 'fresh';
  if (state === 'stale') failCount += 1;
  if (state === 'aging') warnCount += 1;
  rows.push({ repo: name, path: info.path, state, lagDays: Number(lagDays.toFixed(2)), indexBuiltAt: new Date(idx.ms).toISOString(), indexSource: idx.source, ...(idx.fallback ? { mtimeFallback: true } : {}), lastCommit: new Date(commitTs * 1000).toISOString(), sources: [...info.sources] });
}

const denominatorEmpty = repos.size === 0;
const data = {
  warnDays: WARN_DAYS, failDays: FAIL_DAYS, source: SOURCE,
  denominator: denominatorEmpty ? 'N/A（注册表与锚都未指向任何仓）' : `${repos.size} 仓`,
  counts: {
    fresh: rows.filter((r) => r.state === 'fresh').length,
    aging: rows.filter((r) => r.state === 'aging').length,
    stale: failCount,
    noIndex: rows.filter((r) => r.state === 'no-index').length,
    exempt: rows.filter((r) => r.state === 'exempt').length,
    na: rows.filter((r) => ['missing-repo', 'no-git'].includes(r.state)).length,
  },
  rows,
};
const diagnostics = [];
if (denominatorEmpty) diagnostics.push({ rule: 'n_a', severity: 'warning', evidence: '分母为空：注册表与锚都未指向任何仓——本报告是"无对象"，不是"全部新鲜"' });
for (const r of rows) {
  if (r.state === 'stale') diagnostics.push({ rule: 'index_stale', severity: 'error', subject: r.repo, evidence: `索引落后末次提交 ${r.lagDays} 天（>${FAIL_DAYS} 天）：陈旧提名器产出看着权威的错细节；先 codegraph sync 再用` });
  if (r.state === 'aging') diagnostics.push({ rule: 'index_aging', severity: 'warning', subject: r.repo, evidence: `索引落后末次提交 ${r.lagDays} 天（>${WARN_DAYS} 天）` });
  if (r.state === 'no-index') diagnostics.push({ rule: 'index_missing', severity: 'warning', subject: r.repo, evidence: r.note });
  if (r.state === 'missing-repo') diagnostics.push({ rule: 'repo_missing', severity: 'warning', subject: r.repo, evidence: r.note });
  if (r.state === 'no-git') diagnostics.push({ rule: 'repo_no_git', severity: 'warning', subject: r.repo, evidence: r.note });
}
// O4：回退披露放在逐仓诊断之后（不挤占 index_stale/no-index 等的诊断序）。
const fallbackRepos = rows.filter((r) => r.mtimeFallback).map((r) => r.repo);
if (fallbackRepos.length > 0) {
  diagnostics.push({ rule: 'mtime_fallback', severity: 'warning', subject: fallbackRepos.join(','), evidence: `无 last-sync.json（codegraph sync 未写构建 marker），改用 codegraph.db mtime 作回退源（${fallbackRepos.length} 仓：${fallbackRepos.join(',')}）；回退源可能被只读查询/checkpoint 刷新，建议按契约补 marker` });
}
// O4 落盘：<atlas>/data/<project>/codegraph-freshness.jsonl 只追加一行（无 atlas 语境 = 不落盘）。
const logged = [];
const logErrors = [];
const slimRows = rows.map((r) => ({ repo: r.repo, path: r.path, state: r.state, lagDays: r.lagDays, indexBuiltAt: r.indexBuiltAt, indexSource: r.indexSource, mtimeFallback: r.mtimeFallback || undefined }));
for (const sc of sidecars) {
  const ctx = resolveAtlasContext(sc);
  if (!ctx) continue;
  try {
    logged.push(appendJsonl(ctx.dataDir, 'codegraph-freshness.jsonl', {
      ts: new Date().toISOString(),
      command: 'check-codegraph-freshness',
      status: failCount > 0 ? 'failed' : 'ok',
      source: SOURCE,
      atlas: ctx.atlas,
      project: ctx.project,
      projectSource: ctx.projectSource,
      ...(ctx.projectReason ? { projectReason: ctx.projectReason } : {}),
      warnDays: WARN_DAYS,
      failDays: FAIL_DAYS,
      denominator: data.denominator,
      counts: data.counts,
      rows: slimRows,
      diagnostics: diagnostics.map((d) => ({ rule: d.rule, severity: d.severity, subject: d.subject || null })),
    }));
  } catch (e) {
    logErrors.push(sc + ' → ' + e.message);
  }
}
data.jsonl = { written: logged, errors: logErrors };
if (logErrors.length > 0) diagnostics.push({ rule: 'freshness_log_degraded', severity: 'warning', subject: logged.length === 0 ? '未落盘' : '部分落盘', evidence: 'JSONL 追加失败（降级不阻断判据）：' + logErrors.join('；') });
const receipt = { schemaVersion: 1, command: 'check-codegraph-freshness', status: failCount > 0 ? 'failed' : 'ok', data, diagnostics };
if (JSON_OUT) console.log(JSON.stringify(receipt, null, 2));
else {
  console.log(`${failCount > 0 ? 'freshness fail' : 'freshness ok'}：分母 ${data.denominator}；fresh ${data.counts.fresh} / aging ${data.counts.aging} / stale ${data.counts.stale} / no-index ${data.counts.noIndex} / 豁免 ${data.counts.exempt} / N/A ${data.counts.na}；判据源 ${SOURCE}`);
  if (data.jsonl.written.length > 0) console.log(`  历史落盘（append-only）：${data.jsonl.written.join(' , ')}`);
  for (const d of diagnostics) console.log(`  [${d.severity}] ${d.subject || ''} ${d.evidence}`.trim());
}
process.exit(failCount > 0 ? 1 : 0);
