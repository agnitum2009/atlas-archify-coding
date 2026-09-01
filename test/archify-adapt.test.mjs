// 0.14.0（archify 2.16.0-dev.0 适配批）回归钉：
// ① doctor 版本机检（关闭 2026-08-17 评估记录的「纸面钉版无机器验证」缺口）——
//    探到版本则报 version=，低于耦合基线/探不到版本出提示级 warning（不改 ok/exit）；
// ② gate 失败尾吸收内核 --json 结构化诊断（新守卫的处置建议不再淹没在截断 JSON 里）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeArchifyVersion, isBelowBaseline, ARCHIFY_BASELINE } from '../lib/resolve-archify.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { runGate } from '../lib/gate.mjs';

function fixtureSkill(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fixture-'));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'archify.mjs'), 'process.exit(0);\n');
  if (version !== null) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'archify-fixture', version }));
  }
  return dir;
}

test('版本探测：bin/../package.json 命中；无 package.json 返 null（不伪装）', () => {
  const dir = fixtureSkill('2.16.0-dev.0');
  assert.equal(probeArchifyVersion(path.join(dir, 'bin', 'archify.mjs')), '2.16.0-dev.0');
  const bare = fixtureSkill(null);
  assert.equal(probeArchifyVersion(path.join(bare, 'bin', 'archify.mjs')), null);
  assert.equal(probeArchifyVersion(null), null);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test('基线判定：只比 major.minor（prerelease 后缀忽略）；解析失败不误报', () => {
  assert.equal(ARCHIFY_BASELINE, '2.14.0');
  assert.equal(isBelowBaseline('2.13.0'), true);
  assert.equal(isBelowBaseline('2.14.0'), false);
  assert.equal(isBelowBaseline('2.16.0-dev.0'), false);
  assert.equal(isBelowBaseline('3.0.0'), false);
  assert.equal(isBelowBaseline('unknown'), false);
});

test('doctor：archify-kernel 报 version=；低于基线附 warning 提示（ok 仍 true）', () => {
  const low = fixtureSkill('2.13.0');
  const dLow = runDoctor({ archifyBin: path.join(low, 'bin', 'archify.mjs') });
  const cLow = dLow.checks.find((c) => c.name === 'archify-kernel');
  assert.equal(cLow.ok, true, '提示级不改 ok 语义');
  assert.ok(cLow.detail.includes('version=2.13.0'), cLow.detail);
  assert.ok(cLow.detail.includes('低于耦合基线 v2.14.0'), cLow.detail);

  const ok = fixtureSkill('2.16.0-dev.0');
  const dOk = runDoctor({ archifyBin: path.join(ok, 'bin', 'archify.mjs') });
  const cOk = dOk.checks.find((c) => c.name === 'archify-kernel');
  assert.ok(cOk.detail.includes('version=2.16.0-dev.0'), cOk.detail);
  assert.ok(!cOk.detail.includes('低于耦合基线'), '达标不出基线提示：' + cOk.detail);
  fs.rmSync(low, { recursive: true, force: true });
  fs.rmSync(ok, { recursive: true, force: true });
});

test('doctor：版本探不到（bin 旁无 package.json）→ 未知提示；ok 仍 true', () => {
  const bare = fixtureSkill(null);
  const d = runDoctor({ archifyBin: path.join(bare, 'bin', 'archify.mjs') });
  const c = d.checks.find((x) => x.name === 'archify-kernel');
  assert.equal(c.ok, true);
  assert.ok(c.detail.includes('version=未知'), c.detail);
  assert.ok(c.detail.includes('不可机检'), c.detail);
  fs.rmSync(bare, { recursive: true, force: true });
});

test('gate：validate 失败且内核输出 --json 诊断 → 失败尾附 code/message/supportedFixes 摘要', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-diag-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [] }));
  const receipt = {
    ok: false,
    diagnostics: [
      { code: 'composition/desktop-readability', message: 'Final artifact failed composition/desktop-readability.', supportedFixes: ['reduce the viewBox width, shorten node copy, widen affected nodes, or split the diagram'] },
      { code: 'layout/constraint', message: 'Boundary label overlaps connection label.', supportedFixes: [] },
    ],
  };
  const stub = path.join(dir, 'archify-fail.mjs');
  fs.writeFileSync(stub, 'console.log(' + JSON.stringify(JSON.stringify(receipt)) + ');\nprocess.exit(1);\n');
  const r = runGate(spec, path.join(dir, 'out.html'), stub);
  assert.equal(r.final, 'fail');
  assert.equal(r.stage, 'validate');
  assert.ok(r.tail.includes('内核诊断[composition/desktop-readability]'), r.tail);
  assert.ok(r.tail.includes('处置建议（1 条）'), 'supportedFixes 摘要进尾：' + r.tail);
  assert.ok(r.tail.includes('另 1 条诊断'), '剩余计数：' + r.tail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate：内核输出非 JSON（stub 文本）→ 失败尾无结构化摘要（纯增不扰旧路径）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-plain-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [] }));
  const stub = path.join(dir, 'archify-fail-plain.mjs');
  fs.writeFileSync(stub, 'console.log("plain failure");\nprocess.exit(1);\n');
  const r = runGate(spec, path.join(dir, 'out.html'), stub);
  assert.equal(r.final, 'fail');
  assert.ok(!r.tail.includes('内核诊断['), '非 JSON 输出不加摘要：' + r.tail);
  assert.ok(r.tail.includes('plain failure'), '原文尾保留');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate：visual-check 失败且回执为子项状态形状 → 失败尾附失败项摘要（0.14.1 补全三闸声称）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-vc-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [] }));
  const receipt = {
    schemaVersion: 1, ok: false, command: 'visual-check', status: 'fail',
    containment: { status: 'fail', viewports: [] },
    readability: { status: 'pass', viewports: [] },
    viewerChrome: { status: 'fail', viewports: [] },
    captures: { status: 'pass', screenshots: [], contactSheet: null },
    sidecars: { receipt: 'x.visual-check.json', contactSheet: 'x.visual-check.html' },
  };
  const stub = path.join(dir, 'archify-vc-fail.mjs');
  fs.writeFileSync(stub, 'const cmd = process.argv[2];\nif (cmd !== "visual-check") { process.exit(0); }\nconsole.log(' + JSON.stringify(JSON.stringify(receipt)) + ');\nprocess.exit(1);\n');
  const r = runGate(spec, path.join(dir, 'out.html'), stub);
  assert.equal(r.final, 'fail');
  assert.equal(r.stage, 'visual-check');
  assert.ok(r.tail.includes('内核诊断[visual-check]'), r.tail);
  assert.ok(r.tail.includes('containment、viewerChrome'), '失败子项逐个点名：' + r.tail);
  assert.ok(r.tail.includes('x.visual-check.html'), '证据路径进尾：' + r.tail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate：visual-check 回执全 pass（status 非 fail）→ 不附摘要（纯增不扰）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-vc-pass-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [] }));
  const receipt = {
    schemaVersion: 1, ok: false, command: 'visual-check', status: 'fail',
    containment: { status: 'pass', viewports: [] },
    readability: { status: 'pass', viewports: [] },
    viewerChrome: { status: 'pass', viewports: [] },
    captures: { status: 'fail', screenshots: [], contactSheet: null },
  };
  const stub = path.join(dir, 'archify-vc-mixed.mjs');
  fs.writeFileSync(stub, 'const cmd = process.argv[2];\nif (cmd !== "visual-check") { process.exit(0); }\nconsole.log(' + JSON.stringify(JSON.stringify(receipt)) + ');\nprocess.exit(1);\n');
  const r = runGate(spec, path.join(dir, 'out.html'), stub);
  assert.equal(r.stage, 'visual-check');
  assert.ok(r.tail.includes('captures'), '只点名真正失败的子项：' + r.tail);
  assert.ok(!r.tail.includes('containment、'), 'pass 子项不点名');
  fs.rmSync(dir, { recursive: true, force: true });
});
