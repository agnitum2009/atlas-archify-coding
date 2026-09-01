// P-0（0.15.0，codegraph 新鲜度闸）回归钉：分母/判据/0·0口径/豁免全测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = new URL('../scripts/check-codegraph-freshness.mjs', import.meta.url).pathname;

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', env: { ...process.env, ...env } });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 文本模式 */ }
  return { code: res.status, receipt, out: res.stdout + res.stderr };
}

function makeRepo(name, { commitDaysAgo = 0, indexDaysAgo = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-' + name + '-'));
  const repo = path.join(dir, name);
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  const when = new Date(Date.now() - commitDaysAgo * 86400000).toISOString();
  const env = { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  const git = (args, e) => spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8', env: { ...process.env, ...env } });
  git(['init', '-q']); git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  if (indexDaysAgo !== null) {
    fs.mkdirSync(path.join(repo, '.codegraph'), { recursive: true });
    const db = path.join(repo, '.codegraph', 'codegraph.db');
    fs.writeFileSync(db, 'idx');
    const t = new Date(Date.now() - indexDaysAgo * 86400000);
    fs.utimesSync(db, t, t);
  }
  return { dir, repo };
}

test('新鲜：索引新于提交 → fresh，exit 0', () => {
  const { repo } = makeRepo('r1', { commitDaysAgo: 2, indexDaysAgo: 0 });
  const r = run(['--repo', repo, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.status, 'ok');
  assert.equal(r.receipt.data.counts.fresh, 1);
});

test('陈旧：索引比提交旧 5 天（>fail-days 3）→ stale，exit 1 且点名仓', () => {
  const { repo } = makeRepo('r2', { commitDaysAgo: 0, indexDaysAgo: 5 });
  const r = run(['--repo', repo, '--json']);
  assert.equal(r.code, 1, '陈旧必须红：' + r.out);
  assert.equal(r.receipt.diagnostics[0].rule, 'index_stale');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('天'));
});

test('将旧不陈：lag 2 天（>1 ≤3）→ aging warning，exit 0', () => {
  const { repo } = makeRepo('r3', { commitDaysAgo: 0, indexDaysAgo: 2 });
  const r = run(['--repo', repo, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.data.counts.aging, 1);
});

test('分母口径：锚指向的仓自动纳入分母；无锚仓不入分母', () => {
  const { repo, dir } = makeRepo('r4', { commitDaysAgo: 0, indexDaysAgo: 0 });
  fs.writeFileSync(path.join(repo, 'x.ts'), 'export const x=1;\n');
  const git = (args) => spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8' });
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x']);
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, JSON.stringify({ schemaVersion: 1, nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repo, 'x.ts') + ':1'], history: [] } }, revision: 1 }));
  const r = run(['--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.data.counts.fresh, 1, '锚指向仓须入分母：' + r.out);
});

test('无索引仓 → no-index warning（分母在册但提名能力缺失），不红', () => {
  const { repo } = makeRepo('r5', { commitDaysAgo: 0, indexDaysAgo: null });
  const r = run(['--repo', repo, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.data.counts.noIndex, 1);
  assert.equal(r.receipt.diagnostics[0].rule, 'index_missing');
});

test('豁免：--exempt 的仓不进判据也不谎报；分母空 → N/A 不报 0', () => {
  const { repo } = makeRepo('r6', { commitDaysAgo: 0, indexDaysAgo: 9 });
  const name = path.basename(repo);
  const r = run(['--repo', repo, '--exempt', name, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.data.counts.exempt, 1);
  assert.equal(r.receipt.data.counts.stale, 0);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-empty-'));
  const r2 = run(['--repo', path.join(empty, 'nope')], { });
  assert.equal(r2.code, 0);
  assert.ok(r2.out.includes('仓目录不存在'), '不存在的仓须明说：' + r2.out);
});

test('用法守卫：无任何输入 → exit 2（不猜路径）', () => {
  const r = run(['--json']);
  assert.equal(r.code, 2);
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
});
