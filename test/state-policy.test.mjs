import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkStateWritePolicy } from '../lib/state-policy.mjs';

const base = () => ({ progress: 'planned', truth: 'candidate', ledger: 'clean', evidence: [] });
function check(before, after, operation = 'set', axis = 'progress', correction = false, cwd = process.cwd()) {
  return checkStateWritePolicy({ before, after, operation, axis, correction, cwd, nodeId: 'n' });
}

test('set cancelled count admits only its actual waived rule', () => {
  const before = base();
  assert.deepEqual(check(before, { ...before, progress: 'cancelled' }, 'set', 'progress', true), { diagnostics: [], admittedRules: ['cancelled_requires_evidence'] });
  assert.equal(check(before, { ...before, progress: 'cancelled' }).diagnostics[0].rule, 'cancelled_requires_evidence');
});

test('policy distinguishes claims, cancellation, removal, and set same-value/class boundaries', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-policy-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, 'proof'), 'valid\n');
  const before = base();
  const bad = { ...before, evidence: ['missing:1'] };
  for (const operation of ['set', 'transition']) {
    const verified = check(bad, { ...bad, progress: 'verified' }, operation, 'progress', true, cwd);
    assert.deepEqual(verified.admittedRules, operation === 'set' ? ['evidence_unresolvable'] : []);
    assert.equal(verified.diagnostics.length, operation === 'set' ? 0 : 1);
    assert.deepEqual(check(bad, { ...bad, progress: 'cancelled' }, operation, 'progress', false, cwd), { diagnostics: [], admittedRules: [] });
    for (const truth of ['effective', 'closed']) {
      assert.equal(check(before, { ...before, truth }, operation, 'truth', true).diagnostics[0].rule, 'verified_requires_evidence');
      assert.equal(check(bad, { ...bad, truth }, operation, 'truth', true, cwd).diagnostics[0].rule, 'evidence_unresolvable');
    }
  }
  for (const claim of [{ progress: 'verified' }, { progress: 'cancelled' }, { ledger: 'settled' }, { truth: 'effective' }, { truth: 'closed' }]) {
    const node = { ...bad, ...claim };
    assert.deepEqual(check(node, { ...node }, 'set', Object.keys(claim)[0], true, cwd), { diagnostics: [], admittedRules: [] });
    assert.deepEqual(check(node, { ...node, class: 'task' }, 'set', 'class', true, cwd), { diagnostics: [], admittedRules: [] });
    assert.equal(check(node, { ...node, evidence: [] }, 'evidence-remove', undefined, true, cwd).diagnostics[0].rule, 'verified_requires_evidence');
    assert.deepEqual(check({ ...node, evidence: ['proof:1', 'missing:1'] }, node, 'evidence-remove', undefined, true, cwd), { diagnostics: [], admittedRules: [] });
  }
  for (const operation of ['settle', 'import']) {
    assert.equal(check(bad, { ...bad, progress: 'verified', ledger: 'settled' }, operation, undefined, true, cwd).diagnostics[0].rule, 'evidence_unresolvable');
    const done = { ...before, progress: 'verified', ledger: 'settled' };
    assert.equal(check(done, { ...done }, operation).diagnostics[0].rule, 'verified_requires_evidence');
  }
  const good = { ...before, evidence: ['proof:1'] };
  assert.deepEqual(check(good, { ...good, progress: 'verified' }, 'set', 'progress', true, cwd), { diagnostics: [], admittedRules: [] });
});

test('ledger correction exempts only the cross-axis event rule, even with zero evidence', () => {
  for (const operation of ['set', 'transition']) {
    const before = { ...base(), ledger: 'backlog' };
    assert.deepEqual(check(before, { ...before, ledger: 'settled' }, operation, 'ledger', true), { diagnostics: [], admittedRules: ['settled_requires_event'] });
    assert.equal(check(before, { ...before, ledger: 'settled' }, operation, 'ledger').diagnostics[0].rule, 'settled_requires_event');
  }
});
