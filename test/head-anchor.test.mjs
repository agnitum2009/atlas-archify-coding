// O2 牙齿（2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O2）：
// 锚对 HEAD 校验——progress=verified 节点的锚须在 git HEAD 存在且行内容与工作树一致。
// 真实 git 仓 + 真实子进程 report/doctor；四态：ok / content-mismatch（error）/ uncommitted（error）/
// gitignored 与 no-git（不 error，计数披露）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args) {
  // These tests check evidence, so doctor must not depend on an installed archify.
  const stubDir = args[0] === 'doctor' ? fs.mkdtempSync(path.join(os.tmpdir(), 'head-archify-')) : null;
  const env = { ...process.env };
  if (stubDir) {
    env.ARCHIFY_BIN = path.join(stubDir, 'archify.mjs');
    fs.writeFileSync(env.ARCHIFY_BIN, 'process.exit(0);\n');
  }
  let res;
  try { res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env }); }
  finally { if (stubDir) fs.rmSync(stubDir, { recursive: true, force: true }); }
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout };
}

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-o2-'));
  const repo = path.join(dir, 'code');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'line1\nline2\nline3\n');
  const git = (a) => spawnSync('git', ['-C', repo].concat(a), { encoding: 'utf8' });
  git(['init', '-q']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  return { dir, repo, git };
}

function seedSidecar(dir, nodes) {
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: 't', nodes, revision: 0 }, null, 2) + '\n');
  return sidecar;
}

const node = (evidence) => ({ owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence, history: [{ at: '2026-09-14T00:00:00.000Z', kind: 'settle' }] });

test('O2 一致：锚行在工作树与 HEAD 相同 → report 绿、evidenceHead.ok=true、doctor 检查过', () => {
  const { dir, repo } = gitRepo();
  const sidecar = seedSidecar(dir, { 't-ok': node([path.join(repo, 'src', 'a.ts') + ':2']) });
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.receipt.data.evidenceHead.ok, true);
  assert.equal(r.receipt.data.evidenceHead.checkedNodes, 1);
  assert.equal(r.receipt.data.evidenceHead.counts.ok, 1);
  const d = run(['doctor', '--sidecar', sidecar]);
  assert.equal(d.code, 0, d.stdout);
  const chk = d.receipt.data.checks.find((c) => c.name === 'head-anchor-consistency');
  assert.equal(chk.ok, true, JSON.stringify(chk));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O2 工作树≠HEAD（行内容漂移未提交）→ report error a3-head-mismatch；doctor warning 级不阻断', () => {
  const { dir, repo } = gitRepo();
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'line1\nchanged-in-tree\nline3\n'); // 未提交的工作树改动
  const sidecar = seedSidecar(dir, { 't-drift': node([path.join(repo, 'src', 'a.ts') + ':2']) });
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 1, '工作树≠HEAD 必须 error：' + r.stdout);
  const hit = r.receipt.diagnostics.find((d) => d.rule === 'a3-head-mismatch');
  assert.ok(hit, '须发 a3-head-mismatch：' + r.stdout);
  assert.equal(hit.severity, 'error');
  assert.ok(hit.evidence.includes('工作树'), hit.evidence);
  assert.equal(r.receipt.data.evidenceHead.ok, false);
  assert.equal(r.receipt.data.evidenceHead.contentMismatch, 1);

  const d = run(['doctor', '--sidecar', sidecar]);
  assert.equal(d.code, 0, 'doctor 数据债不阻断环境自检：' + d.stdout);
  const chk = d.receipt.data.checks.find((c) => c.name === 'head-anchor-consistency');
  assert.equal(chk.ok, false);
  assert.equal(chk.warning, true);
  assert.ok(chk.detail.includes('a3-head-mismatch'), chk.detail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O2 工作树有 / HEAD 无（未提交新文件）→ report error a1-evidence-uncommitted；--brief 只出计数', () => {
  const { dir, repo } = gitRepo();
  fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'fresh\n'); // 未提交、未 ignore
  const sidecar = seedSidecar(dir, { 't-unc': node([path.join(repo, 'src', 'b.ts') + ':1']) });
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 1, '未提交文件当证据必须 error：' + r.stdout);
  const hit = r.receipt.diagnostics.find((d) => d.rule === 'a1-evidence-uncommitted');
  assert.ok(hit, '须发 a1-evidence-uncommitted：' + r.stdout);
  assert.equal(r.receipt.data.evidenceHead.uncommitted, 1);
  assert.deepEqual(r.receipt.data.evidenceHead.samples.uncommitted, ['t-unc']);

  const brief = run(['report', '--sidecar', sidecar, '--brief', '--no-trace']);
  assert.equal(brief.code, 1);
  assert.equal(brief.receipt.data.evidenceHead.uncommitted, 1);
  assert.equal(brief.receipt.data.evidenceHead.samples, undefined, '--brief 不出样例数组');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O2 .gitignore 生成物（artifacts 类）与 no-git 锚：不发 error，计数单列披露', () => {
  const { dir, repo } = gitRepo();
  fs.writeFileSync(path.join(repo, '.gitignore'), 'gen/\n');
  fs.mkdirSync(path.join(repo, 'gen'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'gen', 'out.html'), '<html></html>\n');
  const plain = path.join(dir, 'plain');
  fs.mkdirSync(plain);
  fs.writeFileSync(path.join(plain, 'p.md'), 'no git here\n');
  const sidecar = seedSidecar(dir, {
    't-ign': node([path.join(repo, 'gen', 'out.html') + ':1']),
    't-nogit': node([path.join(plain, 'p.md') + ':1']),
  });
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 0, 'gitignored / no-git 不得红：' + r.stdout);
  assert.equal(r.receipt.data.evidenceHead.gitignored, 1);
  assert.equal(r.receipt.data.evidenceHead.noGit, 1);
  assert.equal(r.receipt.data.evidenceHead.contentMismatch, 0);
  assert.equal(r.receipt.data.evidenceHead.uncommitted, 0);
  assert.ok(r.receipt.data.warnings.some((w) => w.rule === 'a3-head-mismatch' && w.severity === 'warning'), 'gitignored 须发 warning 点名');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O2 未声称对齐的节点（in_progress/无 progress）不进 HEAD 判据（不误报）', () => {
  const { dir, repo } = gitRepo();
  fs.writeFileSync(path.join(repo, 'src', 'c.ts'), 'uncommitted but not claimed\n');
  const sidecar = seedSidecar(dir, {
    't-wip': { owner: 'o', progress: 'in_progress', truth: 'candidate', ledger: 'clean', evidence: [path.join(repo, 'src', 'c.ts') + ':1'], history: [] },
  });
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.receipt.data.evidenceHead.checkedNodes, 0);
  assert.equal(r.receipt.data.evidenceHead.uncommitted, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
