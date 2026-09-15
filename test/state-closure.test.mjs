import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-closure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sidecar = path.join(dir, 'atlas-state.json');
  const run = (args) => {
    const res = spawnSync(process.execPath, [BIN, 'state', ...args, '--sidecar', sidecar], { encoding: 'utf8' });
    return { code: res.status, receipt: JSON.parse(res.stdout) };
  };
  const read = () => JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(run(['set', '--node', 'n', '--axis', 'progress', '--value', 'in_progress', '--class', 'debt', '--owner', 'owner', '--reason', 'start']).code, 0);
  const evidence = path.join(dir, 'evidence.md');
  fs.writeFileSync(evidence, 'proof\n');
  const addEvidence = (locator = evidence + ':1') => assert.equal(run(['evidence-add', '--node', 'n', '--locator', locator]).code, 0);
  const settle = (owner = 'owner') => run(['settle', '--node', 'n', '--owner', owner, '--reason', 'close']);
  return { sidecar, run, read, addEvidence, settle };
}
function assertClosed(f, before) {
  const result = f.settle();
  assert.equal(result.code, 0, JSON.stringify(result.receipt));
  const after = f.read();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.nodes.n.progress, 'verified');
  assert.equal(after.nodes.n.ledger, 'settled');
  assert.equal(after.nodes.n.history.length, before.nodes.n.history.length + 1);
  const event = after.nodes.n.history.at(-1);
  assert.equal(event.kind, 'settle');
  assert.deepEqual(event.from, { progress: before.nodes.n.progress, ledger: before.nodes.n.ledger });
  assert.deepEqual(event.to, { progress: 'verified', ledger: 'settled' });
  assert.equal(after.notices.length, (before.notices || []).length + 1);
  assert.equal(after.notices.at(-1).kind, 'settled');
  assert.equal(after.notices.at(-1).node, 'n');
  const bytes = fs.readFileSync(f.sidecar);
  assert.equal(f.settle().code, 1);
  assert.deepEqual(fs.readFileSync(f.sidecar), bytes);
}

test('独立验证后待销账可见且无需 correction 完成闭环', (t) => {
  const f = fixture(t);
  assert.equal(f.run(['set', '--node', 'n', '--axis', 'ledger', '--value', 'backlog', '--owner', 'owner', '--reason', 'debt']).code, 0);
  f.addEvidence();
  assert.equal(f.run(['transition', '--node', 'n', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified', '--owner', 'owner', '--reason', 'verify']).code, 0);
  const active = f.run(['active']).receipt.data;
  assert.equal(active.count, 0);
  assert.equal(active.activeCount, 0);
  assert.deepEqual(active.nodes, []);
  assert.deepEqual(active.pendingSettlement, { count: 1, nodes: [{ id: 'n', className: 'debt', progress: 'verified', ledger: 'backlog', owner: 'owner' }] });
  assertClosed(f, f.read());
  assert.deepEqual(f.run(['active']).receipt.data.pendingSettlement, { count: 0, nodes: [] });
});

for (const progress of ['in_progress', 'verified']) for (const ledger of ['clean', 'backlog']) {
  test(`settle 原子闭环 ${progress}/${ledger}`, (t) => {
    const f = fixture(t);
    f.addEvidence();
    if (ledger === 'backlog') assert.equal(f.run(['set', '--node', 'n', '--axis', 'ledger', '--value', ledger, '--owner', 'owner', '--reason', 'debt']).code, 0);
    if (progress === 'verified') assert.equal(f.run(['transition', '--node', 'n', '--axis', 'progress', '--from', 'in_progress', '--to', progress, '--owner', 'owner', '--reason', 'verify']).code, 0);
    assertClosed(f, f.read());
  });
}

for (const failure of ['planned', 'blocked', 'cancelled', 'unknown-ledger', 'no-evidence', 'bad-anchor', 'wrong-owner']) {
  test(`settle 拒绝 ${failure} 且侧车逐字节不变`, (t) => {
    const f = fixture(t);
    if (failure !== 'no-evidence') f.addEvidence(failure === 'bad-anchor' ? path.join(path.dirname(f.sidecar), 'missing.md') + ':1' : undefined);
    if (['planned', 'blocked', 'cancelled', 'unknown-ledger'].includes(failure)) {
      const state = f.read();
      if (failure === 'unknown-ledger') state.nodes.n.ledger = 'unknown';
      else state.nodes.n.progress = failure;
      fs.writeFileSync(f.sidecar, JSON.stringify(state, null, 2) + '\n');
    }
    const bytes = fs.readFileSync(f.sidecar);
    assert.equal(f.settle(failure === 'wrong-owner' ? 'other' : 'owner').code, 1);
    assert.deepEqual(fs.readFileSync(f.sidecar), bytes);
  });
}
