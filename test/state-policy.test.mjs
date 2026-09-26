// lib/state-policy.mjs 单元边界（0.22.0 起按 ADD-SPEC §2.4.2 四族与纠错公理重钉；全空间 CLI 穷举见
// test/invariant-exhaustive.test.mjs，本文件只钉引擎自身的边界：证据移除、同值/无关字段、声称事件、诊断收集）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkStateWritePolicy } from '../lib/state-policy.mjs';

const base = () => ({ progress: 'planned', truth: 'candidate', ledger: 'clean', evidence: [] });
function check(before, after, operation = 'set', axis = 'progress', correction = false, cwd = process.cwd(), extra = {}) {
  return checkStateWritePolicy({ before, after, operation, axis, correction, cwd, nodeId: 'n', ...extra });
}
const rules = (r) => r.diagnostics.map((d) => d.rule);

test('§2.4.2 纠错只豁免 P 族：init 首写取消零证据仍拒（S 族），A2 违表可豁免且只记实际豁免码', () => {
  const before = base();
  assert.deepEqual(rules(check(before, { ...before, progress: 'cancelled' }, 'set', 'progress', true, undefined, { init: true })), ['cancelled_requires_evidence']);
  const inProgress = { ...base(), progress: 'in_progress' };
  assert.deepEqual(check(inProgress, { ...inProgress, progress: 'planned' }, 'set', 'progress', true), { diagnostics: [], admittedRules: ['illegal_transition'] });
  assert.deepEqual(rules(check(inProgress, { ...inProgress, progress: 'planned' })), ['illegal_transition']);
});

test('§2.4.2 声称、取消、移除与同值/无关字段边界', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-policy-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, 'proof'), 'valid\n');
  const before = { ...base(), progress: 'in_progress' };
  const bad = { ...before, evidence: ['missing:1'] };
  // X 族：进入 verified 时锚须可解析，纠错不豁免；cancelled 只要求非空。
  assert.deepEqual(rules(check(bad, { ...bad, progress: 'verified' }, 'set', 'progress', true, cwd)), ['evidence_unresolvable']);
  assert.deepEqual(check({ ...bad, progress: 'planned' }, { ...bad, progress: 'cancelled' }, 'set', 'progress', false, cwd), { diagnostics: [], admittedRules: [] });
  for (const truth of ['effective', 'closed']) {
    const from = { ...before, truth: truth === 'effective' ? 'pending_confirmation' : 'effective' };
    assert.deepEqual(rules(check(from, { ...from, truth }, 'set', 'truth', true)), ['verified_requires_evidence']);
    const fromBad = { ...from, evidence: ['missing:1'] };
    assert.deepEqual(rules(check(fromBad, { ...fromBad, truth }, 'set', 'truth', true, cwd)), ['evidence_unresolvable']);
  }
  // 存量不冻结：同值写与无关字段写不重验旧证据；移除最后一条证据仍拒；移除后剩坏锚不拦（X 族只在进入声称时判定）。
  for (const claim of [{ progress: 'verified' }, { progress: 'cancelled' }, { ledger: 'settled', progress: 'verified' }, { truth: 'effective' }, { truth: 'closed' }]) {
    const node = { ...bad, ...claim };
    assert.deepEqual(check(node, { ...node }, 'set', Object.keys(claim)[0], true, cwd), { diagnostics: [], admittedRules: [] });
    assert.deepEqual(check(node, { ...node, class: 'task' }, 'set', 'class', true, cwd), { diagnostics: [], admittedRules: [] });
    assert.deepEqual(rules(check(node, { ...node, evidence: [] }, 'evidence-remove', undefined, false, cwd)), ['verified_requires_evidence']);
    assert.deepEqual(check({ ...node, evidence: ['proof:1', 'missing:1'] }, node, 'evidence-remove', undefined, false, cwd), { diagnostics: [], admittedRules: [] });
  }
  // 声称事件：settle/import 无论前态一律要求证据非空且可解析。
  for (const operation of ['settle', 'import']) {
    assert.deepEqual(rules(check(bad, { ...bad, progress: 'verified', ledger: 'settled' }, operation, undefined, false, cwd)), ['evidence_unresolvable']);
    const done = { ...base(), progress: 'verified', ledger: 'settled' };
    assert.deepEqual(rules(check(done, { ...done }, operation)), ['verified_requires_evidence']);
  }
  const good = { ...before, evidence: ['proof:1'] };
  assert.deepEqual(check(good, { ...good, progress: 'verified' }, 'set', 'progress', true, cwd), { diagnostics: [], admittedRules: [] });
});

test('§2.4.2 ledger 纠错只豁免专用事件规则（P），组合与证据（S）照拦；违规全收集', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-policy-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, 'proof'), 'valid\n');
  const verified = { ...base(), progress: 'verified', ledger: 'backlog', evidence: ['proof:1'] };
  assert.deepEqual(check(verified, { ...verified, ledger: 'settled' }, 'set', 'ledger', true, cwd), { diagnostics: [], admittedRules: ['settled_requires_event'] });
  const planned = { ...base(), ledger: 'backlog' };
  assert.deepEqual(rules(check(planned, { ...planned, ledger: 'settled' }, 'set', 'ledger', true)), ['settled_requires_verified', 'verified_requires_evidence']);
  assert.deepEqual(rules(check(planned, { ...planned, ledger: 'settled' }, 'transition', 'ledger')), ['settled_requires_event', 'settled_requires_verified', 'verified_requires_evidence']);
  // 0.21.2 回归钉：组合违规不得吞掉证据违规（原提前 return 缺陷）。
  assert.deepEqual(rules(check(planned, { ...planned, progress: 'cancelled' }, 'set', 'progress', true)), ['cancelled_requires_clean', 'cancelled_requires_evidence']);
  // 权限族（调用方传入）排在 P 之后、S 之前，且纠错不滤除。
  const receipt = { rule: 'receipt_required', severity: 'error', subject: 'n', evidence: 'x', supportedFixes: [] };
  assert.deepEqual(rules(check(planned, { ...planned, progress: 'cancelled' }, 'set', 'progress', false, undefined, { authority: [receipt] })), ['receipt_required', 'cancelled_requires_clean', 'cancelled_requires_evidence']);
});
