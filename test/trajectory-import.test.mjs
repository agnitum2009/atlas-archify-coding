// 轨迹规整事件：契约校验、只追加导入、幂等去重、落点派生（lib/trajectory.mjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateEvent, importEvents, readEvents, trajectoryFile } from '../lib/trajectory.mjs';

function atlasSidecar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-trajimp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = path.join(dir, 'atlas', 'state');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json' }] }));
  return { dir, sidecar: path.join(state, 'atlas-state.json'), data: path.join(dir, 'atlas', 'data', 'demo', 'trajectory.jsonl') };
}
const ev = (over = {}) => ({ schemaVersion: 1, source: 'fixture', session: 's1', eventId: 'e1', at: '2026-09-01T10:00:00Z', tool: 'Read', reads: ['/abs/a.mjs'], writes: [], ...over });

test('validateEvent：合法事件通过；缺字段、相对路径、读写皆空、坏时间被拒', () => {
  assert.equal(validateEvent(ev()), null);
  assert.match(validateEvent(ev({ schemaVersion: 2 })), /schemaVersion/);
  assert.match(validateEvent(ev({ session: '' })), /session/);
  assert.match(validateEvent(ev({ reads: ['rel/a.mjs'] })), /绝对路径/);
  assert.match(validateEvent(ev({ reads: [], writes: [] })), /同时为空/);
  assert.match(validateEvent(ev({ at: 'not-a-time' })), /at/);
  assert.match(validateEvent([]), /JSON 对象/);
});

test('trajectoryFile：atlas 版式派生 data/<项目>/trajectory.jsonl；自由侧车 = trajectory_no_atlas', (t) => {
  const a = atlasSidecar(t);
  assert.equal(trajectoryFile(a.sidecar).file, a.data);
  const free = path.join(a.dir, 'loose', 'x.json');
  fs.mkdirSync(path.dirname(free), { recursive: true });
  assert.throws(() => trajectoryFile(free), (e) => e.code === 'trajectory_no_atlas');
});

test('importEvents：只追加、按 source+session+eventId 幂等去重；readEvents 读回', (t) => {
  const a = atlasSidecar(t);
  const src = path.join(a.dir, 'in.jsonl');
  fs.writeFileSync(src, [ev(), ev({ eventId: 'e2', tool: 'Edit', reads: [], writes: ['/abs/b.mjs'] }), ev()].map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.deepEqual(importEvents(a.sidecar, src), { file: a.data, scanned: 3, appended: 2, duplicates: 1, sources: ['fixture'] });
  const again = importEvents(a.sidecar, src);
  assert.equal(again.appended, 0);
  assert.equal(again.duplicates, 3);
  assert.equal(readEvents(a.sidecar).length, 2);
});

test('importEvents：源不可读 = trajectory_source_unreadable；坏行 = trajectory_bad_event 带行号且零写入', (t) => {
  const a = atlasSidecar(t);
  assert.throws(() => importEvents(a.sidecar, path.join(a.dir, 'nope.jsonl')), (e) => e.code === 'trajectory_source_unreadable');
  assert.throws(() => importEvents(a.sidecar, a.dir), (e) => e.code === 'trajectory_source_unreadable');
  const bad = path.join(a.dir, 'bad.jsonl');
  fs.writeFileSync(bad, JSON.stringify(ev()) + '\n{not json\n');
  assert.throws(() => importEvents(a.sidecar, bad), (e) => e.code === 'trajectory_bad_event' && /第 2 行/.test(e.message));
  assert.equal(fs.existsSync(a.data), false, '坏输入不得部分写入');
});

test('readEvents：无文件 = []；已落盘文件被改坏 = trajectory_bad_event（fail-loud，不静默跳过）', (t) => {
  const a = atlasSidecar(t);
  assert.deepEqual(readEvents(a.sidecar), []);
  fs.mkdirSync(path.dirname(a.data), { recursive: true });
  fs.writeFileSync(a.data, JSON.stringify(ev()) + '\n' + JSON.stringify(ev({ reads: ['x'] })) + '\n');
  assert.throws(() => readEvents(a.sidecar), (e) => e.code === 'trajectory_bad_event' && /第 2 行/.test(e.message));
});

test('valid final JSONL record without LF survives append; duplicate imports leave bytes intact', (t) => {
  const a = atlasSidecar(t);
  const first = ev({ eventId: 'e0' });
  const next = ev({ eventId: 'e1' });
  fs.mkdirSync(path.dirname(a.data), { recursive: true });
  const oldBytes = JSON.stringify(first);
  fs.writeFileSync(a.data, oldBytes);
  const src = path.join(a.dir, 'next.jsonl');
  fs.writeFileSync(src, JSON.stringify(next) + '\n');
  assert.deepEqual(readEvents(a.sidecar), [first]);
  assert.equal(importEvents(a.sidecar, src).appended, 1);
  assert.deepEqual(readEvents(a.sidecar), [first, next]);
  assert.equal(fs.readFileSync(a.data, 'utf8').startsWith(oldBytes + '\n'), true);
  const after = fs.readFileSync(a.data, 'utf8');
  assert.equal(importEvents(a.sidecar, src).appended, 0);
  assert.equal(fs.readFileSync(a.data, 'utf8'), after);
});
