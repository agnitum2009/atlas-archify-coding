// doctor 牙齿（批二 2026-08-15 增补：evidence-resolvability / ledger-size warning 级检查 + --stats 派生度量）。
// 红线：全部用临时目录侧车，绝不触碰 <home>/demo-ledger/state/atlas-state.json。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor, LEDGER_SIZE_BYTES, LEDGER_SIZE_TRACES } from '../lib/doctor.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

// 可移植性（DEFENSIVE.md §6 同类）：CI 无 archify 时 doctor 的 archify 检查 fail-closed 会使整体 failed，
// 而本文件断言的是新增两项 warning 级检查的语义——用 stub 保证 archify 存在性检查在任何机器上确定性通过。
const ARCHIFY_STUB = path.join(os.tmpdir(), 'atlas-doctor-archify-stub.mjs');
fs.writeFileSync(ARCHIFY_STUB, 'process.exit(0);\n');

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env: { ...process.env, ARCHIFY_BIN: ARCHIFY_STUB } });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-doctor-'));
}

function seedSidecar(dir, over) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({ schemaVersion: 1, atlas: null, nodes: {}, trace: [], lessons: [], notices: [] }, over || {})) + '\n');
  return p;
}

test('runDoctor：六项检查齐全；archify 缺失时 fail-closed 检出；新增两项 warning 级检查不使整体 failed', () => {
  const d = runDoctor({});
  assert.equal(d.checks.length, 6);
  assert.equal(d.checks[0].name, 'node>=18');
  assert.equal(d.checks[1].name, 'archify-kernel');

  const missing = runDoctor({ archifyBin: '/definitely/not/here/archify.mjs' });
  const arch = missing.checks.find((c) => c.name === 'archify-kernel');
  assert.equal(arch.ok, false);
  assert.ok(arch.detail.includes('gate 命令将 fail-closed'));

  // 批二：evidence-resolvability / ledger-size 为 warning 级（无 sidecar 时未检，ok:false 但不使 exit 1 语义）。
  const names = d.checks.map((c) => c.name);
  assert.ok(names.includes('evidence-resolvability'));
  assert.ok(names.includes('ledger-size'));
  const ev = d.checks.find((c) => c.name === 'evidence-resolvability');
  const ls = d.checks.find((c) => c.name === 'ledger-size');
  assert.equal(ev.warning, true);
  assert.equal(ls.warning, true);
  assert.equal(ev.ok, false);
  assert.equal(ls.ok, false);
  assert.ok(ev.detail.includes('未检'), ev.detail);
  // 既有 error 级失败仍使 result.ok=false（无 sidecar 时 experience-pool 失败）。
  assert.equal(d.ok, false);
});

test('CLI doctor：锚质量 warning（0.8.0）——空行锚与二进制锚各计各样例，exit 0 不阻断；正常文本锚不误报；broken/drifted 回归不受扰', () => {
  const dir = tmpDir();
  const text = path.join(dir, 'text.ts');
  fs.writeFileSync(text, 'real line\n\nthird\n'); // 第 2 行 trim 后为空
  const bin = path.join(dir, 'bin.dat');
  fs.writeFileSync(bin, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), Buffer.alloc(64)])); // 前 8KB 含 NUL = 疑似二进制
  const sidecar = seedSidecar(dir, {
    nodes: {
      n1: { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [text + ':2'], history: [] }, // 空行锚
      n2: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [bin + ':1'], history: [] }, // 二进制锚
      n3: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [text + ':1', path.join(dir, 'ghost.ts') + ':1'], history: [] }, // 正常锚 + broken 锚（回归共存）
    },
  });
  const r = run(['doctor', '--sidecar', sidecar]);
  assert.equal(r.code, 0, '锚质量 warning 属数据债：不使 doctor exit 1；' + JSON.stringify(r.receipt));
  assert.equal(r.receipt.status, 'ok');
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.equal(ev.ok, false);
  assert.equal(ev.warning, true);
  assert.ok(ev.detail.includes('anchor-empty-line'), ev.detail);
  assert.ok(ev.detail.includes('anchor-binary'), ev.detail);
  const res = r.receipt.data.evidenceResolvability;
  assert.equal(res.emptyLine, 1);
  assert.deepEqual(res.emptyLineNodes, ['n1']);
  assert.equal(res.binary, 1);
  assert.deepEqual(res.binaryNodes, ['n2']);
  // 正常文本锚（text.ts:1）不误报：emptyLine/binary 各只有 1 条，n3 不出现在质量样例中。
  assert.ok(!res.emptyLineNodes.includes('n3') && !res.binaryNodes.includes('n3'));
  // 回归：既有 broken 判定不受质量判定影响（ghost 仍计 broken=1、节点样例 n3；三态各自独立计数）。
  assert.equal(res.broken, 1);
  assert.deepEqual(res.brokenNodes, ['n3']);
  assert.equal(res.drifted, 0);
  assert.equal(res.unhashed, 3, '三条可解析锚均无 evidenceMeta → unhashed，不算 drifted');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor：锚全绿（含正常文本锚）时 evidence-resolvability ok:true 且无质量告警文本', () => {
  const dir = tmpDir();
  const text = path.join(dir, 'text.ts');
  fs.writeFileSync(text, 'alpha\nbeta\n');
  const sidecar = seedSidecar(dir, {
    nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [text + ':1', text + ':2'], history: [] } },
  });
  const r = run(['doctor', '--sidecar', sidecar]);
  assert.equal(r.code, 0, JSON.stringify(r.receipt));
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.equal(ev.ok, true, ev.detail);
  assert.ok(!ev.detail.includes('anchor-empty-line') && !ev.detail.includes('anchor-binary'), ev.detail);
  const res = r.receipt.data.evidenceResolvability;
  assert.equal(res.emptyLine, 0);
  assert.equal(res.binary, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runDoctor archify-kernel：fallback 来源出可移植 warning 提示；override/env/path 来源不出（0.8.0 泛化残债3）', () => {
  const dir = tmpDir();
  const stub = path.join(dir, 'archify-stub.mjs');
  fs.writeFileSync(stub, 'process.exit(0);\n');

  // override（--archify 内部通道）不出提示。
  const cOverride = runDoctor({ archifyBin: stub }).checks.find((c) => c.name === 'archify-kernel');
  assert.ok(cOverride.detail.includes('source=override'), cOverride.detail);
  assert.ok(!cOverride.detail.includes('回退路径'), cOverride.detail);

  const prevEnv = process.env.ARCHIFY_BIN;
  const prevPath = process.env.PATH;
  try {
    // env 来源不出提示。
    process.env.ARCHIFY_BIN = stub;
    const cEnv = runDoctor({}).checks.find((c) => c.name === 'archify-kernel');
    assert.ok(cEnv.detail.includes('source=env'), cEnv.detail);
    assert.ok(!cEnv.detail.includes('回退路径'), cEnv.detail);

    // PATH 来源不出提示（临时目录放假 archify 可执行文件，PATH 前置注入，确定性不依赖本机环境）。
    delete process.env.ARCHIFY_BIN;
    const bindir = path.join(dir, 'bin');
    fs.mkdirSync(bindir);
    const fakeBin = path.join(bindir, 'archify');
    fs.writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeBin, 0o755);
    process.env.PATH = bindir + ':' + (prevPath || '');
    const cPath = runDoctor({}).checks.find((c) => c.name === 'archify-kernel');
    assert.ok(cPath.detail.includes('source=path'), cPath.detail);
    assert.ok(!cPath.detail.includes('回退路径'), cPath.detail);
  } finally {
    if (prevEnv === undefined) delete process.env.ARCHIFY_BIN;
    else process.env.ARCHIFY_BIN = prevEnv;
    process.env.PATH = prevPath;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runDoctor archify-kernel：无 env 且 PATH 无 archify 时——source=fallback 出提示、source=none 不出（条件断言，任机器确定性）', () => {
  const dir = tmpDir();
  const emptyBin = path.join(dir, 'empty-bin');
  fs.mkdirSync(emptyBin);
  const prevEnv = process.env.ARCHIFY_BIN;
  const prevPath = process.env.PATH;
  try {
    delete process.env.ARCHIFY_BIN;
    process.env.PATH = emptyBin; // which archify 必不中
    const c = runDoctor({}).checks.find((x) => x.name === 'archify-kernel');
    if (c.detail.includes('source=fallback')) {
      assert.ok(c.detail.includes('回退路径'), 'fallback 来源必须出可移植提示：' + c.detail);
      assert.ok(c.detail.includes('ARCHIFY_BIN'), c.detail);
      assert.equal(c.ok, true, 'fallback 仍算内核可用（提示不改 ok 语义）');
    } else {
      assert.ok(c.detail.includes('source=none'), c.detail);
      assert.ok(!c.detail.includes('回退路径'), c.detail);
      assert.equal(c.ok, false, 'none = fail-closed');
    }
  } finally {
    if (prevEnv === undefined) delete process.env.ARCHIFY_BIN;
    else process.env.ARCHIFY_BIN = prevEnv;
    process.env.PATH = prevPath;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor：失效证据锚被检出（warning 级，exit 0 不阻断）+ evidenceResolvability 形状精确', () => {
  const dir = tmpDir();
  const real = path.join(dir, 'real.ts');
  fs.writeFileSync(real, 'a\nb\n');
  const sidecar = seedSidecar(dir, {
    nodes: {
      n1: { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [real + ':1', path.join(dir, 'ghost.ts') + ':1'], history: [] },
      n2: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [real + ':99'], history: [] },
      n3: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] },
    },
  });
  const r = run(['doctor', '--sidecar', sidecar]);
  assert.equal(r.code, 0, 'broken 锚属数据债：warning 级不使 doctor exit 1；' + JSON.stringify(r.receipt));
  assert.equal(r.receipt.status, 'ok');
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.equal(ev.ok, false);
  assert.ok(ev.detail.includes('站位无关性提示'), ev.detail);
  assert.ok(ev.detail.includes('绝对路径'), ev.detail);
  // total=3 锚（n1 两条 + n2 一条）；broken=2（ghost 文件缺失 + 行号越界）；brokenNodes 前 5 个节点 id 去重；
  // 无 evidenceMeta（锁口② 2026-08-16）：可解析锚计 unhashed=1，不算 drifted。
  // 0.8.0 形状扩面：增锚质量四字段（emptyLine/binary + 节点样例；real.ts:1 为正常文本行不误报）。
  assert.deepEqual(r.receipt.data.evidenceResolvability, { total: 3, ok: 0, broken: 2, drifted: 0, unhashed: 1, brokenNodes: ['n1', 'n2'], driftedNodes: [], emptyLine: 0, binary: 0, emptyLineNodes: [], binaryNodes: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

// 0.10.2（一线席位 一线误读驱动）：锚三态/锚质量的节点样例列表与 layout P6 同式——前 5 逐条 + 超出部分汇总。
// 回归铉：修复前该列表静默截断在 5，一线据此误以为看到了全量漂移节点（实例：2026-08-17 前后对比）。
test('CLI doctor：节点样例列表超 5 时补 P6 同式汇总（0.10.2）——不再静默截断', () => {
  const dir = tmpDir();
  const real = path.join(dir, 'real.ts');
  fs.writeFileSync(real, 'a\nb\n');
  // 8 个节点各挂一条失效锚（文件缺）→ brokenNodeSet=8 > 样例 5
  const nodes = {};
  for (let i = 1; i <= 8; i += 1) {
    nodes['n' + i] = { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(dir, 'ghost' + i + '.ts') + ':1'], history: [] };
  }
  const sidecar = seedSidecar(dir, { nodes });
  const r = run(['doctor', '--sidecar', sidecar]);
  assert.equal(r.code, 0, '锚数据债仍为 warning 级，exit 0 不变');
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.ok(ev.detail.includes('另有 3 个节点同类，共 8 个；前 5 个已逐条列出'), '超限时须补汇总；' + ev.detail);
  // 列表本身仍封顶 5（体例不变），且结构字段未新增（本批不动回执形状）
  assert.equal(r.receipt.data.evidenceResolvability.brokenNodes.length, 5);
  assert.deepEqual(Object.keys(r.receipt.data.evidenceResolvability).sort(), ['binary', 'binaryNodes', 'broken', 'brokenNodes', 'drifted', 'driftedNodes', 'emptyLine', 'emptyLineNodes', 'ok', 'total', 'unhashed'], '回执形状零新增字段');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor：节点样例 ≤5 时逐条语义不变、无汇总尾巴（0.10.2 不过度）', () => {
  const dir = tmpDir();
  const nodes = {};
  for (let i = 1; i <= 5; i += 1) {
    nodes['n' + i] = { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(dir, 'ghost' + i + '.ts') + ':1'], history: [] };
  }
  const sidecar = seedSidecar(dir, { nodes });
  const r = run(['doctor', '--sidecar', sidecar]);
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.ok(!ev.detail.includes('另有'), '恰好 5 个不得出现汇总；' + ev.detail);
  assert.ok(ev.detail.includes('brokenNodes=n1,n2,n3,n4,n5'), ev.detail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor 失败信封携带 data（0.7.0 缺陷2）：--atlas 布局 error 时 data.layout.diagnostics 明细可见（修复前 failed 信封无 data，「详见 data.layout.diagnostics」指向不存在位置）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir); // 合法侧车——保证唯一 error 级失败是 atlas-layout
  const bad = path.join(dir, 'bad-atlas');
  fs.mkdirSync(path.join(bad, 'spec', 'demo'), { recursive: true }); // v2 版式（spec/ 一级子目录；v1 平铺 0.9.0 起已废弃塌缩不再校验）缺六区 + INDEX.md → layout error
  const r = run(['doctor', '--sidecar', sidecar, '--atlas', bad]);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'failed');
  assert.deepEqual(r.receipt.diagnostics.map((c) => c.name), ['atlas-layout'], 'diagnostics 只列 error 级不通过的检查');
  assert.ok(r.receipt.data && typeof r.receipt.data === 'object', 'failed 信封必须携带 data');
  const layout = r.receipt.data.layout;
  assert.ok(layout && Array.isArray(layout.diagnostics), 'data.layout.diagnostics 必须存在（atlas-layout detail 自述的明细位置）');
  const errors = layout.diagnostics.filter((d) => d.severity === 'error');
  assert.ok(errors.length > 0, '布局 error 明细在失败信封必须可见');
  assert.ok(errors.some((d) => d.rule === 'layout.zones'), '缺区 error（layout.zones）应在明细中');
  const check = r.receipt.data.checks.find((c) => c.name === 'atlas-layout');
  assert.equal(check.ok, false);
  assert.equal(r.receipt.data.ok, false, 'data.ok 与失败状态一致');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor --stats：各字段形状与精确值（已知内容侧车）；缺 --sidecar = bad_args exit 1', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    revision: 7,
    nodes: {
      a: {
        owner: '一线席位', truth: 'effective', progress: 'verified', ledger: 'settled',
        evidence: ['/abs/a.ts:1', 'rel/b.ts:2', '/abs/c.ts:3'],
        history: [
          { at: 't1', kind: 'set', axis: 'truth', from: 'candidate', to: 'pending_confirmation', by: '一线席位' }, // truth 前进
          { at: 't2', kind: 'set', axis: 'truth', from: 'pending_confirmation', to: 'candidate', by: '一线席位', engine: '0.2.0' }, // 回退不计
          { at: 't3', kind: 'set', axis: 'progress', from: 'planned', to: 'in_progress', by: '一线席位', engine: '0.2.0' }, // 非 truth 不计
        ],
      },
      b: { owner: '', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, // owner 空 → 不计入 seated
    },
    trace: [
      { id: 'trace-1', at: 't', kind: 'decision', actor: 'a', note: 'x', node: null },
      { id: 'trace-2', at: 't', kind: 'decision', actor: 'a', note: 'x', node: null },
      { id: 'trace-3', at: 't', kind: 'tool_call', actor: 'a', note: 'x', node: null },
    ],
    lessons: [
      { id: 'l1', at: 't', rule: 'r', lesson: 'x', source: null, hits: 2 },
      { id: 'l2', at: 't', rule: 'r', lesson: 'x', source: null, hits: 3 },
      { id: 'l3', at: 't', rule: 'r', lesson: 'x', source: null, status: 'retired' },
    ],
    notices: [
      { id: 'notice-1', at: 't', from: '一线席位', kind: 'note', node: 'a', summary: 's', readBy: [] },
      { id: 'notice-2', at: 't', from: '一线席位', kind: 'note', node: 'a', summary: 's', readBy: [] },
    ],
  });
  const r = run(['doctor', '--sidecar', sidecar, '--stats']);
  assert.equal(r.code, 0, JSON.stringify(r.receipt));
  const s = r.receipt.data.stats;
  assert.equal(s.nodes, 2);
  assert.equal(s.ownedNodes, 1, 'owner 非空才计入 owned');
  assert.deepEqual(s.evidence, { total: 3, absolute: 2, relative: 1, hashed: 0 }, '无 evidenceMeta → hashed=0（锁口②）');
  assert.equal(s.truthAdvances, 1, '仅 axis=truth 且 from→to 为前进的事件');
  assert.deepEqual(s.traceKinds, { tool_call: 1, decision: 2, diagram_diff: 0, evidence: 0, ruling: 0, command: 0 });
  assert.deepEqual(s.lessons, { total: 3, active: 2, retired: 1, hits: 5 });
  assert.deepEqual(s.notices, { total: 2 });
  assert.deepEqual(s.attribution, { historyTotal: 3, withBy: 3, withEngine: 2 });
  assert.equal(s.sidecarBytes, fs.statSync(sidecar).size);
  assert.equal(s.revision, 7);

  // 无 --sidecar 时 --stats 拒绝（度量全部派生自侧车）。
  const noSidecar = run(['doctor', '--stats']);
  assert.equal(noSidecar.code, 1);
  assert.equal(noSidecar.receipt.status, 'failed');
  assert.equal(noSidecar.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(noSidecar.receipt.diagnostics[0].evidence.includes('--sidecar'), noSidecar.receipt.diagnostics[0].evidence);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor ledger-size：红绿两路（trace 超阈 / 侧车超 1MB → warning 提示冷归档；正常 ok）', () => {
  const dir = tmpDir();
  // 红路一：trace 1100 条（超 1000 阈）。
  const traces = [];
  for (let i = 0; i < LEDGER_SIZE_TRACES + 100; i += 1) {
    traces.push({ id: 'trace-' + i, at: 't', kind: 'tool_call', actor: 'a', note: 'x', node: null });
  }
  const sidecar = seedSidecar(dir, { trace: traces });
  const red = run(['doctor', '--sidecar', sidecar]);
  assert.equal(red.code, 0, 'warning 级不阻断；' + JSON.stringify(red.receipt));
  const lsRed = red.receipt.data.checks.find((c) => c.name === 'ledger-size');
  assert.equal(lsRed.ok, false);
  assert.ok(lsRed.detail.includes('history/'), lsRed.detail);
  assert.ok(lsRed.detail.includes(String(LEDGER_SIZE_TRACES + 100)), lsRed.detail);

  // 红路二：侧车 >1MB（大 lesson 文本）。
  const big = path.join(dir, 'big.json');
  fs.writeFileSync(big, JSON.stringify({
    schemaVersion: 1, atlas: null, nodes: {}, trace: [],
    lessons: [{ id: 'l1', at: 't', rule: 'r', lesson: 'x'.repeat(LEDGER_SIZE_BYTES + 1024), source: null }],
    notices: [],
  }));
  const red2 = run(['doctor', '--sidecar', big]);
  assert.equal(red2.code, 0);
  assert.equal(red2.receipt.data.checks.find((c) => c.name === 'ledger-size').ok, false);

  // 绿路：小侧车（1 条 trace，远小于两阈）。
  const small = seedSidecar(dir, { trace: [{ id: 'trace-1', at: 't', kind: 'tool_call', actor: 'a', note: 'x', node: null }] });
  const green = run(['doctor', '--sidecar', small]);
  assert.equal(green.code, 0);
  const lsGreen = green.receipt.data.checks.find((c) => c.name === 'ledger-size');
  assert.equal(lsGreen.ok, true);
  assert.ok(lsGreen.detail.includes('字节') && lsGreen.detail.includes('trace'), lsGreen.detail);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 0.11.2（空态措辞纪律，防御模式 #9）：零证据锚不得声称「全部可解析」。
// 权威依据：Architec 裁定 034（空态措辞）——「无发现」与「无法分析」须用不同措辞，
// 且绝不说 pass/clean/safe；其做法是用测试守住公开字符串不出现裁决词。本测试即该「牙齿」。
// 本仓实例：第三方工具在无法解析的仓上回报「复杂度 10.0 满分」，同病；我们零锚时曾说「0 条全部可解析」。
test('CLI doctor：零证据锚的空态措辞不得声称已验证（0.11.2）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } },
  });
  const r = run(['doctor', '--sidecar', sidecar]);
  assert.equal(r.code, 0);
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.equal(ev.ok, true, '零锚不构成失败');
  assert.ok(ev.detail.includes('尚无证据锚'), '须明示「尚无对象」而非「已验证」；' + ev.detail);
  assert.ok(!ev.detail.includes('全部可解析'), '零锚时不得出现「全部可解析」这一验证性断言；' + ev.detail);
  // 守词：空态文案不得含裁决词（与 Architec 裁定 034 同式）
  for (const w of ['clean', 'safe', '通过', '无风险', '健康']) {
    assert.ok(!ev.detail.includes(w), `空态文案不得含裁决词「${w}」；` + ev.detail);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI doctor：有锚且全通过时，验证性断言照旧（0.11.2 不过度）', () => {
  const dir = tmpDir();
  const real = path.join(dir, 'real.ts');
  fs.writeFileSync(real, 'a\nb\n');
  const sidecar = seedSidecar(dir, {
    nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [real + ':1'], history: [] } },
  });
  const r = run(['doctor', '--sidecar', sidecar]);
  const ev = r.receipt.data.checks.find((c) => c.name === 'evidence-resolvability');
  assert.ok(ev.detail.includes('全部可解析'), '非零锚仍应给出验证性断言；' + ev.detail);
  fs.rmSync(dir, { recursive: true, force: true });
});
