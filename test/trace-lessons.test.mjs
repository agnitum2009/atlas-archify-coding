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


test('shared comparator orders parsed times transitively and retains stable ties and unknown dates', async () => {
  const { compareEventTime, summarizeReplay } = await import('../lib/trace.mjs');
  const older = '2026-09-15T00:00:00Z';
  const newer = '2026-09-15T00:00:00.500Z';
  const same = '2026-09-15T08:00:00+08:00';
  assert.equal(typeof compareEventTime, 'function');
  assert.equal(compareEventTime(older, newer), -1);
  assert.equal(compareEventTime(same, older), 0);
  const times = [newer, '!', older, 'unknown', same];
  for (const a of times) for (const b of times) for (const c of times) {
    if (compareEventTime(a, b) <= 0 && compareEventTime(b, c) <= 0) assert.ok(compareEventTime(a, c) <= 0);
  }
  const sc = { nodes: { n: { history: times.map((at, i) => ({ at, kind: String(i) })) } }, lessons: times.map((at, i) => ({ at, id: String(i), lesson: 'retained', custom: i })) };
  const before = structuredClone(sc);
  assert.deepEqual(replayNode(sc, 'n').events.map(e => e.at), [older, same, newer, '!', 'unknown']);
  assert.deepEqual(summarizeReplay(sc, 'n', 2).events.map(e => e.at), ['!', 'unknown']);
  assert.deepEqual(listLessons(sc, { recent: 5 }).map(e => e.at), ['unknown', '!', newer, older, same]);
  assert.deepEqual(replayNode(sc, 'n', older).events.filter(e => e.at === older || e.at === same).map(e => e.at), [older, same]);
  assert.deepEqual(sc, before);
});
