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

// ==================== 0.21.2：反向洞修复 + 补救消息归真（ds41x 席位独立复核实证） ====================

// 反向洞①：cancelled×clean 节点经 ledger 轴 set 挂 backlog 必须被拦（0.21.1 漏拦）。
test('state set：cancelled 节点 ledger clean→backlog = cancelled_requires_clean 拦截（反向洞）', (t) => {
  const { sidecar } = seedSidecar(t, 'atlas-revset-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'cancelled', ledger: 'clean', evidence: [], history: [] },
  });
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'ledger', '--value', 'backlog', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.diagnostics[0].rule, 'cancelled_requires_clean');
  const after = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(after.nodes.n1.ledger, 'clean', '拦截必须零写入');
});

// 反向洞②：transition 路径同拦。
test('state transition：cancelled 节点 ledger clean→backlog 同被 cancelled_requires_clean 拦截', (t) => {
  const { sidecar } = seedSidecar(t, 'atlas-revtr-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'cancelled', ledger: 'clean', evidence: [], history: [] },
  });
  const r = run(['state', 'transition', '--node', 'n1', '--axis', 'ledger', '--from', 'clean', '--to', 'backlog', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.diagnostics[0].rule, 'cancelled_requires_clean');
});

// 补救真实可达（ds41x 实测路径）：ledger --correction 核销为 clean → 取消无需 correction 放行 → 读边警告消解。
test('补救链：planned×backlog 先核销欠账（留痕）再取消放行，report 不再报 cross_axis_unlisted', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-remedy-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'backlog', evidence: [], history: [] },
  });
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  // 第一步：核销欠账（backlog→clean 不在 A2 表，必经 --correction，corrected:true 留痕）
  const s1 = run(['state', 'set', '--node', 'n1', '--axis', 'ledger', '--value', 'clean', '--reason', '欠账作废', '--owner', 'o', '--correction', '--sidecar', sidecar]);
  assert.equal(s1.code, 0, s1.stdout);
  // 第二步：正常取消——守卫对 clean 静默
  const s2 = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'cancelled', '--reason', '取消', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(s2.code, 0, s2.stdout);
  const after = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual([after.nodes.n1.progress, after.nodes.n1.ledger], ['cancelled', 'clean']);
  const rep = run(['report', '--sidecar', sidecar, '--no-trace']);
  const warns = (rep.receipt.data.warnings || []).filter((w) => w.rule === 'cross_axis_unlisted' && w.subject === 'n1');
  assert.equal(warns.length, 0, '补救完成后读边警告必须消解：' + JSON.stringify(rep.receipt.data.warnings));
});

// 不冻结既有孤儿：存量 cancelled×backlog 节点的无关轴（class）写入不受影响（组合判定只管 progress/ledger 两轴）。
test('存量孤儿不冻结：cancelled×backlog 节点写 class 轴照常放行', (t) => {
  const { sidecar } = seedSidecar(t, 'atlas-nofreeze-', {
    orphan: { owner: 'o', truth: 'candidate', progress: 'cancelled', ledger: 'backlog', evidence: [], history: [] },
  });
  const r = run(['state', 'set', '--node', 'orphan', '--axis', 'class', '--value', 'task', '--reason', '补分类', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
});

// 反向写入的 --correction 通道同样放行且留痕（设计预留，如实钉住）。
test('反向写入 --correction 放行并留痕 corrected:true（孤儿照落，设计预留通道）', (t) => {
  const { sidecar } = seedSidecar(t, 'atlas-revcor-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'cancelled', ledger: 'clean', evidence: [], history: [] },
  });
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'ledger', '--value', 'backlog', '--reason', 'r', '--owner', 'o', '--correction', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const after = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(after.nodes.n1.ledger, 'backlog');
  const ev = after.nodes.n1.history.find((e) => e.kind === 'set' && e.axis === 'ledger');
  assert.equal(ev.corrected, true);
});

// 消息归真：指引的补救路径必须实测可达（ledger 核销），不得再指「先 state settle」（planned 节点被 illegal_transition 拒）。
test('守卫消息指引实测可达路径：含 ledger 核销指引，不含「先 state settle」死路', (t) => {
  const { dir, sidecar } = seedSidecar(t, 'atlas-msg-', {
    n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'backlog', evidence: [], history: [] },
  });
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]);
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'cancelled', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]);
  assert.equal(r.code, 1);
  const msg = r.receipt.diagnostics[0].evidence;
  assert.ok(msg.includes('--axis ledger --value clean --correction'), '消息必须指引 ledger 核销路径：' + msg);
  assert.ok(!msg.includes('先 state settle 核销欠账再取消'), '旧消息的死路径表述必须移除：' + msg);
});
