// diff 牙齿：spec 结构差异 + 状态时间线。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpecs, flatten, stateTimeline } from '../lib/diff.mjs';

test('diffSpecs：added/removed/changed 三类行 + 汇总', () => {
  const base = { schema_version: 1, meta: { title: 'T', quality_profile: 'showcase' }, components: [{ id: 'a', label: 'A' }] };
  const head = { schema_version: 1, meta: { title: 'T2', quality_profile: 'showcase' }, components: [{ id: 'a', label: 'A2' }, { id: 'b', label: 'B' }] };
  const { rows, summary } = diffSpecs(base, head);
  assert.equal(summary.changed, 2); // meta.title + components.0.label
  assert.equal(summary.added, 2);   // components.1.id + components.1.label（点路径级差异）
  assert.equal(summary.removed, 0);
  const changed = rows.find((r) => r.subject === 'meta.title');
  assert.equal(changed.kind, 'changed');
  assert.equal(changed.before, 'T');
  assert.equal(changed.after, 'T2');
  const added = rows.find((r) => r.kind === 'added');
  assert.ok(added.subject.startsWith('components.1.'));
});

test('diffSpecs 相同输入 → 零差异（确定性）', () => {
  const spec = { a: 1, nested: { x: 'y' }, list: [1, 2] };
  const { summary } = diffSpecs(spec, JSON.parse(JSON.stringify(spec)));
  assert.equal(summary.added + summary.removed + summary.changed, 0);
});

test('stateTimeline：since 过滤 + 确定性排序 + 字段完整', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      n1: { owner: '一线席位', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [
        { at: '2026-08-14T10:00:00.000Z', kind: 'set', from: null, to: null, reason: 'r1', by: '一线席位' },
        { at: '2026-08-15T09:00:00.000Z', kind: 'settle', from: { progress: 'in_progress', ledger: 'backlog' }, to: { progress: 'verified', ledger: 'settled' }, reason: '销账', by: '一线席位' },
      ] },
      n0: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [
        { at: '2026-08-14T09:00:00.000Z', kind: 'set', from: null, to: null, reason: 'r0', by: '一线席位' },
      ] },
    },
  };
  const all = stateTimeline(sidecar, null);
  assert.equal(all.length, 3);
  assert.equal(all[0].node, 'n0');
  const since = stateTimeline(sidecar, '2026-08-15T00:00:00.000Z');
  assert.equal(since.length, 1);
  assert.equal(since[0].node, 'n1');
  assert.equal(since[0].kind, 'settle');
  assert.equal(since[0].to.progress, 'verified');
});


test('diffSpecs preserves array/object identity at shared containers', () => {
  for (const [base, head, subject] of [
    [{}, [], '#'], [[], {}, '#'], [{ a: {} }, { a: [] }, 'a'],
    [{ components: [{ id: 'a' }] }, { components: { 0: { id: 'a' } } }, 'components'],
    [{ a: [1], ab: 1, 'a.x': 1 }, { a: { 0: 1 }, ab: 2, 'a.x': 2 }, 'a'],
  ]) {
    const result = diffSpecs(base, head);
    const row = result.rows.find((row) => row.subject === subject);
    assert.deepEqual(row, { subject, kind: 'changed', before: base === null ? base : subject === '#' ? base : base[subject], after: subject === '#' ? head : head[subject] });
    assert.equal(result.rows.filter((row) => row.subject.startsWith(subject + '.')).length, 0);
    if (subject === 'a' && base.ab) assert.deepEqual(result.summary, { added: 0, removed: 0, changed: 3 });
    else assert.equal(result.rows.length, 1);
  }
});

test('diffSpecs keeps special segments distinct from nesting and root', () => {
  for (const [base, head] of [
    [{ 'a.b': 1 }, { a: { b: 1 } }],
    [{ 'a\\.b': 1 }, { 'a.b': 1 }],
    [{ '': 1 }, 1], [{ '#': 1 }, 1], [{ '': 1 }, { '\\e': 1 }],
  ]) assert.ok(diffSpecs(base, head).rows.length > 0);
  const flat = flatten(JSON.parse('{"a.b":1,"a\\\\b":2,"":3,"#":4,"__proto__":5,"a":{"b":6}}'));
  assert.equal(Object.getPrototypeOf(flat), null);
  assert.deepEqual(Object.keys(flat).sort(), ['\\#', '\\e', '__proto__', 'a.b', 'a\\.b', 'a\\\\b'].sort());
  assert.equal(flat.__proto__, '5');
  assert.equal(diffSpecs({ a: { b: 1 } }, { a: { b: 2 } }).rows[0].subject, 'a.b');
});

test('diffSpecs keeps empty containers, scalar roots and ordering deterministic', () => {
  for (const value of [{}, [], null, 1, 'x']) assert.deepEqual(diffSpecs(value, value).rows, []);
  assert.deepEqual(diffSpecs({ a: 1, b: 2 }, { b: 2, a: 1 }).rows, []);
  assert.deepEqual(diffSpecs(null, 1).rows, [{ subject: '#', kind: 'changed', before: null, after: 1 }]);
  for (const [base, head] of [[{}, { a: 1 }], [[], [1]]]) {
    assert.deepEqual(diffSpecs(base, head).summary, { added: 1, removed: 1, changed: 0 });
    assert.deepEqual(diffSpecs(head, base).summary, { added: 1, removed: 1, changed: 0 });
  }
});
