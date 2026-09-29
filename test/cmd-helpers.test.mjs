// 命令实现模块的边界测试（进程内，不 spawn）：锚根助手、gate 落点诊断、state 前奏三分支。
// CLI 行为的端到端覆盖在既有 *-cli / state-* 测试中；本文件钉住拆分后成为导出面的函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorRootCheck, evidenceWriteCheck, anchorRootReceipt, anchorRootWarnings, stateContext } from '../lib/cmd-state.mjs';
import { gateOutPlacementDiag } from '../lib/cmd-gate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 进程内调用会写 stdout 并设 process.exitCode：捕获输出、返回回执、复位退出码。
function capture(fn) {
  const write = process.stdout.write;
  const prevExit = process.exitCode;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  let value;
  try { value = fn(); } finally { process.stdout.write = write; }
  const exitCode = process.exitCode;
  process.exitCode = prevExit;
  return { value, exitCode, receipt: out ? JSON.parse(out) : null };
}

function atlasWithRegistry(t) {
  const dir = tmp(t, 'atlas-cmdh-');
  const stateDir = path.join(dir, 'atlas', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'atlas', 'c.ts'), 'inside\n');
  fs.mkdirSync(path.join(dir, 'outside'));
  fs.writeFileSync(path.join(dir, 'outside', 'o.ts'), 'outside\n');
  const sidecarPath = path.join(stateDir, 'atlas-state.json');
  return { dir, stateDir, sidecarPath, inside: path.join(dir, 'atlas', 'c.ts'), outside: path.join(dir, 'outside', 'o.ts') };
}

test('anchorRootCheck：无 projects.json/anchor-roots.json = 门未激活，放行且回执 gate=inactive', (t) => {
  const a = atlasWithRegistry(t);
  const r = anchorRootCheck({}, { nodes: {} }, a.sidecarPath, a.outside + ':1');
  assert.equal(r.ok, true);
  assert.equal(anchorRootReceipt(r.rootCtx, r.exemptions, r.verdict).gate, 'inactive');
});

test('anchorRootCheck：登记后根内放行、根外拒并带 anchor_root_denied', (t) => {
  const a = atlasWithRegistry(t);
  fs.writeFileSync(path.join(a.stateDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sourcePath: REPO_ROOT }] }));
  assert.equal(anchorRootCheck({}, { nodes: {} }, a.sidecarPath, a.inside + ':1').ok, true);
  const denied = anchorRootCheck({}, { nodes: {} }, a.sidecarPath, a.outside + ':1');
  assert.equal(denied.ok, false);
  assert.equal(denied.diagnostics[0].rule, 'anchor_root_denied');
  assert.equal(anchorRootReceipt(denied.rootCtx, denied.exemptions, denied.verdict).gate, 'active');
});

test('evidenceWriteCheck：格式坏的锚被拒；requireResolvable 时指向不存在文件 = evidence_unresolvable', (t) => {
  const a = atlasWithRegistry(t);
  const bad = evidenceWriteCheck({ node: 'n1' }, { nodes: {} }, a.sidecarPath, 'no-line-number');
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].rule, 'bad_locator');
  const missing = evidenceWriteCheck({ node: 'n1' }, { nodes: {} }, a.sidecarPath, path.join(a.dir, 'nope.ts') + ':1', { requireResolvable: true });
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics[0].rule, 'evidence_unresolvable');
  const good = evidenceWriteCheck({ node: 'n1' }, { nodes: {} }, a.sidecarPath, a.inside + ':1', { requireResolvable: true });
  assert.equal(good.ok, true);
  assert.equal(good.locator, a.inside + ':1');
});

test('anchorRootWarnings：豁免命中 → anchor_root_grandfathered；--allow-root 被拒 → anchor_root_rejected；皆 warning', () => {
  const ctx = { rejected: [{ source: 'cli', root: '/x', reason: '临时目录' }, { source: 'config', root: '/y', reason: 'r' }] };
  const verdict = { exempted: true, exemption: { path: '/old/a.ts', reason: '首跑存量' } };
  const out = anchorRootWarnings(ctx, verdict);
  assert.deepEqual(out.map((d) => [d.rule, d.severity]), [['anchor_root_grandfathered', 'warning'], ['anchor_root_rejected', 'warning']]);
  assert.deepEqual(anchorRootWarnings({ rejected: [] }, null), []);
});

test('gateOutPlacementDiag：--out 直落 artifacts/<项目>/ 且 spec/<项目> 存在 → warning；否则 null', (t) => {
  const dir = tmp(t, 'atlas-gateout-');
  fs.mkdirSync(path.join(dir, 'spec', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'artifacts', 'demo'), { recursive: true });
  const d = gateOutPlacementDiag(path.join(dir, 'artifacts', 'demo', 'out.html'));
  assert.equal(d.rule, 'gate_out_placement');
  assert.equal(d.severity, 'warning');
  assert.equal(gateOutPlacementDiag(path.join(dir, 'artifacts', 'demo', 'm-260927', 'out.html')), null);
  assert.equal(gateOutPlacementDiag(path.join(dir, 'artifacts', 'other', 'out.html')), null);
});

test('stateContext：--correction 用于非 set → null + bad_args exit 1', (t) => {
  const a = atlasWithRegistry(t);
  const r = capture(() => stateContext(['get', '--node', 'n1', '--correction', '--sidecar', a.sidecarPath]));
  assert.equal(r.value, null);
  assert.equal(r.exitCode, 1);
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
});

test('stateContext：席位不在授权清单 → null + seat_gate', (t) => {
  const a = atlasWithRegistry(t);
  fs.writeFileSync(a.sidecarPath, JSON.stringify({ schemaVersion: 1, revision: 0, atlas: null, nodes: {} }));
  fs.writeFileSync(path.join(a.stateDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json', seats: ['alice'] }] }));
  const r = capture(() => stateContext(['set', '--node', 'demo-n1', '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'mallory', '--class', 'task', '--sidecar', a.sidecarPath]));
  assert.equal(r.value, null);
  assert.equal(r.receipt.diagnostics[0].rule, 'seat_gate');
});

test('stateContext：显式 --sidecar 缺文件且 sub=set → 返回初始化空账，不打印', (t) => {
  const a = atlasWithRegistry(t);
  const r = capture(() => stateContext(['set', '--node', 'n1', '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'o', '--class', 'task', '--sidecar', a.sidecarPath]));
  assert.equal(r.receipt, null);
  assert.equal(r.value.sub, 'set');
  assert.equal(r.value.cmd, 'state.set');
  assert.equal(r.value.sidecarPath, a.sidecarPath);
  assert.deepEqual(r.value.sidecar, { schemaVersion: 1, atlas: null, nodes: {} });
});
