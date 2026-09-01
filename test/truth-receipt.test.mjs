// 提案③（2026-08-15 负责人裁定）：真相轴回执推进协议端到端牙齿（真实子进程 + mkdtemp 临时目录与回执文件）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, sidecarPath) {
  const res = spawnSync(process.execPath, [BIN].concat(args, ['--sidecar', sidecarPath]), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-truth-receipt-'));
}

test('① transition truth 前进无 --receipt → exit 1 receipt_required，节点不动不落历史', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const seeded = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位'], sidecar);
  assert.equal(seeded.code, 0);

  const res = run(['state', 'transition', '--node', 'n1', '--axis', 'truth', '--from', 'candidate', '--to', 'pending_confirmation', '--reason', '提交负责人确认', '--owner', '一线席位'], sidecar);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.status, 'failed');
  assert.equal(res.receipt.diagnostics[0].rule, 'receipt_required');
  assert.match(res.receipt.diagnostics[0].evidence, /真相轴推进需负责人本地回执文件（开发规范：Owner 真相需目标本地回执，机器不自证）/);

  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(side.nodes.n1.truth, 'candidate');
  assert.equal(side.nodes.n1.history.length, 1); // 仅 set；被拒操作不落历史
  assert.equal(side.nodes.n1.truthReceipts, undefined);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('② --receipt 指向不存在路径 → exit 1 receipt_not_found，subject 带解析后绝对路径', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  run(['state', 'set', '--node', 'n2', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位'], sidecar);
  const ghost = path.join(dir, 'rulings', 'receipts', 'ghost.json'); // 不存在

  const res = run(['state', 'transition', '--node', 'n2', '--axis', 'truth', '--from', 'candidate', '--to', 'pending_confirmation', '--reason', 'r', '--owner', '一线席位', '--receipt', ghost], sidecar);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.diagnostics[0].rule, 'receipt_not_found');
  assert.equal(res.receipt.diagnostics[0].subject, path.resolve(ghost));
  assert.ok(res.receipt.diagnostics[0].evidence.includes(path.resolve(ghost)));

  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(side.nodes.n2.truth, 'candidate');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('③ 带真实临时回执文件 → ok：truth 推进 + truthReceipts 记绝对路径 + history 事件含 receipt 字段', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  run(['state', 'set', '--node', 'n3', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位'], sidecar);
  const receiptFile = path.join(dir, 'rulings', 'receipts', 'n3-truth-pending_confirmation.json');
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.writeFileSync(receiptFile, JSON.stringify({ node: 'n3', axis: 'truth', to: 'pending_confirmation', decided_at: '2026-08-15', quote: '必须就做' }), 'utf8');

  const res = run(['state', 'transition', '--node', 'n3', '--axis', 'truth', '--from', 'candidate', '--to', 'pending_confirmation', '--reason', '负责人裁定生效', '--owner', '一线席位', '--receipt', receiptFile], sidecar);
  assert.equal(res.code, 0);
  assert.equal(res.receipt.status, 'ok');
  assert.equal(res.receipt.data.to, 'pending_confirmation');

  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(side.nodes.n3.truth, 'pending_confirmation');
  const entry = side.nodes.n3.truthReceipts[0];
  assert.equal(entry.to, 'pending_confirmation');
  assert.equal(entry.receipt, path.resolve(receiptFile)); // 绝对路径
  assert.equal(typeof entry.at, 'string');
  assert.ok(entry.at.length > 0);
  const last = side.nodes.n3.history[side.nodes.n3.history.length - 1];
  assert.equal(last.kind, 'transition');
  assert.equal(last.receipt, path.resolve(receiptFile));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('④ set 快捷路径同样被拦：truth 前进无回执 exit 1 receipt_required；带回执放行并落账', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const noReceipt = run(['state', 'set', '--node', 'n4', '--axis', 'truth', '--value', 'pending_confirmation', '--reason', '快捷路径', '--owner', '一线席位'], sidecar);
  assert.equal(noReceipt.code, 1);
  assert.equal(noReceipt.receipt.diagnostics[0].rule, 'receipt_required');
  assert.equal(fs.existsSync(sidecar), false); // 被拒不落盘

  const receiptFile = path.join(dir, 'r4.json');
  fs.writeFileSync(receiptFile, '{}', 'utf8');
  const withReceipt = run(['state', 'set', '--node', 'n4', '--axis', 'truth', '--value', 'pending_confirmation', '--reason', '快捷路径', '--owner', '一线席位', '--receipt', receiptFile], sidecar);
  assert.equal(withReceipt.code, 0);
  assert.equal(withReceipt.receipt.data.to, 'pending_confirmation');

  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(side.nodes.n4.truth, 'pending_confirmation');
  assert.equal(side.nodes.n4.truthReceipts[0].receipt, path.resolve(receiptFile));
  assert.equal(side.nodes.n4.history[0].kind, 'set');
  assert.equal(side.nodes.n4.history[0].receipt, path.resolve(receiptFile));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('⑤ 非 truth 轴（progress/ledger）写入照常无需 --receipt；truth 非前进写入传 --receipt 被忽略', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const p = run(['state', 'set', '--node', 'n5', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位'], sidecar);
  assert.equal(p.code, 0);
  const l = run(['state', 'set', '--node', 'n5', '--axis', 'ledger', '--value', 'backlog', '--reason', 'r', '--owner', '一线席位'], sidecar);
  assert.equal(l.code, 0);
  run(['state', 'evidence-add', '--node', 'n5', '--locator', 'src/a.ts:1'], sidecar);
  const v = run(['state', 'transition', '--node', 'n5', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified', '--reason', '销账', '--owner', '一线席位'], sidecar);
  assert.equal(v.code, 0);

  // truth 原地写入（candidate→candidate）非前进：--receipt 指向不存在文件也被忽略，不触发 receipt_not_found
  const noop = run(['state', 'set', '--node', 'n5', '--axis', 'truth', '--value', 'candidate', '--reason', 'r', '--owner', '一线席位', '--receipt', path.join(dir, 'nonexistent.json')], sidecar);
  assert.equal(noop.code, 0);
  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(side.nodes.n5.truthReceipts, undefined); // 非前进写入不落 truthReceipts
  fs.rmSync(dir, { recursive: true, force: true });
});
