// L1/L2 越界门禁自检（0.13.0，负责人令 2026-08-27）。
// 覆盖：①无注册表=不激活（init/自由侧车零破坏）②注册表无 sidecar 字段=不激活 ③共享侧车并集
// ④前缀门 CLI 红绿（新建拦/放行/grandfather 存量豁免）⑤席位门 CLI 红绿（set+settle 两路）
// ⑥条目无 seats=不限席位。全部走 bin 真进程（与 deploy-injection.test 同法），非 mock。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectGate, prefixAllowed, seatAllowed } from '../lib/project-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'atlas-engine.mjs');

function run(args, cwd) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

function tmpAtlas(entries, nodes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-project-gate-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'atlas-state.json'),
    JSON.stringify({ schemaVersion: 1, atlas: null, nodes: nodes || {} }, null, 2));
  fs.writeFileSync(path.join(dir, 'state', 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: entries }, null, 2));
  const sidecar = path.join(dir, 'state', 'atlas-state.json');
  return { dir, sidecar };
}

// 共享侧车注册表（模拟 demo-ledger atlas-state.json：demo-a+add 双条目映射）
function sharedEntries() {
  return [
    { project: 'demo-a', umbrella: 'demo-a-add', sidecar: 'atlas-state.json', seats: ['一线席位', 'pi', 'owner'] },
    { project: 'add', umbrella: 'add-add', sidecar: 'atlas-state.json', seats: ['atlas-engine', 'pi', 'owner'] },
  ];
}

const readNodes = (sc) => JSON.parse(fs.readFileSync(sc, 'utf8')).nodes;

// ---------- 单元 ----------

test('① 无 projects.json → loadProjectGate 返回 null（门不激活）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-gate-bare-'));
  const sc = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sc, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: {} }));
  assert.equal(loadProjectGate(sc), null);
});

test('② 注册表条目无 sidecar 字段 → null（init 产物/旧注册表零破坏）', () => {
  const { sidecar } = tmpAtlas([{ project: 'demo', umbrella: 'demo-add', portals: [] }], {});
  assert.equal(loadProjectGate(sidecar), null);
});

test('③ 共享侧车 → 前缀并集 + 席位并集', () => {
  const { sidecar } = tmpAtlas(sharedEntries(), {});
  const gate = loadProjectGate(sidecar);
  assert.ok(gate, '应激活');
  assert.deepEqual([...gate.prefixes].sort(), ['add', 'demo-a']);
  for (const s of ['一线席位', 'pi', 'owner', 'atlas-engine']) assert.ok(gate.seats.has(s));
});

test('④ prefixAllowed：精确等值/连字符前缀/拒绝他前缀', () => {
  const ps = ['demo-a', 'add'];
  assert.ok(prefixAllowed('demo-a', ps));
  assert.ok(prefixAllowed('demo-a-l1', ps));
  assert.ok(prefixAllowed('add-x', ps));
  assert.ok(!prefixAllowed('o13x', ps), '前缀后须跟连字符或恰为项目名');
  assert.ok(!prefixAllowed('demo-b-x', ps));
});

test('⑤ seatAllowed：seats=null 全放行（条目未启用席位限制）', () => {
  assert.ok(seatAllowed('anyone', null));
  assert.ok(!seatAllowed('anyone', new Set(['一线席位'])));
});

// ---------- CLI 红绿 ----------

test('⑥ 新建节点前缀不符 → exit 1 rule=project_prefix_gate，侧车零写入', () => {
  const { sidecar } = tmpAtlas(sharedEntries(), {});
  const res = run(['state', 'set', '--node', 'demo-b-pi-try', '--axis', 'progress', '--value', 'planned', '--reason', '越界探针', '--owner', 'pi', '--sidecar', sidecar]);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.diagnostics[0].rule, 'project_prefix_gate');
  assert.match(res.receipt.diagnostics[0].evidence, /demo-a \| add/);
  assert.equal(Object.keys(readNodes(sidecar)).length, 0, '失败必须零写入');
});

test('⑦ 新建节点 demo-a-* 前缀 → 放行（共享侧车第一项目）', () => {
  const { sidecar } = tmpAtlas(sharedEntries(), {});
  const res = run(['state', 'set', '--node', 'demo-a-gate-probe', '--axis', 'progress', '--value', 'planned', '--reason', '探针', '--owner', 'pi', '--sidecar', sidecar]);
  assert.equal(res.code, 0);
  assert.ok(readNodes(sidecar)['demo-a-gate-probe']);
});

test('⑧ 新建节点 add-* 前缀 → 放行（共享侧车第二项目并集）', () => {
  const { sidecar } = tmpAtlas(sharedEntries(), {});
  const res = run(['state', 'set', '--node', 'add-gate-probe', '--axis', 'progress', '--value', 'planned', '--reason', '探针', '--owner', 'atlas-engine', '--sidecar', sidecar]);
  assert.equal(res.code, 0);
  assert.ok(readNodes(sidecar)['add-gate-probe']);
});

test('⑨ 存量无前缀节点 grandfather → 仍可写（P6 存量归 doctor 提示，写路径不拦）', () => {
  const legacy = { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] };
  const { sidecar } = tmpAtlas(sharedEntries(), { 'diagram-legacy': legacy });
  const res = run(['state', 'set', '--node', 'diagram-legacy', '--axis', 'progress', '--value', 'in_progress', '--reason', '存量可写', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(res.code, 0);
  assert.equal(readNodes(sidecar)['diagram-legacy'].progress, 'in_progress');
});

test('⑩ 席位不在清单 → exit 1 rule=seat_gate（set 路径）', () => {
  const { sidecar } = tmpAtlas(sharedEntries(), {});
  const res = run(['state', 'set', '--node', 'demo-a-x', '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'intruder', '--sidecar', sidecar]);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.diagnostics[0].rule, 'seat_gate');
  assert.match(res.receipt.diagnostics[0].evidence, /一线席位, pi, owner/);
});

test('⑪ settle 路径席位门：外来席位 → seat_gate（中央闸覆盖四写命令）', () => {
  const node = { owner: '一线席位', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: ['/tmp/e.txt:1'], history: [] };
  const { sidecar } = tmpAtlas(sharedEntries(), { 'demo-a-settle-probe': node });
  const res = run(['state', 'settle', '--node', 'demo-a-settle-probe', '--reason', 'r', '--owner', 'intruder', '--sidecar', sidecar]);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.diagnostics[0].rule, 'seat_gate');
});

test('⑫ 条目无 seats 字段 → 席位不限（渐进启用，不锁旧用法）', () => {
  const { sidecar } = tmpAtlas([{ project: 'solo', umbrella: 'solo-add', sidecar: 'atlas-state.json' }], {});
  const res = run(['state', 'set', '--node', 'solo-any', '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'anyone', '--sidecar', sidecar]);
  assert.equal(res.code, 0);
});

test('⑬ 读命令不设席位门：state get 无需 owner，外来上下文照读', () => {
  const node = { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] };
  const { sidecar } = tmpAtlas(sharedEntries(), { 'demo-a-read': node });
  const res = run(['state', 'get', '--node', 'demo-a-read', '--sidecar', sidecar]);
  assert.equal(res.code, 0);
  assert.equal(res.receipt.data.node, 'demo-a-read');
});
