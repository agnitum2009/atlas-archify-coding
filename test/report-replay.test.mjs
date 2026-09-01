// B2 replay 消费闭环牙齿（2026-08-15 清单）：report --replay 内联时间线摘要（≤10 条 + truncated/total）、
// 未知节点单条 error 不整体失败、--replay 可重复。
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-replay-'));
}

function seedSidecar(dir, nodes) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: nodes || {} }) + '\n');
  return p;
}

test('B2 report --replay：摘要内联进 data.replays，每条只留 at/kind/source/一行要点', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { n1: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });
  const set = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(set.code, 0);
  const tr = run(['trace', 'add', '--kind', 'decision', '--actor', 'owner', '--note', '裁定X', '--node', 'n1', '--sidecar', sidecar]);
  assert.equal(tr.code, 0);

  const r = run(['report', '--sidecar', sidecar, '--replay', 'n1', '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(r.code, 0, JSON.stringify(r.receipt.diagnostics));
  assert.ok(Array.isArray(r.receipt.data.replays), 'data.replays 存在');
  assert.equal(r.receipt.data.replays.length, 1);
  const rp = r.receipt.data.replays[0];
  assert.equal(rp.node, 'n1');
  assert.equal(rp.total, 2, 'state 源 1 条 + trace 源 1 条');
  assert.equal(rp.truncated, undefined, '未超出不注 truncated');
  assert.equal(rp.events.length, 2);
  for (const e of rp.events) {
    assert.ok(e.at && e.kind && e.source && typeof e.summary === 'string', '每条只留 at/kind/source/summary');
    assert.equal(Object.keys(e).sort().join(','), 'at,kind,source,summary', '不内联 detail 防膨胀');
  }
  const stateEv = rp.events.find((e) => e.source === 'state');
  const traceEv = rp.events.find((e) => e.source === 'trace');
  assert.ok(stateEv.summary.includes('开工'), 'state 源要点带 reason：' + stateEv.summary);
  assert.ok(traceEv.summary.includes('裁定X'), 'trace 源要点带 note：' + traceEv.summary);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B2 截尾：>10 条事件只留最近 10 条，注 truncated:true 与 total 总数', () => {
  const dir = tmpDir();
  const history = [];
  for (let i = 1; i <= 12; i += 1) {
    history.push({ at: '2026-08-15T00:00:' + String(i).padStart(2, '0') + 'Z', kind: 'set', axis: 'progress', from: 'planned', to: 'in_progress', reason: 'r' + i, by: '一线席位' });
  }
  const sidecar = seedSidecar(dir, { n1: { owner: '一线席位', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [], history } });

  const r = run(['report', '--sidecar', sidecar, '--replay', 'n1', '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(r.code, 0);
  const rp = r.receipt.data.replays[0];
  assert.equal(rp.total, 12, 'total 记全量');
  assert.equal(rp.truncated, true, '超出注 truncated');
  assert.equal(rp.events.length, 10, '只留最近 10 条');
  assert.ok(rp.events[9].summary.includes('r12'), '最近一条是第 12 事件：' + rp.events[9].summary);
  assert.ok(rp.events[0].summary.includes('r3'), '窗口起点是第 3 事件：' + rp.events[0].summary);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B2 未知节点：该条目带 error 不整体失败；--replay 可重复聚合', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { n1: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });

  const ghostOnly = run(['report', '--sidecar', sidecar, '--replay', 'ghost', '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(ghostOnly.code, 0, '未知节点不整体失败：' + JSON.stringify(ghostOnly.receipt.diagnostics));
  assert.ok(ghostOnly.receipt.data.replays[0].error.includes('ghost'), '条目带 error');

  const multi = run(['report', '--sidecar', sidecar, '--replay', 'n1', '--replay', 'ghost', '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(multi.code, 0);
  assert.equal(multi.receipt.data.replays.length, 2, '--replay 可重复');
  assert.equal(multi.receipt.data.replays[0].node, 'n1');
  assert.equal(multi.receipt.data.replays[0].error, undefined);
  assert.ok(multi.receipt.data.replays[1].error, '第二条 ghost 带 error');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B2 不传 --replay：data 无 replays 段（向后兼容）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { n1: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });
  const r = run(['report', '--sidecar', sidecar, '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(r.code, 0);
  assert.equal(r.receipt.data.replays, undefined, '未传 --replay 不出 replays 段');
  fs.rmSync(dir, { recursive: true, force: true });
});
