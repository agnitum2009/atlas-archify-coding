// 0.32.0 接驳 archify v3：gate 按内核契约族选闸链（v3 多溯源 check）、子进程关闭联网更新检查、回执带 kernel。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGate, gateNamesFor, failedStageKernelDiagnostics } from '../lib/gate.mjs';
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

// 0.37.4：失败闸内核诊断结构化带出；v3 check 复核信号转述（纯增字段）。
test('0.37.4 validate 非零：results.validate.kernelDiagnostics 带前 8 条 code/subject，缺 code 的不计', (t) => {
  const diags = Array.from({ length: 10 }, (_, i) => ({ code: 'composition/label-gap', severity: 'error', subject: { path: '/connections/' + i }, message: 'gap ' + i, supportedFixes: ['x'] }));
  diags.push({ message: 'no code here' });
  const f = setup(t, { validateExit: 1, extraValidate: '{ diagnostics: ' + JSON.stringify(diags) + ' }' });
  const r = runGate(f.spec, f.out, f.bin);
  assert.deepEqual([r.final, r.stage, r.reason], ['fail', 'validate', 'validate-failed']);
  const kd = r.results.validate.kernelDiagnostics;
  assert.equal(kd.length, 8, '有界：最多 8 条');
  assert.deepEqual(kd[0], { code: 'composition/label-gap', severity: 'error', subject: { path: '/connections/0' }, message: 'gap 0' });
  assert.ok(kd.every((d) => d.code), '无 code 的诊断不带出');
  assert.equal(r.results.deliver, undefined);
});

test('0.37.4 check 非零：results.check.kernelDiagnostics 带出；通过时 receipt.review 转述 composition 信号', (t) => {
  const f1 = setup(t, { checkExit: 1, extraCheck: "{ diagnostics: [{ code: 'delivery/provenance-mismatch', message: 'm' }] }" });
  const r1 = runGate(f1.spec, f1.out, f1.bin);
  assert.deepEqual(r1.results.check.kernelDiagnostics.map((d) => d.code), ['delivery/provenance-mismatch']);
  const composition = {
    metrics: { resolvedCrossovers: 2, routesOverSuggestedBends: 1, routesOverSuggestedStretch: 0, maxBends: 3 },
    routeReview: { crossings: Array.from({ length: 9 }, (_, i) => ({ left: { from: 'a', to: 'b' + i } })), detours: [] },
    leadingSpace: { reviewSuggested: true, emptyTopPx: 200 },
  };
  const f2 = setup(t, { extraCheck: '{ composition: ' + JSON.stringify(composition) + ' }' });
  const r2 = runGate(f2.spec, f2.out, f2.bin);
  assert.equal(r2.final, 'pass', r2.tail);
  const review = r2.results.check.receipt.review;
  assert.deepEqual(review.signals, { resolvedCrossovers: 2, routesOverSuggestedBends: 1, routesOverSuggestedStretch: 0 }, '只转述三项复核信号');
  assert.equal(review.routeReview.crossings.length, 8);
  assert.equal(review.routeReview.truncated, true);
  assert.deepEqual(review.routeReview.detours, []);
  assert.equal(review.leadingSpaceReviewSuggested, true);
  assert.equal(review.sequenceColumnSpaceReviewSuggested, null);
  assert.equal(r2.visualReview, 'pending', '转述信号不改人工复核边界');
  const f3 = setup(t);
  const r3 = runGate(f3.spec, f3.out, f3.bin);
  assert.deepEqual(r3.results.check.receipt.review, { signals: {}, routeReview: null, leadingSpaceReviewSuggested: null, sequenceColumnSpaceReviewSuggested: null }, '空 composition → 空信号而非缺字段');
});

test('0.37.4 CLI：validate 失败 → fail 信封 data.kernelDiagnostics 与 gate-detail.kernelDiagnostics 带内核码；通过 → gate-detail.review 带信号', (t) => {
  const mk = (extra) => {
    const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-v3-kd-'));
    t.after(() => fs.rmSync(atlas, { recursive: true, force: true }));
    fs.mkdirSync(path.join(atlas, 'state'), { recursive: true });
    fs.mkdirSync(path.join(atlas, 'spec', 'demo'), { recursive: true });
    const spec = path.join(atlas, 'spec', 'demo', 'demo.json');
    fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', output: 'out.html' }, components: [] }));
    fs.writeFileSync(path.join(atlas, 'state', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-demo.json' }] }));
    const sidecar = path.join(atlas, 'state', 'atlas-demo.json');
    fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: {} }, null, 2) + '\n');
    const bin = writeFakeArchifyV3(path.join(atlas, 'skill'), extra);
    const cliBin = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
    const r = spawnSync(process.execPath, [cliBin, 'gate', '--diagram', spec, '--out', path.join(atlas, 'out.html'), '--sidecar', sidecar],
      { encoding: 'utf8', env: { ...process.env, ARCHIFY_BIN: bin } });
    const entry = JSON.parse(fs.readFileSync(path.join(atlas, 'data', 'demo', 'gate-detail.jsonl'), 'utf8').trim().split('\n').pop());
    return { r, entry, receipt: JSON.parse(r.stdout) };
  };
  const failed = mk({ validateExit: 1, extraValidate: "{ diagnostics: [{ code: 'schema/enum', subject: { path: '/components/0/type', identity: 'api' }, message: 'must be equal to one of the allowed values' }] }" });
  assert.equal(failed.r.status, 1, failed.r.stdout);
  assert.equal(failed.receipt.diagnostics[0].rule, 'gate_validate-failed', '既有规则码不变');
  assert.deepEqual(failed.receipt.data.kernelDiagnostics, [{ code: 'schema/enum', severity: null, subject: { path: '/components/0/type', identity: 'api' }, message: 'must be equal to one of the allowed values' }]);
  assert.deepEqual(failed.entry.kernelDiagnostics, ['schema/enum']);
  assert.equal(failed.entry.review, null);
  const passed = mk({ extraCheck: "{ composition: { metrics: { resolvedCrossovers: 1 }, routeReview: { crossings: [{ sharedNode: 'api' }], detours: [] } } }" });
  assert.equal(passed.r.status, 0, passed.r.stdout);
  assert.equal(passed.receipt.data.kernelDiagnostics, undefined, '通过时无该字段');
  assert.equal(passed.entry.kernelDiagnostics, null);
  assert.deepEqual(passed.entry.review.signals, { resolvedCrossovers: 1 });
  assert.deepEqual(passed.entry.review.routeReview.crossings, [{ sharedNode: 'api' }]);
  assert.equal(passed.receipt.data.visualReview, 'pending');
});

test('0.37.4 边界：deliver 非零带 kernelDiagnostics；无可解析诊断为 []；archify-missing 与 visual-check 失败为 null；crowdedSides 透传', (t) => {
  const f1 = setup(t, { extraDeliver: "{ ok: false, diagnostics: [{ code: 'delivery/lock-stale', evidence: { lock: 'x' } }] }" });
  // extraDeliver 只改回执不改退出码：走 deliver-receipt 分支，不适用 → 无 kernelDiagnostics
  const r1 = runGate(f1.spec, f1.out, f1.bin);
  assert.deepEqual([r1.stage, r1.reason], ['deliver', 'deliver-receipt']);
  assert.equal(failedStageKernelDiagnostics(r1), null, '回执契约不符不是内核非零退出');
  const f2 = setup(t, { validateExit: 1 });
  const r2 = runGate(f2.spec, f2.out, f2.bin);
  assert.deepEqual(r2.results.validate.kernelDiagnostics, [], '内核非零但无诊断 → []');
  assert.deepEqual(failedStageKernelDiagnostics(r2), []);
  const f3 = setup(t, { validateExit: 1, extraValidate: "{ diagnostics: [{ code: 'composition/label-gap', evidence: { minimumPx: 21 } }] }" });
  const r3 = runGate(f3.spec, f3.out, f3.bin);
  assert.equal(r3.results.validate.kernelDiagnostics[0].message, '', 'evidence 为对象时不落成 [object Object]');
  const missing = runGate(f3.spec, f3.out, path.join(f3.dir, 'nope.mjs'));
  assert.equal(missing.stage, 'archify-missing');
  assert.equal(failedStageKernelDiagnostics(missing), null);
  const f4 = setup(t, { visualStatus: 'fail' });
  const r4 = runGate(f4.spec, f4.out, f4.bin);
  assert.equal(r4.stage, 'visual-check');
  assert.equal(failedStageKernelDiagnostics(r4), null);
  const f5 = setup(t, { extraCheck: "{ composition: { metrics: { resolvedCrossovers: '3' }, routeReview: { crossings: [], detours: [], crowdedSides: [{ node: 'api', side: 'left' }] } } }" });
  const r5 = runGate(f5.spec, f5.out, f5.bin);
  assert.deepEqual(r5.results.check.receipt.review.signals, {}, '非有限数值不转述');
  assert.deepEqual(r5.results.check.receipt.review.routeReview.crowdedSides, [{ node: 'api', side: 'left' }]);
});
