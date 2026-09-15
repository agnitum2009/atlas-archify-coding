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

// ---------- O4（2026-09-14 设计件 §2 O4）：判据换源 + JSONL append-only ----------

// 造一个「看起来像 atlas」的目录：<atlas>/state/{projects.json, atlas-<project>.json}
function makeAtlas(project, repoAbs) {
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-atlas-'));
  fs.mkdirSync(path.join(atlas, 'state'), { recursive: true });
  fs.writeFileSync(path.join(atlas, 'state', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project, umbrella: project + '-add', sourcePath: repoAbs, sidecar: 'atlas-' + project + '.json' }] }, null, 2));
  const sidecar = path.join(atlas, 'state', 'atlas-' + project + '.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: { [project + '-n1']: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repoAbs, 'a.ts') + ':1'], history: [] } } }));
  return { atlas, sidecar, stateDir: path.join(atlas, 'state') };
}

function writeMarker(repo, daysAgo) {
  fs.mkdirSync(path.join(repo, '.codegraph'), { recursive: true });
  const marker = path.join(repo, '.codegraph', 'last-sync.json');
  fs.writeFileSync(marker, JSON.stringify({ at: new Date(Date.now() - daysAgo * 86400000).toISOString(), tool: 'codegraph sync' }) + '\n');
  return marker;
}

test('O4 marker 优先：last-sync.json 时间戳入判据（source=marker）；db 更新时取二者较新（db-mtime-newer）', () => {
  const { repo } = makeRepo('m1', { commitDaysAgo: 0, indexDaysAgo: 5 }); // db mtime = 5 天前
  writeMarker(repo, 0); // marker = 现在
  const r = run(['--repo', repo, '--json']);
  assert.equal(r.code, 0, r.out);
  const row = r.receipt.data.rows[0];
  assert.equal(row.indexSource, 'marker', '有 marker 且更新時须取 marker：' + r.out);
  assert.equal(row.state, 'fresh');

  // 反过来：db mtime 较新 → 取 db（二者较新），source=db-mtime-newer，不当成假绿以外的异类
  const { repo: repo2 } = makeRepo('m2', { commitDaysAgo: 0, indexDaysAgo: 0 });
  writeMarker(repo2, 9);
  const r2 = run(['--repo', repo2, '--json']);
  assert.equal(r2.receipt.data.rows[0].indexSource, 'db-mtime-newer');
  assert.equal(r2.receipt.data.rows[0].state, 'fresh');
});

test('O4 不再取目录 max mtime：只读查询/旁文件被摸新不得刷绿（真 lag 5 天必 stale）', () => {
  const { repo } = makeRepo('m3', { commitDaysAgo: 0, indexDaysAgo: 5 });
  // 模拟「一次只读查询摸了目录内旁文件（-shm/-wal/日志）」：造一个新 mtime 的旁文件
  fs.writeFileSync(path.join(repo, '.codegraph', 'codegraph.db-shm'), 'touch');
  const r = run(['--repo', repo, '--json']);
  assert.equal(r.code, 1, '目录内旁文件被摸新不得刷绿（旧 newestIndexMtime 的假绿形态）：' + r.out);
  assert.equal(r.receipt.data.rows[0].state, 'stale');
  assert.equal(r.receipt.data.rows[0].indexSource, 'db-mtime');
  assert.equal(r.receipt.data.rows[0].mtimeFallback, true, '无 marker 须显式标 mtime 回退');
  assert.ok(r.receipt.diagnostics.some((d) => d.rule === 'mtime_fallback'), '回退须发 mtime_fallback warning');
});

test('O4 --source mtime（回滚档）：只读 db mtime，不发 mtime_fallback；非法值 exit 2', () => {
  const { repo } = makeRepo('m4', { commitDaysAgo: 0, indexDaysAgo: 5 });
  writeMarker(repo, 0);
  const r = run(['--repo', repo, '--json', '--source', 'mtime']);
  assert.equal(r.code, 1, '显式 mtime 档只认 db mtime → 5 天前 = stale：' + r.out);
  assert.equal(r.receipt.data.source, 'mtime');
  assert.ok(!r.receipt.diagnostics.some((d) => d.rule === 'mtime_fallback'));
  const bad = run(['--repo', repo, '--json', '--source', 'nope']);
  assert.equal(bad.code, 2);
  assert.equal(bad.receipt.diagnostics[0].rule, 'bad_args');
});

test('O4 落盘：<atlas>/data/<project>/codegraph-freshness.jsonl 只追加一行/次（目录不存在即建）', () => {
  const { repo } = makeRepo('m5', { commitDaysAgo: 0, indexDaysAgo: 0 });
  writeMarker(repo, 0);
  const { atlas, sidecar } = makeAtlas('demo', repo);
  const logPath = path.join(atlas, 'data', 'demo', 'codegraph-freshness.jsonl');
  assert.ok(!fs.existsSync(logPath), '前置：data/<project>/ 不存在');

  const r1 = run(['--sidecar', sidecar, '--json']);
  assert.equal(r1.code, 0, r1.out);
  assert.ok(fs.existsSync(logPath), '须自建目录并落盘：' + r1.out);
  const lines1 = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines1.length, 1, '一次运行一行');
  const line = JSON.parse(lines1[0]);
  assert.equal(line.command, 'check-codegraph-freshness');
  assert.equal(line.project, 'demo');
  assert.equal(line.atlas, atlas);
  assert.equal(line.source, 'manifest');
  assert.equal(line.counts.fresh, 1);
  assert.equal(line.rows[0].repo, path.basename(repo));
  assert.equal(line.rows[0].indexSource, 'marker');

  const r2 = run(['--sidecar', sidecar, '--json']);
  assert.equal(r2.code, 0, r2.out);
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 2, '只追加不覆盖（历史可回溯）');
  assert.equal(r1.receipt.data.jsonl.written[0], logPath, '回执须报落点');
});

test('O4 无 atlas 语境不落盘（自由侧车零副作用）；project 名优先取侧车文件名', () => {
  const { repo } = makeRepo('m6', { commitDaysAgo: 0, indexDaysAgo: 0 });
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-plain-'));
  const sc = path.join(plain, 'sc.json');
  fs.writeFileSync(sc, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repo, 'a.ts') + ':1'], history: [] } } }));
  const r = run(['--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.receipt.data.jsonl.written, [], '非 atlas 版式不得落盘');
  assert.ok(!fs.existsSync(path.join(plain, 'data')), '不得凭空造 data/ 目录');
});

test('B3 canonical source-only registry covers two same-name repos without activating gate', async () => {
  const {loadProjectGate} = await import('../lib/project-gate.mjs');
  const a = makeRepo('demo',{commitDaysAgo:1,indexDaysAgo:0});
  const b = makeRepo('demo',{commitDaysAgo:0,indexDaysAgo:8});
  try {
    const sc = path.join(a.dir,'sc.json');
    fs.writeFileSync(sc,JSON.stringify({nodes:{}}));
    const reg = path.join(a.dir,'projects.json');
    const bytes = JSON.stringify({schemaVersion:1,projects:[{project:'demo',sourcePath:a.repo},{project:'demo',sourcePath:b.repo}]});
    fs.writeFileSync(reg,bytes);
    const alias = path.join(a.dir,'alias'); fs.symlinkSync(a.repo,alias,'dir');
    const r = run(['--sidecar',sc,'--repo',alias,'--json']);
    assert.equal(r.code,1,r.out);
    assert.equal(r.receipt.data.denominator,'2 仓');
    assert.equal(r.receipt.data.counts.stale,1);
    assert.deepEqual(r.receipt.data.rows.map(r=>r.path).sort(),[a.repo,b.repo].sort());
    assert.equal(fs.readFileSync(reg,'utf8'),bytes);
    assert.equal(loadProjectGate(sc),null);
  } finally { for (const x of [a,b]) fs.rmSync(x.dir,{recursive:true,force:true}); }
});
