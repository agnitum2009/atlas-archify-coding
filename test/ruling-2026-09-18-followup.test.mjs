// 0.21.1 裁定批（2026-09-18 遗留二问的收口，负责人续裁 2026-09-18）：
//   ① cross_axis_unlisted 拆半裁定落地：cancelled ⇒ clean 半边写边拦截（新码 cancelled_requires_clean，
//      真实账本统计该半边存量=0，零误伤）；settled ⇒ verified 半边维持 warning 观测（写边已由
//      settled_requires_event 守住，存量 36 条全是 0.16.x 前直达赋值遗存，与 import_unmarked 同人群）。
//   ② report 失败信封（非 --brief）补 warnings 全文——存量统计仪器恰在账本不健康时最需要可见。
//   ③ archify 内核探测 which 补 5s 超时（裁定5 子进程不得无限挂起的例外收口）。
// 红线：全部用 mkdtemp 临时目录与临时证据文件，绝不触碰真实侧车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin/atlas-engine.mjs');

function run(args, { cwd, env } = {}) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd: cwd || ROOT, env });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* bad receipt surfaces as null */ }
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, receipt };
}

function tmpdir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedSidecar(t, prefix, nodes) {
  const dir = tmpdir(t, prefix);
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: null, revision: 0, nodes }, null, 2));
  return { dir, sidecar };
}

// ① 写边拦截：planned×backlog 节点被取消 → cancelled_requires_clean，exit 1，零写入。
test('state set：progress→cancelled 而 ledger≠clean = cancelled_requires_clean 拦截（零写入）', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-cancelclean-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'backlog', evidence: [], history: [] },
  });
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  // 先补证据，隔离 cancelled_requires_evidence——本测只钉新守卫。
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'cancelled', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.diagnostics[0].rule, 'cancelled_requires_clean');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('backlog'), r.receipt.diagnostics[0].evidence);
  // 零写入：progress 仍为 planned。
  const after = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(after.nodes.n1.progress, 'planned');
  assert.equal(after.revision, 1, '只有 evidence-add 一笔写入，拦截本身零写入');
});

// ① 同守卫在 transition 路径同样生效（A2 表允许 planned→cancelled，组合表守卫拒绝欠账取消）。
test('state transition：planned×backlog → cancelled 同被 cancelled_requires_clean 拦截', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-cancelclean-tr-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'backlog', evidence: [], history: [] },
  });
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  const r = run(['state', 'transition', '--node', 'n1', '--axis', 'progress', '--from', 'planned', '--to', 'cancelled', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.diagnostics[0].rule, 'cancelled_requires_clean');
});

// ① --correction 显式核销通道保留：豁免留痕 corrected:true。
test('state set --correction：cancelled_requires_clean 可显式核销，事件 corrected:true 留痕', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-cancelclean-cor-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'backlog', evidence: [], history: [] },
  });
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'cancelled', '--reason', 'r', '--owner', 'o', '--correction', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const after = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(after.nodes.n1.progress, 'cancelled');
  const ev = after.nodes.n1.history.find((e) => e.kind === 'set' && e.axis === 'progress');
  assert.equal(ev.corrected, true, '核销通道必须留痕');
});

// ① 合法路径不受影响：ledger=clean 时取消照常放行（仍过 cancelled_requires_evidence）。
test('state set：ledger=clean 时 cancelled 放行（新守卫静默，证据守卫照发）', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-cancelclean-ok-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] },
  });
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'cancelled', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const after = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(after.nodes.n1.progress, 'cancelled');
});

// ② report 失败信封（非 brief）携带 warnings 全文。
test('report：失败信封（非 brief）携带 warnings 全文——存量统计仪器在失败时可见', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-failwarn-', {
    bad: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'clean', evidence: [], history: [] }, // → verified_requires_evidence error
    orphanDebt: { owner: 'o', truth: 'candidate', progress: 'cancelled', ledger: 'backlog', evidence: [], history: [] }, // → cross_axis_unlisted warning（锚稍后补）
  });
  fs.writeFileSync(path.join(dir, 'p.txt'), 'x\n');
  const { code: eaCode, receipt: eaReceipt } = run(['state', 'evidence-add', '--node', 'orphanDebt', '--locator', path.join(dir, 'p.txt') + ':1', '--sidecar', sidecar]);
  assert.equal(eaCode, 0, JSON.stringify(eaReceipt));
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.status, 'failed');
  const rules = (r.receipt.data.warnings || []).map((d) => d.rule);
  assert.ok(rules.includes('cross_axis_unlisted'), '失败信封必须携带 warnings：' + JSON.stringify(rules));
  assert.ok((r.receipt.data.warnings || []).some((d) => d.subject === 'orphanDebt'));
});

// ② --brief 失败信封 warnings 仍是计数（语义对称，不回退既有行为）。
test('report --brief：失败信封 warnings 为计数（0.21.1 契约：失败侧同形）', (t) => {
  const { sidecar } = seedSidecar(t, 'atlas-failwarn-b-', {
    bad: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'clean', evidence: [], history: [] },
  });
  const r = run(['report', '--sidecar', sidecar, '--no-trace', '--brief']);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(typeof r.receipt.data.warnings, 'number', 'brief 失败信封 warnings 保持计数');
});

// ③ which 探测带超时：PATH 上的挂起 which 不再无限阻塞（5s 上限，fail-closed 走回退链）。
test('resolveArchify：which 挂起时按超时回退（不无限阻塞）', (t) => {
  const dir = tmpdir(t, 'atlas-whichtimeout-');
  const bin = fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'which'), '#!/bin/sh\nexec sleep 30\n');
  fs.chmodSync(path.join(bin, 'which'), 0o755);
  const { ARCHIFY_BIN: _ignored, ...cleanEnv } = process.env;
  const started = Date.now();
  // resolveArchify 无 env 时走 PATH 探测：挂起 which 超时（5s）后回退链/none，绝不挂死主进程。
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { resolveArchify } from ${JSON.stringify(path.join(ROOT, 'lib', 'resolve-archify.mjs'))};
    const r = resolveArchify();
    console.log(JSON.stringify(r));
  `], { encoding: 'utf8', env: { ...cleanEnv, PATH: bin + path.delimiter + (cleanEnv.PATH || '') } , timeout: 15000 });
  assert.ok(Date.now() - started < 15000, '主进程不应被 which 挂起拖死：' + (Date.now() - started) + 'ms');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.ok(['fallback', 'none'].includes(out.source), '超时后必须走回退链或 none（fail-closed）：' + out.source);
});
