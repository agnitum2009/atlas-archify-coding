// 0.32.0 接驳 archify v3：gate 按内核契约族选闸链（v3 多溯源 check）、子进程关闭联网更新检查、回执带 kernel。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGate, gateNamesFor } from '../lib/gate.mjs';
import { spawnSync } from 'node:child_process';
import { writeFakeArchifyV3 } from './fake-archify.mjs';

function setup(t, opts = {}, version = '3.0.1') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-v3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const probe = path.join(dir, 'probe.jsonl');
  const bin = writeFakeArchifyV3(path.join(dir, 'skill'), { probe, ...opts }, version);
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', output: 'out.html' }, components: [] }));
  const calls = () => fs.readFileSync(probe, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { dir, bin, spec, out: path.join(dir, 'out.html'), calls };
}

test('gateNamesFor：v2 三闸、v3 四闸', () => {
  assert.deepEqual(gateNamesFor('v2'), ['validate', 'deliver', 'visual_check']);
  assert.deepEqual(gateNamesFor('v3'), ['validate', 'deliver', 'check', 'visual_check']);
  assert.deepEqual(gateNamesFor(undefined), ['validate', 'deliver', 'visual_check']);
});

test('v3：四闸依序通过；check 与 visual-check 带 --require-provenance；全部子进程关闭更新检查；回执带 kernel', (t) => {
  const f = setup(t);
  const r = runGate(f.spec, f.out, f.bin);
  assert.equal(r.final, 'pass', r.tail);
  assert.deepEqual(r.kernel, { version: '3.0.1', profile: 'v3', versionKnown: true });
  assert.deepEqual(Object.keys(r.results), ['validate', 'deliver', 'check', 'visual_check']);
  assert.equal(r.results.check.receipt.provenance, 'current');
  const calls = f.calls();
  assert.deepEqual(calls.map((c) => c.cmd), ['validate', 'deliver', 'check', 'visual-check']);
  assert.ok(calls.find((c) => c.cmd === 'check').argv.includes('--require-provenance'));
  assert.ok(calls.find((c) => c.cmd === 'visual-check').argv.includes('--require-provenance'));
  assert.ok(calls.every((c) => c.updateCheckDisabled === '1'));
});

test('v3 check 非零：停在 check，reason=check-failed，诊断原样带出', (t) => {
  const f = setup(t, { checkExit: 1, extraCheck: "{ diagnostics: [{ code: 'delivery/provenance-mismatch', message: 'artifact bytes differ' }] }" });
  const r = runGate(f.spec, f.out, f.bin);
  assert.deepEqual([r.final, r.stage, r.reason], ['fail', 'check', 'check-failed']);
  assert.match(r.tail, /内核诊断\[delivery\/provenance-mismatch\]/);
  assert.equal(r.results.visual_check, undefined);
});

for (const [name, extra] of [
  ['provenance 非 current', "{ provenance: 'unknown' }"],
  ['deliveryReceiptId 不符', "{ deliveryReceiptId: 'other' }"],
  ['artifact sha256 不符', "{ artifact: { sha256: 'x', bytes: 1 } }"],
  ['file 不是本次产物', "{ file: '/elsewhere.html' }"],
  ['ok 非 true', '{ ok: false }'],
]) {
  test('v3 check 回执契约：' + name + ' → check-receipt', (t) => {
    const f = setup(t, { extraCheck: extra });
    const r = runGate(f.spec, f.out, f.bin);
    assert.deepEqual([r.final, r.stage, r.reason], ['fail', 'check', 'check-receipt'], r.tail);
  });
}

test('v3 deliver 回执缺 receiptId：check 闸不放行', (t) => {
  const f = setup(t, { extraDeliver: '{ receiptId: undefined }' });
  const r = runGate(f.spec, f.out, f.bin);
  assert.deepEqual([r.final, r.stage, r.reason], ['fail', 'check', 'check-receipt'], r.tail);
});

test('v2（2.16.0）：三闸不变，visual-check 不带 --require-provenance，仍关闭更新检查', (t) => {
  const f = setup(t, {}, '2.16.0');
  const r = runGate(f.spec, f.out, f.bin);
  assert.equal(r.final, 'pass', r.tail);
  assert.deepEqual(r.kernel, { version: '2.16.0', profile: 'v2', versionKnown: true });
  assert.deepEqual(Object.keys(r.results), ['validate', 'deliver', 'visual_check']);
  const calls = f.calls();
  assert.deepEqual(calls.map((c) => c.cmd), ['validate', 'deliver', 'visual-check']);
  assert.equal(calls.find((c) => c.cmd === 'visual-check').argv.includes('--require-provenance'), false);
  assert.ok(calls.every((c) => c.updateCheckDisabled === '1'));
});

test('版本未知（无 package.json）：按 v2 闸链，kernel.versionKnown=false；archify 缺失：kernel=null', (t) => {
  const f = setup(t, {}, null);
  const r = runGate(f.spec, f.out, f.bin);
  assert.equal(r.final, 'pass', r.tail);
  assert.deepEqual(r.kernel, { version: null, profile: 'v2', versionKnown: false });
  const missing = runGate(f.spec, f.out, path.join(f.dir, 'nope.mjs'));
  assert.deepEqual([missing.final, missing.stage, missing.kernel], ['fail', 'archify-missing', null]);
});

// —— 0.32.1（umax 切到 v3 后，三项暂缓 Minor 转正）——
for (const [name, extra] of [
  ['provenance 非 current', "{ provenance: 'unknown' }"],
  ['deliveryReceiptId 不符', "{ deliveryReceiptId: 'other' }"],
  ['缺溯源字段', '{ provenance: undefined, deliveryReceiptId: undefined }'],
]) {
  test('0.32.1 v3 visual-check 回执溯源：' + name + ' → visual-check-artifact-mismatch（与 check 闸同口径，不只靠内核退出码）', (t) => {
    const f = setup(t, { extraVisual: extra });
    const r = runGate(f.spec, f.out, f.bin);
    assert.deepEqual([r.final, r.stage, r.reason], ['fail', 'visual-check', 'visual-check-artifact-mismatch'], r.tail);
    assert.match(r.tail, /溯源/);
  });
}

test('0.32.1 v2 visual-check 回执不要求溯源字段（2.x 无此契约）', (t) => {
  const f = setup(t, { extraVisual: '{ provenance: undefined, deliveryReceiptId: undefined }' }, '2.16.0');
  assert.equal(runGate(f.spec, f.out, f.bin).final, 'pass');
});

test('0.32.1 v3 停在 deliver：gate-detail.jsonl 与侧车留痕都把 check / visual_check 记为 skip，并带 kernel', (t) => {
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-v3-atlas-'));
  t.after(() => fs.rmSync(atlas, { recursive: true, force: true }));
  fs.mkdirSync(path.join(atlas, 'state'), { recursive: true });
  fs.mkdirSync(path.join(atlas, 'spec', 'demo'), { recursive: true });
  const spec = path.join(atlas, 'spec', 'demo', 'demo.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', output: 'out.html' }, components: [] }));
  fs.writeFileSync(path.join(atlas, 'state', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-demo.json' }] }));
  const sidecar = path.join(atlas, 'state', 'atlas-demo.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: {} }, null, 2) + '\n');
  const bin = writeFakeArchifyV3(path.join(atlas, 'skill'), { extraDeliver: '{ ok: false }' });
  const cliBin = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [cliBin, 'gate', '--diagram', spec, '--out', path.join(atlas, 'out.html'), '--sidecar', sidecar],
    { encoding: 'utf8', env: { ...process.env, ARCHIFY_BIN: bin } });
  assert.equal(r.status, 1, r.stdout);
  const log = path.join(atlas, 'data', 'demo', 'gate-detail.jsonl');
  const e = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop());
  assert.equal(e.stage, 'deliver');
  assert.equal(e.kernel.profile, 'v3');
  assert.deepEqual(Object.keys(e.gates), ['validate', 'deliver', 'check', 'visual_check']);
  assert.deepEqual([e.gates.check.status, e.gates.visual_check.status], ['skip', 'skip']);
  const trace = JSON.parse(fs.readFileSync(sidecar, 'utf8')).trace.pop();
  assert.deepEqual(trace.detail.result.kernel, { version: '3.0.1', profile: 'v3', versionKnown: true });
  assert.deepEqual([trace.detail.result.gateDetail.check.status, trace.detail.result.gateDetail.visual_check.status], ['skip', 'skip']);
});
