// 提案③（2026-08-15 负责人裁定）：真相轴回执推进协议端到端牙齿（真实子进程 + mkdtemp 临时目录与回执文件）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTruthReceipt, isTruthAdvance } from '../lib/truth-receipt.mjs';

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

test('首次补写缺失/null truth 仍需要回执，历史前进统计保持原定义', () => {
  for (const from of [undefined, null]) {
    assert.equal(isTruthAdvance(from, 'effective'), false);
    for (const to of ['pending_confirmation', 'effective', 'closed']) {
      const r = checkTruthReceipt({ axis: 'truth', from, to });
      assert.equal(r.ok, false);
      assert.equal(r.diagnostics[0].rule, 'receipt_required');
    }
    assert.equal(checkTruthReceipt({ axis: 'truth', from, to: 'candidate' }).ok, true);
  }
});

test('回执须为普通文件：目录拒绝，文件和指向文件的链接可用', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'receipt.txt'), link = path.join(dir, 'receipt-link');
  fs.writeFileSync(file, '');
  fs.symlinkSync(file, link);
  const check = receipt => checkTruthReceipt({ axis: 'truth', from: null, to: 'effective', receipt });
  assert.equal(check(dir).diagnostics?.[0]?.rule, 'receipt_not_file');
  assert.equal(check(file).receipt, file);
  assert.equal(check(link).receipt, link);
  assert.equal(check(path.join(dir, 'absent')).diagnostics?.[0]?.rule, 'receipt_not_found');
  const stat = fs.statSync;
  fs.statSync = (p, ...args) => {
    if (p === file) throw Object.assign(new Error('access denied'), {code:'EACCES'});
    return stat(p, ...args);
  };
  try { assert.equal(check(file).diagnostics?.[0]?.rule, 'receipt_unreadable'); }
  finally { fs.statSync = stat; }
});

test('CLI 首次 truth 生效缺回执及目录回执均拒绝且侧车不变', (t) => {
  const dir = tmpDir(), sidecar = path.join(dir, 'atlas-state.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const truth of [undefined, null]) {
    fs.writeFileSync(sidecar, JSON.stringify({schemaVersion:1, nodes:{n:{truth, owner:'一线席位', history:[]}}}));
    const before = fs.readFileSync(sidecar, 'utf8');
    const args = ['state', 'set', '--node', 'n', '--axis', 'truth', '--value', 'effective', '--reason', '首次', '--owner', '一线席位'];
    const missing = run(args, sidecar);
    assert.equal(missing.code, 1);
    assert.equal(missing.receipt.diagnostics[0].rule, 'receipt_required');
    const directory = run(args.concat(['--receipt', dir]), sidecar);
    assert.equal(directory.code, 1);
    assert.equal(directory.receipt.diagnostics[0].rule, 'receipt_not_file');
    assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
  }
});

test('① transition truth 前进无 --receipt → exit 1 receipt_required，节点不动不落历史', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const seeded = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--class', 'task'], sidecar);
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
  run(['state', 'set', '--node', 'n2', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'], sidecar);
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
  run(['state', 'set', '--node', 'n3', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'], sidecar);
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
  const noReceipt = run(['state', 'set', '--node', 'n4', '--axis', 'truth', '--value', 'pending_confirmation', '--reason', '快捷路径', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(noReceipt.code, 1);
  assert.equal(noReceipt.receipt.diagnostics[0].rule, 'receipt_required');
  assert.equal(fs.existsSync(sidecar), false); // 被拒不落盘

  const receiptFile = path.join(dir, 'r4.json');
  fs.writeFileSync(receiptFile, '{}', 'utf8');
  const withReceipt = run(['state', 'set', '--node', 'n4', '--axis', 'truth', '--value', 'pending_confirmation', '--reason', '快捷路径', '--owner', '一线席位', '--receipt', receiptFile, '--class', 'task'], sidecar);
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
  const p = run(['state', 'set', '--node', 'n5', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(p.code, 0);
  const l = run(['state', 'set', '--node', 'n5', '--axis', 'ledger', '--value', 'backlog', '--reason', 'r', '--owner', '一线席位'], sidecar);
  assert.equal(l.code, 0);
  // 真实证据文件（transition→verified 是完成声称，锚必须可解析，2026-09-15 缺陷3）
  const evFile = path.join(dir, 'ev.md');
  fs.writeFileSync(evFile, 'evidence\n');
  run(['state', 'evidence-add', '--node', 'n5', '--locator', evFile + ':1'], sidecar);
  const v = run(['state', 'transition', '--node', 'n5', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified', '--reason', '销账', '--owner', '一线席位'], sidecar);
  assert.equal(v.code, 0);

  // truth 原地写入（candidate→candidate）非前进：--receipt 指向不存在文件也被忽略，不触发 receipt_not_found
  const noop = run(['state', 'set', '--node', 'n5', '--axis', 'truth', '--value', 'candidate', '--reason', 'r', '--owner', '一线席位', '--receipt', path.join(dir, 'nonexistent.json')], sidecar);
  assert.equal(noop.code, 0);
  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(side.nodes.n5.truthReceipts, undefined); // 非前进写入不落 truthReceipts
  fs.rmSync(dir, { recursive: true, force: true });
});
