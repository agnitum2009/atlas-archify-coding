// 审核修复批（2026-09-18）：每条测试对应一项已复现的缺口；先红后绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diag, autoTrace } from '../lib/cli-util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin/atlas-engine.mjs');

function run(args, { cwd, env } = {}) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd, env: env || process.env });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpdir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 缺口 1：state set 不带 --sidecar 时在 cwd 悄悄建幽灵账本（契约「仅 set 可建账」须以显式 --sidecar 为前提）。
test('state set 缺省侧车路径不存在时不建账：exit 1 sidecar_missing 且 cwd 无新文件', (t) => {
  const cwd = tmpdir(t, 'atlas-ghost-');
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'class', '--value', 'task', '--reason', 'r', '--owner', 'o'], { cwd });
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.status, 'failed');
  assert.equal(r.receipt.diagnostics[0].rule, 'sidecar_missing');
  assert.equal(fs.existsSync(path.join(cwd, 'atlas-state.json')), false, 'cwd 不得出现幽灵账本');
});

test('state set 显式 --sidecar 指向不存在文件仍可初始化账本（契约保留）', (t) => {
  const dir = tmpdir(t, 'atlas-init-');
  const sidecar = path.join(dir, 'atlas-state.json');
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'class', '--value', 'task', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(fs.existsSync(sidecar), true);
});

// 缺口 6：存量节点无 truth 字段时，transition --from candidate 被 transition_from_mismatch 拒绝（契约：缺失/null 视为 candidate）。
test('transition：节点 truth 缺失按 candidate 处理，--from candidate 放行', (t) => {
  const dir = tmpdir(t, 'atlas-legacy-');
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({
    schemaVersion: 1, atlas: null, revision: 0,
    nodes: { legacy: { owner: 'o', progress: 'planned', ledger: 'clean', evidence: [], history: [] } },
  }, null, 2));
  const receipt = path.join(dir, 'receipt.txt');
  fs.writeFileSync(receipt, 'ok\n');
  const r = run(['state', 'transition', '--node', 'legacy', '--axis', 'truth', '--from', 'candidate', '--to', 'pending_confirmation', '--reason', 'r', '--owner', 'o', '--receipt', receipt, '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.receipt.data.to, 'pending_confirmation');
});

// 缺口 7：diag() 丢弃第 4 个参数 severity。
test('diag：第 4 参 severity 生效，缺省仍为 error', () => {
  assert.equal(diag('x', 'm', 's').severity, 'error');
  assert.equal(diag('x', 'm', 's', 'warning').severity, 'warning');
});

test('settle：a1-settle-unbound 诊断为 warning 级（成功回执不得携带 error 级诊断）', (t) => {
  const dir = tmpdir(t, 'atlas-unbound-');
  const atlas = path.join(dir, 'atlas');
  assert.equal(run(['init', '--dir', atlas, '--title', 'Demo', '--diagram-id', 'demo']).code, 0);
  const sidecar = path.join(atlas, 'state/atlas-state.json');
  const proof = path.join(atlas, 'evidence/demo/proof.txt');
  fs.writeFileSync(proof, 'evidence\n');
  // 未分类节点只能存量存在（O3 起新建必带 class），故直接写入侧车（保留 revision）。
  const sc = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  sc.nodes.u1 = { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [proof + ':1'], history: [] };
  fs.writeFileSync(sidecar, JSON.stringify(sc, null, 2));
  const r = run(['state', 'settle', '--node', 'u1', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const d = r.receipt.data.receipt.diagnostics;
  assert.ok(Array.isArray(d) && d.length === 1, '应有一条 a1-settle-unbound 诊断');
  assert.equal(d[0].rule, 'a1-settle-unbound');
  assert.equal(d[0].severity, 'warning');
});

// 缺口 5：图谱根内的符号链接指向白名单外文件，锚根判定只 normalize 不 realpath 而放行。
test('evidence-add：根内符号链接指向根外文件 = anchor_root_denied', (t) => {
  const dir = tmpdir(t, 'atlas-symlink-');
  const atlas = path.join(dir, 'atlas');
  assert.equal(run(['init', '--dir', atlas, '--title', 'Demo', '--diagram-id', 'demo']).code, 0);
  const sidecar = path.join(atlas, 'state/atlas-state.json');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'secret\n');
  const link = path.join(atlas, 'evidence/demo/link.txt');
  fs.symlinkSync(secret, link);
  assert.equal(run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--class', 'task', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]).code, 0);
  const direct = run(['state', 'evidence-add', '--node', 'n1', '--locator', secret + ':1', '--sidecar', sidecar]);
  assert.equal(direct.receipt.diagnostics[0].rule, 'anchor_root_denied', '直接路径应被拒（既有行为）');
  const viaLink = run(['state', 'evidence-add', '--node', 'n1', '--locator', link + ':1', '--sidecar', sidecar]);
  assert.equal(viaLink.code, 1, viaLink.stdout);
  assert.equal(viaLink.receipt.diagnostics[0].rule, 'anchor_root_denied');
});

// 缺口 2：图谱在 .git 树内但 PATH 上无 git 可执行文件时，全部 verified 锚被误判 uncommitted → report 误红。
test('report：git 可执行文件不可用时锚归免检（no-git），不误报 a1-evidence-uncommitted', (t) => {
  const dir = tmpdir(t, 'atlas-nogit-');
  const gitOk = spawnSync('git', ['init', '-q', dir]);
  if (gitOk.status !== 0) { t.skip('本机无 git'); return; }
  const atlas = path.join(dir, 'atlas');
  assert.equal(run(['init', '--dir', atlas, '--title', 'Demo', '--diagram-id', 'demo']).code, 0);
  const sidecar = path.join(atlas, 'state/atlas-state.json');
  const proof = path.join(atlas, 'evidence/demo/proof.txt');
  fs.writeFileSync(proof, 'evidence\n');
  assert.equal(run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--class', 'task', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]).code, 0);
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  assert.equal(run(['state', 'settle', '--node', 'n1', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]).code, 0);
  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init']);
  const withGit = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(withGit.receipt.status, 'ok', withGit.stdout);
  const nogitBin = path.join(dir, 'nogit-bin');
  fs.mkdirSync(nogitBin);
  fs.symlinkSync(process.execPath, path.join(nogitBin, path.basename(process.execPath)));
  const env = { PATH: nogitBin, HOME: process.env.HOME || dir };
  const withoutGit = run(['report', '--sidecar', sidecar, '--no-trace'], { env });
  assert.equal(withoutGit.receipt.status, 'ok', withoutGit.stdout);
  assert.ok(!withoutGit.stdout.includes('a1-evidence-uncommitted'), 'git 不可用不得判为未提交');
  assert.equal(withoutGit.receipt.data.evidenceHead.noGit, 1);
});

// 缺口 4：契约新鲜度门禁只识别 diag('x' / rule: 'x'，经 requireRule('x' 与三元表达式发射的码被当成「代码无字面量」。
test('verify-contract-freshness：经助手函数/三元发射的错误码被识别为代码字面量', () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-contract-freshness.mjs')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  for (const code of ['cancelled_requires_evidence', 'settled_requires_event', 'receipt_not_found', 'receipt_unreadable']) {
    assert.ok(!(res.stdout + res.stderr).includes('附录 A 有而代码无字面量：' + code), '仍被误报为无字面量：' + code + '\n' + res.stderr);
  }
});

// 缺口 12：autoTrace 在 try 外调用 canonicalSidecarPath，断链 symlink 侧车会把通过的主结果变成 exit 1。
test('autoTrace：侧车路径不可解析时降级为 trace_degraded warning 而不抛出', (t) => {
  const dir = tmpdir(t, 'atlas-dangling-');
  const dangling = path.join(dir, 'state.json');
  fs.symlinkSync(path.join(dir, 'does-not-exist.json'), dangling);
  let out;
  assert.doesNotThrow(() => { out = autoTrace('gate', { sidecar: dangling }, { params: {}, result: {} }); });
  assert.equal(out && out.rule, 'trace_degraded');
  assert.equal(out.severity, 'warning');
});

// 缺口 15：USAGE 示例把证据落在 evidence/ 根下，跑完 doctor 直接 atlas-layout 报错。
test('USAGE 示例跑完后 doctor 的 atlas-layout 检查为 ok', (t) => {
  const dir = tmpdir(t, 'atlas-usage-doctor-');
  const usage = fs.readFileSync(path.join(ROOT, 'docs/USAGE.md'), 'utf8');
  const region = usage.match(/<!-- atlas-example:start -->([\s\S]*?)<!-- atlas-example:end -->/);
  const block = [...region[1].matchAll(/```bash\n([\s\S]*?)```/g)][0][1];
  const result = spawnSync('bash', ['-c', block], { cwd: dir, encoding: 'utf8', env: { ...process.env, ATLAS_ENGINE_BIN: BIN } });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const doctor = run(['doctor', '--sidecar', 'demo-atlas/state/atlas-state.json', '--atlas', 'demo-atlas'], { cwd: dir });
  const layout = doctor.receipt.data.checks.find((c) => c.name === 'atlas-layout');
  assert.ok(layout, 'doctor 应含 atlas-layout 检查');
  assert.equal(layout.ok, true, layout.detail);
});
