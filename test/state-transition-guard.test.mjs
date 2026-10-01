// transition 前态一致性与 settle 事件守卫回归（2026-09-15 独立审核发现）：
// 修复前 state transition 只校验「提供的 from/to 是否为合法迁移」，不校验 --from 是否等于
// 节点当前轴值——伪造 --from 可跳过中间态直达 verified；ledger→settled 也可绕过 settle
// 事件直达，破坏跨轴双写不变量。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, sidecarPath) {
  const all = args.concat(['--sidecar', sidecarPath]);
  const res = spawnSync(process.execPath, [BIN].concat(all), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

test('transition 的 --from 必须等于节点当前轴值', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-transition-guard-'));
  const sidecar = path.join(dir, 'atlas-state.json');

  const created = run(['state', 'set', '--node', 'tm1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(created.code, 0);

  // 节点实际为 in_progress；伪造 from=planned 要求直达 verified（修复前 exit 0）
  const forged = run(['state', 'transition', '--node', 'tm1', '--axis', 'progress', '--from', 'planned', '--to', 'verified', '--reason', '伪造前态', '--owner', '一线席位'], sidecar);
  assert.equal(forged.code, 1);
  assert.equal(forged.receipt.diagnostics[0].rule, 'transition_from_mismatch');

  // 伪造被拒后状态与历史均未推进
  const after = run(['state', 'get', '--node', 'tm1'], sidecar);
  assert.equal(after.receipt.data.progress, 'in_progress');
  assert.equal(after.receipt.data.historyCount, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('transition 直达 ledger→settled 必须经 settle/import 事件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-transition-guard-'));
  const sidecar = path.join(dir, 'atlas-state.json');

  const ledger = run(['state', 'set', '--node', 'tm2', '--axis', 'ledger', '--value', 'backlog', '--reason', '挂账', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(ledger.code, 0);

  // backlog→settled 表上合法，但 transition 直达绕过跨轴双写（修复前 exit 0）
  const direct = run(['state', 'transition', '--node', 'tm2', '--axis', 'ledger', '--from', 'backlog', '--to', 'settled', '--reason', '绕过闭环', '--owner', '一线席位'], sidecar);
  assert.equal(direct.code, 1);
  assert.equal(direct.receipt.diagnostics[0].rule, 'settled_requires_event');

  const after = run(['state', 'get', '--node', 'tm2'], sidecar);
  assert.equal(after.receipt.data.ledger, 'backlog');

  fs.rmSync(dir, { recursive: true, force: true });
});

// 0.22.0（ADD-SPEC §2.4.2）改钉：transition 不接受 --correction（纠错唯一入口 = state set），bad_args 零写入。
test('S3 transition rejects --correction as bad_args (single correction entry is state set)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-transition-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sidecar = path.join(dir, 'atlas-state.json');
  assert.equal(run(['state', 'set', '--node', 'n', '--axis', 'ledger', '--value', 'backlog', '--reason', 'start', '--owner', '一线席位', '--class', 'task'], sidecar).code, 0);
  const before = fs.readFileSync(sidecar, 'utf8');
  const result = run(['state', 'transition', '--node', 'n', '--axis', 'ledger', '--from', 'backlog', '--to', 'settled', '--reason', 'repair', '--owner', '一线席位', '--correction'], sidecar);
  assert.equal(result.code, 1, result.stdout);
  assert.equal(result.receipt.diagnostics[0].rule, 'bad_args');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
});

for (const [from, to] of [['in_progress', 'verified'], ['planned', 'cancelled']]) {
  test('S3 transition cannot reach zero-evidence ' + to + ' (with or without --correction)', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-transition-guard-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const sidecar = path.join(dir, 'atlas-state.json');
    assert.equal(run(['state', 'set', '--node', 'n', '--axis', 'progress', '--value', from, '--owner', '一线席位', '--reason', 'start', '--class', 'task'], sidecar).code, 0);
    const before = fs.readFileSync(sidecar, 'utf8');
    const args = ['state', 'transition', '--node', 'n', '--axis', 'progress', '--from', from, '--to', to, '--owner', '一线席位', '--reason', 'claim'];
    const result = run(args, sidecar);
    assert.equal(result.code, 1, result.stdout);
    assert.equal(result.receipt.diagnostics[0].rule, to + '_requires_evidence');
    const corrected = run([...args, '--correction'], sidecar);
    assert.equal(corrected.code, 1, corrected.stdout);
    assert.equal(corrected.receipt.diagnostics[0].rule, 'bad_args');
    assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
  });
}

test('transition rejects forbidden self-loops while set restatements and class table self-edges remain valid', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-self-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sidecar = path.join(dir, 'state.json'), proof = path.join(dir, 'proof.ts');
  fs.writeFileSync(proof, 'consumer-proof\n');
  const axes = {
    progress: ['planned', 'in_progress', 'blocked', 'verified', 'cancelled'],
    truth: ['candidate', 'pending_confirmation', 'effective', 'closed'],
    ledger: ['clean', 'backlog', 'settled'],
  };
  for (const [axis, states] of Object.entries(axes)) {
    for (const value of states) {
      const node = { owner: '一线席位', class: 'task', progress: 'in_progress', truth: 'candidate', ledger: 'clean',
        evidence: [proof + ':1'], history: [], [axis]: value };
      if (node.ledger === 'settled') node.progress = 'verified';
      fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: { n: node } }));
      const before = fs.readFileSync(sidecar, 'utf8');
      const transition = run(['state', 'transition', '--node', 'n', '--axis', axis, '--from', value, '--to', value,
        '--reason', 'same value', '--owner', '一线席位'], sidecar);
      assert.equal(transition.code, 1, transition.stdout);
      assert.equal(transition.receipt.diagnostics[0].rule, 'illegal_transition');
      assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
      const restatement = run(['state', 'set', '--node', 'n', '--axis', axis, '--value', value,
        '--reason', 'restate', '--owner', '一线席位'], sidecar);
      assert.equal(restatement.code, 0, restatement.stdout);
      assert.equal(JSON.parse(fs.readFileSync(sidecar, 'utf8')).nodes.n[axis], value);
    }
  }
  const classified = run(['state', 'transition', '--node', 'n', '--axis', 'class', '--from', 'task', '--to', 'task',
    '--reason', 'class table self-edge', '--owner', '一线席位'], sidecar);
  assert.equal(classified.code, 0, classified.stdout);
  assert.equal(JSON.parse(fs.readFileSync(sidecar, 'utf8')).nodes.n.history.at(-1).kind, 'transition');
});
