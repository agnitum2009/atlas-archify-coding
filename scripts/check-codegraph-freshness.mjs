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
//
// 用法：node scripts/check-codegraph-freshness.mjs --sidecar <账> [--sidecar ...] [--repo <仓> ...] [--exempt <名> ...] [--warn-days N] [--fail-days N] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const multi = (k) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === k && argv[i + 1]) out.push(argv[i + 1]); return out; };
const one = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const JSON_OUT = argv.includes('--json');
const sidecars = multi('--sidecar');
const extraRepos = multi('--repo');
const exempt = new Set(multi('--exempt'));
const WARN_DAYS = one('--warn-days', 1);
const FAIL_DAYS = one('--fail-days', 3);

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

const repos = new Map(); // name → { path, sources: Set<string> }
const addRepo = (p, source) => {
  if (!p) return;
  const abs = path.resolve(p);
  const name = path.basename(abs);
  if (!repos.has(name)) repos.set(name, { path: abs, sources: new Set() });
  repos.get(name).sources.add(source);
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
  if (fs.existsSync(regPath)) {
    try {
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      for (const p of reg.projects || []) {
        if (p.sidecar === path.basename(sc) && p.sourcePath) addRepo(p.sourcePath, 'registry');
      }
    } catch (e) { fail('注册表非合法 JSON：' + regPath + '（' + e.message + '）'); }
  }
  if (anchorRepoCount === 0 && !fs.existsSync(regPath)) {
    // 该侧车对分母零贡献——如实披露，不计入 0
  }
}
for (const r of extraRepos) addRepo(r, 'explicit');

// ---------- 逐仓判新鲜 ----------
function newestIndexMtime(repoPath) {
  const dir = path.join(repoPath, '.codegraph');
  if (!fs.existsSync(dir)) return null;
  let newest = 0;
  for (const f of fs.readdirSync(dir)) {
    const abs = path.join(dir, f);
    try { newest = Math.max(newest, fs.statSync(abs).mtimeMs); } catch { /* 忽略 */ }
  }
  return newest || null;
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
for (const [name, info] of [...repos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (exempt.has(name)) { rows.push({ repo: name, state: 'exempt', sources: [...info.sources] }); continue; }
  if (!fs.existsSync(info.path)) { rows.push({ repo: name, state: 'missing-repo', sources: [...info.sources], note: '仓目录不存在' }); continue; }
  const idx = newestIndexMtime(info.path);
  if (idx === null) { rows.push({ repo: name, state: 'no-index', sources: [...info.sources], note: '锚/注册表指向但无索引——提名能力缺失（读码靠盲翻，是 token 重灾区）' }); warnCount += 1; continue; }
  const commitTs = lastCommitTs(info.path);
  if (commitTs === null) { rows.push({ repo: name, state: 'no-git', sources: [...info.sources], note: '无 git 提交可比对' }); continue; }
  const lagDays = (commitTs * 1000 - idx) / 86400000;
  const state = lagDays > FAIL_DAYS ? 'stale' : lagDays > WARN_DAYS ? 'aging' : 'fresh';
  if (state === 'stale') failCount += 1;
  if (state === 'aging') warnCount += 1;
  rows.push({ repo: name, state, lagDays: Number(lagDays.toFixed(2)), indexMtime: new Date(idx).toISOString(), lastCommit: new Date(commitTs * 1000).toISOString(), sources: [...info.sources] });
}

const denominatorEmpty = repos.size === 0;
const data = {
  warnDays: WARN_DAYS, failDays: FAIL_DAYS,
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
const receipt = { schemaVersion: 1, command: 'check-codegraph-freshness', status: failCount > 0 ? 'failed' : 'ok', data, diagnostics };
if (JSON_OUT) console.log(JSON.stringify(receipt, null, 2));
else {
  console.log(`${failCount > 0 ? 'freshness fail' : 'freshness ok'}：分母 ${data.denominator}；fresh ${data.counts.fresh} / aging ${data.counts.aging} / stale ${data.counts.stale} / no-index ${data.counts.noIndex} / 豁免 ${data.counts.exempt} / N/A ${data.counts.na}`);
  for (const d of diagnostics) console.log(`  [${d.severity}] ${d.subject || ''} ${d.evidence}`.trim());
}
process.exit(failCount > 0 ? 1 : 0);
