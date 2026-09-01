// trace + lessons 牙齿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTrace, listTraces, replayNode, TRACE_KINDS } from '../lib/trace.mjs';
import { addLesson, listLessons } from '../lib/lessons.mjs';

test('addTrace：事件入账 + anchors（node.traceRefs 回指）+ kind 枚举校验', () => {
  const sidecar = { schemaVersion: 1, nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } } };
  const e = addTrace(sidecar, { kind: 'decision', actor: '一线席位', note: '裁定 B', node: 'n1' });
  assert.equal(sidecar.trace.length, 1);
  assert.ok(e.id.startsWith('trace-'));
  assert.deepEqual(sidecar.nodes.n1.traceRefs, [e.id]);
  assert.equal(listTraces(sidecar, 'n1').length, 1);
  assert.equal(listTraces(sidecar, 'nope').length, 0);
  assert.equal(listTraces(sidecar, null).length, 1);

  assert.throws(() => addTrace(sidecar, { kind: 'nonsense' }), /kind 必须是/);
});

test('addTrace：无 node 锚定的事件仍入账', () => {
  const sidecar = { schemaVersion: 1, nodes: {} };
  const e = addTrace(sidecar, { kind: 'tool_call', actor: 'atlas-engine' });
  assert.equal(sidecar.trace.length, 1);
  assert.equal(e.node, null);
});

test('replayNode：三源合并审计时间线 + 当前状态 + 无节点返回 null', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [
      { at: '2026-08-15T01:00:00.000Z', kind: 'set', from: null, to: null, reason: 'r1', by: 'o' },
      { at: '2026-08-15T03:00:00.000Z', kind: 'settle', from: {}, to: {}, reason: '销账', by: 'o' },
    ] } },
    trace: [
      { id: 'trace-1', at: '2026-08-15T02:00:00.000Z', kind: 'decision', actor: 'owner', note: '裁定', node: 'n1' },
      { id: 'trace-2', at: '2026-08-15T04:00:00.000Z', kind: 'tool_call', actor: 'a', note: 'x', node: 'other' },
    ],
    lessons: [{ id: 'lesson-1', at: '2026-08-15T02:30:00.000Z', rule: 'r', lesson: '教训', source: 'trace-1' }],
  };
  const tl = replayNode(sidecar, 'n1');
  assert.ok(tl);
  assert.equal(tl.events.length, 4); // set + decision + lesson + settle
  assert.equal(tl.events[1].source, 'trace');
  assert.equal(tl.events[2].source, 'lesson');
  assert.equal(tl.current.progress, 'verified');
  assert.equal(replayNode(sidecar, 'nope'), null);
});

test('lessons：add/list + 空 lesson 拒绝', () => {
  const sidecar = { schemaVersion: 1, nodes: {} };
  const l = addLesson(sidecar, { lesson: '禁止全仓回归（天子第一号禁令）', rule: 'no-full-regression', source: 'trace-1' });
  assert.ok(l.id.startsWith('lesson-'));
  assert.equal(listLessons(sidecar).length, 1);
  assert.equal(listLessons(sidecar)[0].rule, 'no-full-regression');
  assert.throws(() => addLesson(sidecar, { lesson: '   ' }), /lesson 不能为空/);
});

