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

