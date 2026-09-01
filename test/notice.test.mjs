// B3 席位间主动通知牙齿（2026-08-15 清单）：侧车 notices 一等数据段 + settle/block 自动投递 +
// notice list 未读过滤 / ack 单条与全部 / add 手动通知 + 旧侧车无 notices 兼容。
// 红线：全部用临时目录侧车，绝不触碰 <home>/demo-ledger/state/atlas-state.json。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-notice-'));
}

// seed 为旧侧车形状（无 notices 字段），验证向后兼容路径。
function seedSidecar(dir, extra) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({ schemaVersion: 1, atlas: null, nodes: {} }, extra)) + '\n');
  return p;
}

function readSidecar(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inProgressNode() {
  return { owner: '一线席位', truth: 'candidate', progress: 'in_progress', ledger: 'backlog', evidence: ['lib/x.mjs:1'], history: [] };
}

test('B3 settle 成功自动投递 notice（kind=settled，from=--owner，summary=reason，readBy 空）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { nodes: { n1: inProgressNode() } });
  const r = run(['state', 'settle', '--node', 'n1', '--reason', '交付完成', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(r.code, 0, JSON.stringify(r.receipt.diagnostics));
  const sc = readSidecar(sidecar);
  assert.equal(sc.notices.length, 1, 'settle 自动投递一条');
  const n = sc.notices[0];
  assert.ok(n.id.startsWith('notice-'));
  assert.equal(n.kind, 'settled');
  assert.equal(n.from, '一线席位');
  assert.equal(n.node, 'n1');
  assert.equal(n.summary, '交付完成');
  assert.deepEqual(n.readBy, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 block 成功自动投递 notice（kind=blocked）；settle 失败路径不投递', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { nodes: { n1: inProgressNode(), n2: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } } });
  const b = run(['state', 'block', '--node', 'n1', '--reason', '等上游', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(b.code, 0);
  const sc = readSidecar(sidecar);
  assert.equal(sc.notices.length, 1);
  assert.equal(sc.notices[0].kind, 'blocked');
  assert.equal(sc.notices[0].summary, '等上游');

  // 失败路径：n2 progress=planned 不可 settle，不得产生 notice
  const bad = run(['state', 'settle', '--node', 'n2', '--reason', '抢跑', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(bad.code, 1);
  assert.equal(readSidecar(sidecar).notices.length, 1, '失败不投递');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 notice list：缺省全量；--seat 只列该席位未读', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    notices: [
      { id: 'notice-a', at: '2026-08-15T00:00:01Z', from: '一线席位', kind: 'settled', node: 'n1', summary: 's1', readBy: ['alice'] },
      { id: 'notice-b', at: '2026-08-15T00:00:02Z', from: '一线席位', kind: 'note', node: 'n2', summary: 's2', readBy: [] },
    ],
  });
  const all = run(['notice', 'list', '--sidecar', sidecar]);
  assert.equal(all.code, 0);
  assert.equal(all.receipt.data.count, 2, '缺省全量');

  const alice = run(['notice', 'list', '--seat', 'alice', '--sidecar', sidecar]);
  assert.equal(alice.code, 0);
  assert.equal(alice.receipt.data.count, 1, 'alice 只见未读');
  assert.equal(alice.receipt.data.notices[0].id, 'notice-b');
  assert.equal(alice.receipt.data.seat, 'alice');
  assert.equal(alice.receipt.data.unreadOnly, true);

  const bob = run(['notice', 'list', '--seat', 'bob', '--sidecar', sidecar]);
  assert.equal(bob.receipt.data.count, 2, 'bob 两条皆未读');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 notice ack --id：单条确认 + 幂等（已确认 confirmed=0）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    notices: [{ id: 'notice-a', at: '2026-08-15T00:00:01Z', from: '一线席位', kind: 'settled', node: 'n1', summary: 's1', readBy: [] }],
  });
  const ack = run(['notice', 'ack', '--seat', 'alice', '--id', 'notice-a', '--sidecar', sidecar]);
  assert.equal(ack.code, 0);
  assert.equal(ack.receipt.data.confirmed, 1);
  assert.deepEqual(ack.receipt.data.ids, ['notice-a']);
  assert.deepEqual(readSidecar(sidecar).notices[0].readBy, ['alice']);

  const again = run(['notice', 'ack', '--seat', 'alice', '--id', 'notice-a', '--sidecar', sidecar]);
  assert.equal(again.code, 0);
  assert.equal(again.receipt.data.confirmed, 0, '重复确认幂等');
  assert.deepEqual(readSidecar(sidecar).notices[0].readBy, ['alice'], '不重复记');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 notice ack 无 --id：全部未读确认；再 list --seat 验空', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    notices: [
      { id: 'notice-a', at: '2026-08-15T00:00:01Z', from: '一线席位', kind: 'settled', node: 'n1', summary: 's1', readBy: ['alice'] },
      { id: 'notice-b', at: '2026-08-15T00:00:02Z', from: '一线席位', kind: 'blocked', node: 'n2', summary: 's2', readBy: [] },
      { id: 'notice-c', at: '2026-08-15T00:00:03Z', from: '一线席位', kind: 'note', node: 'n3', summary: 's3', readBy: [] },
    ],
  });
  const ack = run(['notice', 'ack', '--seat', 'alice', '--sidecar', sidecar]);
  assert.equal(ack.code, 0);
  assert.equal(ack.receipt.data.confirmed, 2, '只新确认未读两条');
  assert.deepEqual(ack.receipt.data.ids, ['notice-b', 'notice-c']);

  const empty = run(['notice', 'list', '--seat', 'alice', '--sidecar', sidecar]);
  assert.equal(empty.receipt.data.count, 0, '全部已读，未读列表空');
  // 他席位不受影响
  const bob = run(['notice', 'list', '--seat', 'bob', '--sidecar', sidecar]);
  assert.equal(bob.receipt.data.count, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 notice ack 错误码：缺 --seat = bad_seat；--id 不存在 = notice_not_found', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    notices: [{ id: 'notice-a', at: '2026-08-15T00:00:01Z', from: '一线席位', kind: 'note', node: 'n1', summary: 's1', readBy: [] }],
  });
  const noSeat = run(['notice', 'ack', '--sidecar', sidecar]);
  assert.equal(noSeat.code, 1);
  assert.equal(noSeat.receipt.diagnostics[0].rule, 'bad_seat');

  const ghost = run(['notice', 'ack', '--seat', 'alice', '--id', 'notice-ghost', '--sidecar', sidecar]);
  assert.equal(ghost.code, 1);
  assert.equal(ghost.receipt.diagnostics[0].rule, 'notice_not_found');
  assert.deepEqual(readSidecar(sidecar).notices[0].readBy, [], '失败路径不动账');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 notice add：手动 note 通知；缺参 bad_args；伪造 kind=settled 拒绝（bad_kind）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { nodes: { n1: inProgressNode() } });
  const add = run(['notice', 'add', '--kind', 'note', '--node', 'n1', '--summary', '明日联调', '--from', 'alice', '--sidecar', sidecar]);
  assert.equal(add.code, 0);
  const n = add.receipt.data.notice;
  assert.equal(n.kind, 'note');
  assert.equal(n.from, 'alice');
  assert.equal(n.node, 'n1');
  assert.equal(n.summary, '明日联调');
  assert.deepEqual(n.readBy, []);
  assert.equal(readSidecar(sidecar).notices.length, 1, '落侧车');

  const missing = run(['notice', 'add', '--kind', 'note', '--node', 'n1', '--from', 'alice', '--sidecar', sidecar]);
  assert.equal(missing.code, 1);
  assert.equal(missing.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(missing.receipt.diagnostics[0].evidence.includes('--summary'));

  const forged = run(['notice', 'add', '--kind', 'settled', '--node', 'n1', '--summary', '伪结算', '--from', 'alice', '--sidecar', sidecar]);
  assert.equal(forged.code, 1);
  assert.equal(forged.receipt.diagnostics[0].rule, 'bad_kind', 'settled 为自动投递专属');
  assert.equal(readSidecar(sidecar).notices.length, 1, '拒绝不涨账');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B3 旧侧车兼容：无 notices 字段 list 出空（exit 0）；notices 非数组 = sidecar_bad_shape', () => {
  const dir = tmpDir();
  const legacy = seedSidecar(dir, { nodes: {} });
  const r = run(['notice', 'list', '--sidecar', legacy]);
  assert.equal(r.code, 0);
  assert.equal(r.receipt.data.count, 0, '旧侧车按空数组处理');
  assert.deepEqual(r.receipt.data.notices, []);

  const bad = path.join(dir, 'bad-shape.json');
  fs.writeFileSync(bad, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: {}, notices: {} }) + '\n');
  const r2 = run(['notice', 'list', '--sidecar', bad]);
  assert.equal(r2.code, 1);
  assert.equal(r2.receipt.diagnostics[0].rule, 'sidecar_bad_shape', 'notices 非数组 fail-loud');
  fs.rmSync(dir, { recursive: true, force: true });
});
