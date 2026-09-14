// P1 余项（2026-09-11）：图账绑定入销账链 —— state settle 回执携带 graphBinding。
//   判据：节点 id（含归一化）或 specRefs 命中任一 spec 组件 ⇒ bound；否则 unbound（未分类时另附 warning 诊断）。
// 红线：只在临时数据根内作业，绝不触碰真实侧车。
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
  try { receipt = JSON.parse(res.stdout); } catch { receipt = null; }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function seed() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settlebind-'));
  const stateDir = path.join(root, 'state');
  const specDir = path.join(root, 'spec', 'proj');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  const specPath = path.join(specDir, 'diagram-a.json');
  fs.writeFileSync(specPath, JSON.stringify({ diagram_type: 'architecture', components: [{ id: 'x-node' }, { id: 'other' }] }) + '\n');
  const scPath = path.join(stateDir, 'atlas-proj.json');
  const loc = specPath + ':1';
  const mk = (id) => ({ owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [loc], history: [] });
  fs.writeFileSync(scPath, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: { 'x-node': mk('x-node'), 'y-other': mk('y-other') }, notices: [], trace: [], lessons: [] }) + '\n');
  return scPath;
}

test('settle 回执携带 graphBinding：命中 spec 组件 ⇒ bound 且列出图名', () => {
  const sc = seed();
  const r = run(['state', 'settle', '--node', 'x-node', '--reason', 'fixture', '--owner', 'o', '--sidecar', sc]);
  assert.equal(r.code, 0);
  const gb = r.receipt.data.receipt.graphBinding;
  assert.equal(gb.verdict, 'bound');
  assert.deepEqual(gb.diagrams, ['diagram-a']);
  assert.equal(gb.checked, 1);
});

test('settle 回执：未绑定且未分类 ⇒ unbound 且发 a1-settle-unbound warning（不阻断）', () => {
  const sc = seed();
  const r = run(['state', 'settle', '--node', 'y-other', '--reason', 'fixture', '--owner', 'o', '--sidecar', sc]);
  assert.equal(r.code, 0);
  const gb = r.receipt.data.receipt.graphBinding;
  assert.equal(gb.verdict, 'unbound');
  const ds = r.receipt.data.receipt.diagnostics || [];
  assert.equal(ds.length, 1);
  assert.equal(ds[0].rule, 'a1-settle-unbound');
});

test('settle 回执：已分类且未绑定 ⇒ unbound 但**不**发码（口径收窄）', () => {
  const sc = seed();
  const raw = JSON.parse(fs.readFileSync(sc, 'utf8'));
  raw.nodes['y-other'].class = 'task';
  fs.writeFileSync(sc, JSON.stringify(raw) + '\n');
  const r = run(['state', 'settle', '--node', 'y-other', '--reason', 'fixture', '--owner', 'o', '--sidecar', sc]);
  assert.equal(r.code, 0);
  assert.equal(r.receipt.data.receipt.graphBinding.verdict, 'unbound');
  assert.equal(r.receipt.data.receipt.diagnostics, undefined);
});

test('settle 回执：lifecycle 图的 states[] 也算图件 id（与 A1 同源）', () => {
  const sc = seed();
  const dir = path.join(path.dirname(sc), '..', 'spec', 'proj');
  fs.writeFileSync(path.join(dir, 'diagram-lc.json'), JSON.stringify({ diagram_type: 'lifecycle', states: [{ id: 'x-node' }], transitions: [] }) + '\n');
  const r = run(['state', 'settle', '--node', 'x-node', '--reason', 'fixture', '--owner', 'o', '--sidecar', sc]);
  assert.equal(r.code, 0);
  const gb = r.receipt.data.receipt.graphBinding;
  assert.equal(gb.verdict, 'bound');
  assert.deepEqual(gb.diagrams, ['diagram-a', 'diagram-lc']);
});

test('settle 回执：spec 目录缺席 ⇒ no-specs（只读降级，绝不阻断销账）', () => {
  const sc = seed();
  fs.rmSync(path.join(path.dirname(sc), '..', 'spec'), { recursive: true, force: true });
  const r = run(['state', 'settle', '--node', 'x-node', '--reason', 'fixture', '--owner', 'o', '--sidecar', sc]);
  assert.equal(r.code, 0);
  assert.equal(r.receipt.data.receipt.graphBinding.verdict, 'no-specs');
});
