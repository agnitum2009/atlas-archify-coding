// report A1 图码对账牙齿（--spec 显式传入才启用；不传 = 现状完全一致）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReport } from '../lib/report.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function specOf(ids) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'a1-test', quality_profile: 'showcase' },
    components: ids.map((id) => ({ id, type: 'backend', label: id, pos: [0, 0], size: [100, 60] })),
    boundaries: [],
    connections: [],
  };
}

function nodeOf(over) {
  return Object.assign({ owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, over || {});
}

test('A1a：verified/settled 无证据 → error a1-missing-evidence（与 A3 规则码并存，不合并）', () => {
  const sidecar = { schemaVersion: 1, nodes: { n: nodeOf({ progress: 'verified', ledger: 'settled' }) } };
  const r = buildReport(sidecar, { specs: [specOf(['n'])] });
  const rules = r.errors.map((e) => e.rule).sort();
  assert.deepEqual(rules, ['a1-missing-evidence', 'verified_requires_evidence']);
  assert.equal(r.a1.errors, 1);
  assert.ok(r.a1.nonClaims.length >= 1, 'nonClaims 必须显式声明未检查方面');
});

test('A1a：truth∈{effective,closed} 单轴声称对齐，无证据同样 error', () => {
  const sidecar = { schemaVersion: 1, nodes: { n: nodeOf({ truth: 'effective' }) } };
  const r = buildReport(sidecar, { specs: [specOf(['n'])] });
  assert.ok(r.errors.some((e) => e.rule === 'a1-missing-evidence' && e.subject === 'n'));
});

test('A1b：in_progress/blocked 无证据 → warning a1-weak-assertion；planned 无证据不发声', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      wip: nodeOf({ progress: 'in_progress' }),
      stuck: nodeOf({ progress: 'blocked' }),
      quiet: nodeOf({ progress: 'planned' }),
    },
  };
  const r = buildReport(sidecar, { specs: [specOf(['wip', 'stuck', 'quiet'])] });
  assert.equal(r.errors.length, 0);
  const weak = r.warnings.filter((w) => w.rule === 'a1-weak-assertion');
  assert.deepEqual(weak.map((w) => w.subject).sort(), ['stuck', 'wip']);
  assert.equal(r.a1.checkedNodes, 3);
  assert.equal(r.a1.errors, 0);
});

test('A1c：声称对齐节点携带失效 locator → error a1-evidence-broken（压过通用 lint warning）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-lint-'));
  const good = path.join(dir, 'good.ts');
  fs.writeFileSync(good, 'x\ny\n');
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      aligned: nodeOf({ progress: 'verified', evidence: [good + ':1', path.join(dir, 'missing.ts') + ':1'] }),
      casual: nodeOf({ progress: 'in_progress', evidence: [path.join(dir, 'missing.ts') + ':2'] }),
    },
  };
  const r = buildReport(sidecar, { root: dir, specs: [specOf(['aligned', 'casual'])] });
  const broken = r.errors.filter((e) => e.rule === 'a1-evidence-broken');
  assert.equal(broken.length, 1);
  assert.equal(broken[0].subject, 'aligned');
  // 未声称对齐节点保持既有语义：失效 locator 仍是 warning，不升格。
  const lintWarn = r.warnings.filter((w) => w.rule === 'evidence_lint_warnings');
  assert.equal(lintWarn.length, 1);
  assert.equal(lintWarn[0].subject, 'casual');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A1d：多 spec 聚合 + 账外节点/图外节点各自 warning', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      a: nodeOf(),
      b: nodeOf({ progress: 'in_progress' }),
      ghost: nodeOf(),
    },
  };
  // a 在 spec1，b 在 spec2，z 只在 spec：聚合后 a/b 均已入图；ghost=账外；z=图外。
  const r = buildReport(sidecar, { specs: [specOf(['a']), specOf(['b', 'z'])] });
  const unmatched = r.warnings.filter((w) => w.rule === 'a1-unmatched-account');
  const unaccounted = r.warnings.filter((w) => w.rule === 'a1-unaccounted-node');
  assert.deepEqual(unmatched.map((w) => w.subject), ['ghost']);
  assert.deepEqual(unaccounted.map((w) => w.subject), ['z']);
  assert.equal(r.a1.specs, 2);
  assert.equal(r.a1.specComponentIds, 3);
});

test('A1d2：lifecycle spec 的 states 参与图账交叉（图账同 id）', () => {
  const lifecycleSpec = {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'lc', quality_profile: 'showcase' },
    lanes: [{ id: 'main', label: '主轨' }],
    states: [
      { id: 'pile-1', type: 'neutral', label: 'P1', lane: 'main', col: 0 },
      { id: 'pile-2', type: 'neutral', label: 'P2', lane: 'main', col: 1 },
    ],
    transitions: [],
  };
  const sidecar = {
    schemaVersion: 1,
    nodes: { 'pile-1': nodeOf({ progress: 'planned' }) },
  };
  const r = buildReport(sidecar, { specs: [lifecycleSpec] });
  assert.equal(r.a1.specComponentIds, 2);
  const unaccounted = r.warnings.filter((w) => w.rule === 'a1-unaccounted-node');
  assert.deepEqual(unaccounted.map((w) => w.subject), ['pile-2']);
  assert.equal(r.errors.length, 0);
});

test('A1e：不传 --spec → 无 a1 小节，行为与现状完全一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-nospec-'));
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      a3: nodeOf({ progress: 'verified' }), // A3 error 仍触发
      wip: nodeOf({ progress: 'in_progress' }), // 现状：无证据不发声
      lintBad: nodeOf({ progress: 'in_progress', evidence: [path.join(dir, 'no.ts') + ':1'] }), // 现状：warning
    },
  };
  const r = buildReport(sidecar, { root: dir });
  assert.ok(!('a1' in r), '未传 spec 时不得出现 a1 小节');
  assert.deepEqual(r.errors.map((e) => e.rule), ['verified_requires_evidence']);
  assert.deepEqual(
    r.warnings.filter((w) => !w.rule.startsWith('missing_')).map((w) => w.rule),
    ['evidence_lint_warnings'],
  );
  assert.ok(!r.warnings.some((w) => w.rule.startsWith('a1-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

function runCli(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

test('CLI：--spec 可重复；a1 error → status=failed + exit 1 + 失败信封仍带 a1 小节', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-cli-'));
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      a: nodeOf({ progress: 'planned' }), // 在 spec1：无警告
      b: nodeOf({ progress: 'verified' }), // 在 spec2：A3 + A1 双 error
    },
  };
  const sidecarPath = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));
  const spec1 = path.join(dir, 's1.json');
  const spec2 = path.join(dir, 's2.json');
  fs.writeFileSync(spec1, JSON.stringify(specOf(['a'])));
  fs.writeFileSync(spec2, JSON.stringify(specOf(['b'])));

  const bad = runCli(['report', '--sidecar', sidecarPath, '--spec', spec1, '--spec', spec2]);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.status, 'failed');
  const rules = bad.receipt.diagnostics.map((d) => d.rule).sort();
  assert.deepEqual(rules, ['a1-missing-evidence', 'verified_requires_evidence']);
  assert.equal(bad.receipt.data.a1.checkedNodes, 2);
  assert.equal(bad.receipt.data.a1.errors, 1);
  assert.ok(Array.isArray(bad.receipt.data.a1.nonClaims));

  // 同一侧车不传 --spec：无 a1 小节，无 a1 诊断（但 A3 error 仍按现状触发 → exit 1）。
  const plain = runCli(['report', '--sidecar', sidecarPath]);
  assert.equal(plain.code, 1);
  assert.ok(!plain.receipt.data || !('a1' in plain.receipt.data), '未传 --spec 不得出现 a1 小节');
  assert.ok(!plain.receipt.diagnostics.some((d) => d.rule.startsWith('a1-')));

  // spec 文件不可读 → fail-loud exit 1（bad_spec），不伪装成功。
  const badFile = runCli(['report', '--sidecar', sidecarPath, '--spec', path.join(dir, 'nope.json')]);
  assert.equal(badFile.code, 1);
  assert.equal(badFile.receipt.diagnostics[0].rule, 'bad_spec');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI：--spec 传入但零 error → exit 0，a1 警告计数可见', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-ok-'));
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      a: nodeOf({ progress: 'in_progress' }), // weak-assertion warning
      ghost: nodeOf({ progress: 'planned' }), // unmatched-account warning
    },
  };
  const sidecarPath = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));
  const spec = path.join(dir, 's.json');
  fs.writeFileSync(spec, JSON.stringify(specOf(['a', 'z']))); // z = unaccounted-node warning

  const r = runCli(['report', '--sidecar', sidecarPath, '--spec', spec]);
  assert.equal(r.code, 0);
  assert.equal(r.receipt.status, 'ok');
  const a1WarnRules = r.receipt.data.warnings.filter((w) => w.rule.startsWith('a1-')).map((w) => w.rule).sort();
  assert.deepEqual(a1WarnRules, ['a1-unaccounted-node', 'a1-unmatched-account', 'a1-weak-assertion']);
  assert.equal(r.receipt.data.a1.warnings, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

// —— 裁定②（2026-08-15）：a1 元节点豁免 ——

test('A1d meta 豁免：kind=meta 节点不报 a1-unmatched-account，计入 metaExempted；非 meta 照报；nonClaims 声明豁免', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      'diagram-x': nodeOf({ kind: 'meta' }),
      'add-cmd-y': nodeOf({ kind: 'meta' }),
      ghost: nodeOf(), // 非 meta：照报
    },
  };
  const r = buildReport(sidecar, { specs: [specOf(['unrelated'])] }); // spec 只含无关组件：ghost 仍账外
  const unmatched = r.warnings.filter((w) => w.rule === 'a1-unmatched-account');
  assert.deepEqual(unmatched.map((w) => w.subject), ['ghost'], 'meta 节点不报，非 meta 回归不变');
  assert.equal(r.a1.metaExempted, 2);
  assert.ok(r.a1.nonClaims.some((c) => c.includes('meta') && c.includes('metaExempted')), 'nonClaims 须声明 meta 豁免');
});

test('A1 meta 计数语义：d 项检查对 meta 整体跳过（meta 节点即使不在 spec 也只计数不报）', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      m: nodeOf({ kind: 'meta' }), // 不在任何 spec：被豁免，只计数
    },
  };
  const r = buildReport(sidecar, { specs: [specOf(['z'])] }); // z = unaccounted-node
  assert.deepEqual(r.warnings.filter((w) => w.rule === 'a1-unmatched-account'), []);
  assert.equal(r.a1.metaExempted, 1);
  assert.equal(r.a1.warnings, 1, '仅剩 unaccounted 一条');
});

test('A1 meta 仅豁免 d 项：a/b/c 对 meta 节点照查不豁免（missing-evidence / weak-assertion / evidence-broken 均照发）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-meta-abc-'));
  const good = path.join(dir, 'good.ts');
  fs.writeFileSync(good, 'x\ny\n');
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      mv: nodeOf({ kind: 'meta', progress: 'verified' }), // a：声称对齐无证据 → a1-missing-evidence
      mw: nodeOf({ kind: 'meta', progress: 'in_progress' }), // b：weak-assertion
      mb: nodeOf({ kind: 'meta', progress: 'verified', evidence: [good + ':1', path.join(dir, 'missing.ts') + ':1'] }), // c：evidence-broken
    },
  };
  const r = buildReport(sidecar, { root: dir, specs: [specOf(['mv', 'mw', 'mb'])] });
  const rules = r.errors.map((e) => e.rule).filter((x) => x.startsWith('a1-'));
  assert.deepEqual(rules.sort(), ['a1-evidence-broken', 'a1-missing-evidence']);
  const weak = r.warnings.filter((w) => w.rule === 'a1-weak-assertion');
  assert.deepEqual(weak.map((w) => w.subject), ['mw']);
  assert.equal(r.a1.metaExempted, 3);
  assert.equal(r.a1.errors, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

