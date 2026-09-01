// report + gate 牙齿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildReport } from '../lib/report.mjs';
import { runGate } from '../lib/gate.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function runCli(args, env) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout };
}

test('buildReport：聚合状态迁移与证据 lint；A3 违规=error；缺 SHA=warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
  const ev = path.join(dir, 'ev.ts');
  fs.writeFileSync(ev, 'x\n');
  const rel = path.relative(process.cwd(), ev);
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      good: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [rel + ':1'], history: [{ at: 't', kind: 'settle', from: {}, to: {} }] },
      bad: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [] },
    },
  };
  const r = buildReport(sidecar, { root: process.cwd(), codeSha: 'abc', specSha: 'def' });
  assert.equal(r.state_changes, 1);
  assert.equal(r.nodes.length, 2);
  assert.equal(r.shas.code, 'abc');
  assert.equal(r.lessons.count, 0);
  const a3 = r.errors.find((e) => e.rule === 'verified_requires_evidence');
  assert.ok(a3, 'A3 违规应报 error');
  assert.equal(r.warnings.length, 0);

  const noSha = buildReport(sidecar, { root: process.cwd() });
  assert.equal(noSha.warnings.filter((w) => w.rule === 'missing_code_sha').length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildReport：slice 过滤单节点', () => {
  const sidecar = { schemaVersion: 1, nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, n2: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } } };
  const r = buildReport(sidecar, { slice: 'n1' });
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].node, 'n1');
});

test('runGate：archify 缺失或非法 spec → fail 停在 validate，绝不伪装 pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [] }));
  const r1 = runGate(bad, path.join(dir, 'out.html'));
  assert.equal(r1.final, 'fail');
  assert.ok(['validate', 'archify-missing'].includes(r1.stage));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGate：坏内核诊断可诊断（0.8.0 修复）——stderr 尾部进 tail；静默坏内核明写「内核无输出+已解析路径」，绝不空白', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-badkernel-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] }));

  // A：非 archify 的文件——node 把 SyntaxError 打到 stderr（修复前只盯 stdout → tail 空白）。
  const noisy = path.join(dir, 'not-archify.mjs');
  fs.writeFileSync(noisy, '这不是 archify 可执行文件\n');
  const r1 = runGate(spec, path.join(dir, 'out.html'), noisy);
  assert.equal(r1.final, 'fail');
  assert.equal(r1.stage, 'validate');
  assert.ok(r1.tail && r1.tail.includes('[stderr]'), 'stderr 尾部必须进 tail：' + JSON.stringify(r1));
  assert.ok(r1.tail.includes('SyntaxError'), r1.tail);
  assert.ok(r1.tail.length <= 910, 'tail 合计 ≤900（容许标签字符余量）：' + r1.tail.length);

  // B：静默坏内核（exit 1 零输出）——明写无输出 + 已解析路径（source → 路径）。
  const silent = path.join(dir, 'silent.mjs');
  fs.writeFileSync(silent, 'process.exit(1);\n');
  const r2 = runGate(spec, path.join(dir, 'out.html'), silent);
  assert.equal(r2.final, 'fail');
  assert.equal(r2.stage, 'validate');
  assert.ok(r2.tail.includes('内核无输出（可能不是 archify 可执行文件）'), r2.tail);
  assert.ok(r2.tail.includes('已解析路径=override → ' + silent), r2.tail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGate：二进制内核消息可行动化（0.10.0，holdout #2 P2a）——tail 零不可打印字节 + 注明过滤数 + 无条件附已解析路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-binkernel-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] }));

  // 二进制内核（holdout #2 实测场景：ARCHIFY_BIN=/bin/ls）——node 把 ELF 源行回显进 SyntaxError 栈，
  // 修复前 tail 918 字符里 23% 是不可打印字节且不含已解析路径。
  const r = runGate(spec, path.join(dir, 'out.html'), '/bin/ls');
  assert.equal(r.final, 'fail');
  assert.equal(r.stage, 'validate');
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(r.tail), 'tail 不得含不可打印字节（\\n\\t 保留）：' + JSON.stringify(r.tail.slice(0, 120)));
  assert.ok(r.tail.includes('（已过滤 '), '须注明已过滤不可打印字节数：' + r.tail);
  assert.ok(r.tail.includes('已解析路径=override → /bin/ls'), '须无条件附已解析路径与来源：' + r.tail);
  assert.ok(r.tail.length <= 910, 'tail 合计 ≤900（容许标签字符余量，注记行计入预算）：' + r.tail.length);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate --out 落点 warning（0.10.0，holdout #2 P0）：直落 atlas 的 artifacts/<项目>/ 根 → 回执带 gate_out_placement；模块目录/非 atlas 不触发', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-placement-'));
  // 最小 atlas：spec/<项目>/ + artifacts/<项目>/（gate 本身不校验布局，warning 只认落点形状）。
  fs.mkdirSync(path.join(dir, 'spec', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'artifacts', 'demo'), { recursive: true });
  const spec = path.join(dir, 'spec', 'demo', 'demo.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] }));
  const stub = path.join(dir, 'archify-stub.mjs');
  fs.writeFileSync(stub, 'process.exit(0);\n');
  const now = new Date();
  const stamp = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');

  // ① 直落项目根 → warning（修复前：gate exit 0 零提示，doctor --atlas 随后 7 条 P2 error）。
  const hit = runCli(['gate', '--diagram', spec, '--out', path.join(dir, 'artifacts', 'demo', 'x.html'), '--no-trace'], { ARCHIFY_BIN: stub });
  assert.equal(hit.code, 0, '不阻断不改退出码；' + hit.stdout);
  const placed = (hit.receipt.diagnostics || []).filter((d) => d.rule === 'gate_out_placement');
  assert.equal(placed.length, 1, '项目根落点须出一条 gate_out_placement warning');
  assert.equal(placed[0].severity, 'warning');
  assert.ok(placed[0].evidence.includes('artifacts/demo/<模块>-' + stamp + '/'), '消息给出建议路径（日期取当天）：' + placed[0].evidence);
  assert.ok(placed[0].evidence.includes('布局 P2'), '消息说明直落项目根会触发布局 P2');

  // ② 模块目录落点 → 不触发（推荐路径本身）。
  const mod = runCli(['gate', '--diagram', spec, '--out', path.join(dir, 'artifacts', 'demo', 'loops-' + stamp, 'x.html'), '--no-trace'], { ARCHIFY_BIN: stub });
  assert.equal(mod.code, 0, mod.stdout);
  assert.ok(!(mod.receipt.diagnostics || []).some((d) => d.rule === 'gate_out_placement'), '模块目录落点不出 warning');

  // ③ 祖父目录名为 artifacts 但图谱根下无 spec/<项目>/（非 atlas 项目根，路径撞名）→ 不触发。
  const alien = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-placement-alien-'));
  fs.mkdirSync(path.join(alien, 'artifacts', 'ghost'), { recursive: true });
  const miss = runCli(['gate', '--diagram', spec, '--out', path.join(alien, 'artifacts', 'ghost', 'x.html'), '--no-trace'], { ARCHIFY_BIN: stub });
  assert.equal(miss.code, 0, miss.stdout);
  assert.ok(!(miss.receipt.diagnostics || []).some((d) => d.rule === 'gate_out_placement'), '非 atlas 项目根不出 warning');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(alien, { recursive: true, force: true });
});

