// scripts/trajectory-from-claude-code.mjs：会话日志 → 规整事件；内核 lib/trajectory.mjs 保持 harness 中立。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateEvent } from '../lib/trajectory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'trajectory-from-claude-code.mjs');
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const entry = (ts, cwd, ...blocks) => JSON.stringify({ type: 'assistant', sessionId: 'sess-1', timestamp: ts, cwd, message: { content: blocks } });

function logFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-trajconv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const lines = [
    entry('2026-09-02T00:00:01Z', repo, use('t1', 'Read', { file_path: path.join(repo, 'src/a.mjs') })),
    entry('2026-09-02T00:00:02Z', repo, use('t2', 'Edit', { file_path: path.join(repo, 'src/b.mjs') })),
    entry('2026-09-02T00:00:03Z', repo, use('t3', 'Bash', { command: 'grep -n x src/a.mjs src/c.mjs 2>/dev/null' })),
    entry('2026-09-02T00:00:04Z', repo, use('t4', 'Bash', { command: "sed -i 's/a/b/' src/c.mjs" })),
    entry('2026-09-02T00:00:05Z', repo, use('t5', 'Read', { file_path: '/elsewhere/z.mjs' })),
    JSON.stringify({ type: 'user', timestamp: '2026-09-02T00:00:06Z', message: { content: 'hi' } }),
    'not json',
  ];
  const log = path.join(dir, 'session.jsonl');
  fs.writeFileSync(log, lines.join('\n') + '\n');
  return { dir, repo, log };
}
const convert = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('转换：Read→reads、Edit→writes、Bash 按写模式判定（2>/dev/null 不算写）；--repo 过滤仓外路径；产物全部通过契约', (t) => {
  const f = logFixture(t);
  const res = convert(f.log, '--repo', f.repo);
  assert.equal(res.status, 0, res.stderr);
  const events = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
  for (const e of events) assert.equal(validateEvent(e), null, JSON.stringify(e));
  const p = (rel) => path.join(f.repo, rel);
  assert.deepEqual(events.map((e) => [e.eventId, e.reads, e.writes]), [
    ['t1', [p('src/a.mjs')], []],
    ['t2', [], [p('src/b.mjs')]],
    ['t3', [p('src/a.mjs'), p('src/c.mjs')], []],
    ['t4', [], [p('src/c.mjs')]],
  ]);
  assert.ok(events.every((e) => e.source === 'claude-code' && e.session === 'sess-1'));
});

test('转换：目录递归 *.jsonl；参数错误 exit 2；源不存在 exit 1', (t) => {
  const f = logFixture(t);
  const res = convert(f.dir, '--repo', f.repo);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim().split('\n').length, 4);
  assert.equal(convert().status, 2);
  assert.equal(convert(f.log, '--bogus').status, 2);
  assert.equal(convert(path.join(f.dir, 'nope')).status, 1);
});

test('harness 中立守卫：lib/trajectory.mjs 不含任何 harness 名', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'trajectory.mjs'), 'utf8');
  // 名称按片段拼接：守卫自身不含字面 harness 名（公开投影隐私扫描同样禁这些词）。
  const names = ['clau' + 'de', 'deep' + 'seek', '\\bds' + 'h\\b', '\\bom' + 'p\\b', 'oh-my' + '-pi', '\\bp' + 'i\\b'];
  assert.doesNotMatch(src, new RegExp(names.join('|'), 'i'));
});
