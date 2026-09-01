// B1 自动留痕牙齿（2026-08-15 清单）：gate/compile/report 运行后（成败均记）向侧车追加 kind='command' 事件；
// --no-trace 关闭；留痕失败降级 warning 不阻断；state 写命令不自动记（history 已覆盖）。
// 红线：全部用临时目录侧车，绝不触碰 <home>/demo-ledger/state/atlas-state.json。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, env) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-autotrace-'));
}

function seedSidecar(dir, nodes) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: nodes || {} }) + '\n');
  return p;
}

function readSidecar(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 可移植性：CI 等无 archify 环境下 gate 会走 archify-missing 短路，detail 形状不同——
// 用确定性 stub（任意 node 脚本均可充当 ARCHIFY_BIN，gate 用 node <bin> 起进程）保证
// validate 在任何机器上都真实跑到且确定性失败。
function writeArchifyStub(dir) {
  const p = path.join(dir, 'archify-stub.mjs');
  fs.writeFileSync(p, 'process.exit(1);\n');
  return p;
}

function writeBadSpec(dir) {
  const p = path.join(dir, 'bad.json');
  fs.writeFileSync(p, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [] }));
  return p;
}

test('B1 gate：失败路径自动留痕一条 kind=command（final+各闸），CAS revision 推进；fail 回执附 lessonPrompt', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir);
  const bad = writeBadSpec(dir);
  const stub = writeArchifyStub(dir);
  const r = run(['gate', '--diagram', bad, '--out', path.join(dir, 'out.html'), '--sidecar', sidecar], { ARCHIFY_BIN: stub });
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'failed');
  assert.ok(r.receipt.data.lessonPrompt.includes('lessons add'), 'gate fail 回执应附 lessonPrompt（B4）');
  const sc = readSidecar(sidecar);
  assert.equal(sc.trace.length, 1);
  assert.equal(sc.trace[0].kind, 'command');
  assert.equal(sc.trace[0].detail.command, 'gate');
  assert.equal(sc.trace[0].detail.result.final, 'fail');
  assert.ok(sc.trace[0].detail.params.diagram.endsWith('bad.json'));
  assert.ok(typeof sc.trace[0].detail.result.gates.validate === 'number', '各闸退出码入 detail');
  assert.equal(sc.revision, 1, '留痕写侧车推进 CAS revision');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B1 gate：--no-trace 关闭留痕；--sidecar 缺失时降级 warning 不阻断主结果', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir);
  const bad = writeBadSpec(dir);
  const r1 = run(['gate', '--diagram', bad, '--out', path.join(dir, 'o1.html'), '--sidecar', sidecar, '--no-trace']);
  assert.equal(r1.code, 1);
  assert.equal(readSidecar(sidecar).trace, undefined, '--no-trace 不应留痕');

  const missing = path.join(dir, 'no-such-state.json');
  const r2 = run(['gate', '--diagram', bad, '--out', path.join(dir, 'o2.html'), '--sidecar', missing]);
  assert.equal(r2.code, 1, 'gate 主结果（三闸 fail）照常输出');
  assert.ok(r2.receipt.diagnostics.some((d) => d.rule === 'gate_validate' || d.rule === 'gate_archify-missing'));
  const degraded = r2.receipt.diagnostics.find((d) => d.rule === 'trace_degraded');
  assert.ok(degraded, '留痕失败应降级为 diagnostics warning');
  assert.equal(degraded.severity, 'warning');
  assert.ok(!fs.existsSync(missing), '缺失侧车不被留痕创建');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B1 compile：成功留痕（注入节点数入 detail）；失败（bad_input）也留痕；--no-trace 关闭', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { c1: { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [], history: [] } });
  const diagram = path.join(dir, 'spec.json');
  fs.writeFileSync(diagram, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 't', quality_profile: 'showcase', views: [] }, components: [{ id: 'c1', kind: 'service', label: 'C1' }] }));

  const okRun = run(['compile', '--diagram', diagram, '--sidecar', sidecar, '--out', path.join(dir, 'compiled.json')]);
  assert.equal(okRun.code, 0);
  let sc = readSidecar(sidecar);
  assert.equal(sc.trace.length, 1);
  assert.equal(sc.trace[0].kind, 'command');
  assert.equal(sc.trace[0].detail.command, 'compile');
  assert.equal(sc.trace[0].detail.result.injected.tags, 1, '注入节点数入 detail.result');
  assert.deepEqual(sc.trace[0].detail.result.injected.focus, ['c1']);

  const badDiagram = path.join(dir, 'broken.json');
  fs.writeFileSync(badDiagram, 'not json{');
  const failRun = run(['compile', '--diagram', badDiagram, '--sidecar', sidecar, '--out', path.join(dir, 'x.json')]);
  assert.equal(failRun.code, 1);
  assert.equal(failRun.receipt.diagnostics[0].rule, 'bad_input');
  sc = readSidecar(sidecar);
  assert.equal(sc.trace.length, 2, '失败路径同样留痕');
  assert.ok(sc.trace[1].detail.result.error, '失败摘要入 detail.result.error');

  const noTrace = run(['compile', '--diagram', diagram, '--sidecar', sidecar, '--out', path.join(dir, 'y.json'), '--no-trace']);
  assert.equal(noTrace.code, 0);
  assert.equal(readSidecar(sidecar).trace.length, 2, '--no-trace 不涨账');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B1 report：成功留痕（error/warning 计数 + --slice 锚定节点）；A3 失败也留痕；--no-trace 关闭', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });

  const okRun = run(['report', '--sidecar', sidecar, '--slice', 'n1', '--code-sha', 'abc', '--spec-sha', 'def']);
  assert.equal(okRun.code, 0, JSON.stringify(okRun.receipt));
  let sc = readSidecar(sidecar);
  assert.equal(sc.trace.length, 1);
  assert.equal(sc.trace[0].detail.command, 'report');
  assert.equal(sc.trace[0].detail.result.errors, 0);
  assert.equal(sc.trace[0].detail.result.warnings, 0);
  assert.equal(sc.trace[0].node, 'n1', '--slice 锚定节点');
  assert.deepEqual(sc.nodes.n1.traceRefs, [sc.trace[0].id], 'anchors 关系回写 node.traceRefs');

  // A3 失败路径：verified 无证据
  let sc2 = readSidecar(sidecar);
  sc2.nodes.n1.progress = 'verified';
  fs.writeFileSync(sidecar, JSON.stringify(sc2) + '\n');
  const failRun = run(['report', '--sidecar', sidecar, '--code-sha', 'abc', '--spec-sha', 'def']);
  assert.equal(failRun.code, 1);
  sc2 = readSidecar(sidecar);
  assert.equal(sc2.trace.length, 2, '失败路径同样留痕');
  assert.equal(sc2.trace[1].detail.result.errors, 1);

  const before = readSidecar(sidecar).trace.length;
  const noTrace = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(noTrace.code, 1);
  assert.equal(readSidecar(sidecar).trace.length, before, '--no-trace 不涨账');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B1 降级：侧车目录只读时 report 主结果照出（exit 0）+ trace_degraded warning', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });
  fs.chmodSync(dir, 0o555);
  try {
    const r = run(['report', '--sidecar', sidecar, '--code-sha', 'abc', '--spec-sha', 'def']);
    assert.equal(r.code, 0, '留痕失败不阻断主功能：' + JSON.stringify(r.receipt.diagnostics));
    assert.equal(r.receipt.status, 'ok');
    const degraded = (r.receipt.diagnostics || []).find((d) => d.rule === 'trace_degraded');
    assert.ok(degraded, 'ok 信封应附 trace_degraded warning');
    assert.equal(degraded.severity, 'warning');
  } finally {
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B1 边界：state 写命令不自动留痕（history 已覆盖）；trace add --kind command 手动合法', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir);
  const set = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(set.code, 0);
  assert.equal(readSidecar(sidecar).trace, undefined, 'state set 不自动记 trace（replay 三源合并防污染）');

  const add = run(['trace', 'add', '--kind', 'command', '--note', '手动补语义', '--sidecar', sidecar]);
  assert.equal(add.code, 0);
  assert.equal(add.receipt.data.event.kind, 'command', 'command 入 kind 枚举');
  fs.rmSync(dir, { recursive: true, force: true });
});
