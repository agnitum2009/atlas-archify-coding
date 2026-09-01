// A1/A2/A3+D3 牙齿（2026-08-15 清单 A 组 token 优化 + D3 经验池生命周期）：
// A1 lessons list --recent/--rule 过滤（缺省不变，回执 total/filtered）
// A2 trace list/replay --since 截窗（含边界；非法格式=exit 1 bad_args 带示例）
// A3 report --brief（计数摘要 + error 诊断；warning 与明细数组略去；exit 语义不变）
// D3 lessons status active|retired + retire 子命令（幂等）+ list 缺省只列 active
// 红线：全部用临时目录侧车，绝不触碰 <home>/demo-ledger/state/atlas-state.json。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { addLesson, listLessons, retireLesson } from '../lib/lessons.mjs';
import { parseSince, listTraces, replayNode } from '../lib/trace.mjs';
import { buildReport } from '../lib/report.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-a1a2a3d3-'));
}

function seedSidecar(dir, over) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({ schemaVersion: 1, atlas: null, nodes: {} }, over || {})) + '\n');
  return p;
}

function nodeOf(over) {
  return Object.assign({ owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, over || {});
}

// —— A1 + D3 lib ——

test('A1/D3 lib：listLessons 缺省全量序不变；--rule 精确匹配；--recent 按 at 倒序截取；组合先 rule 后 recent；非法 recent 抛 bad_args', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {},
    lessons: [
      { id: 'lesson-1', at: '2026-08-15T01:00:00.000Z', rule: 'r1', lesson: 'a', source: null },
      { id: 'lesson-2', at: '2026-08-15T03:00:00.000Z', rule: 'r2', lesson: 'b', source: null },
      { id: 'lesson-3', at: '2026-08-15T02:00:00.000Z', rule: 'r1', lesson: 'c', source: null },
    ],
  };
  // 缺省：全量、插入序不变、hits/status 缺省兜底、不改原对象
  const all = listLessons(sidecar);
  assert.deepEqual(all.map((l) => l.id), ['lesson-1', 'lesson-2', 'lesson-3']);
  assert.ok(all.every((l) => l.hits === 0 && l.status === 'active'));
  assert.equal(sidecar.lessons[0].status, undefined, 'list 返回拷贝不改侧车原对象');
  // --recent：按 at 倒序取最近 N 条
  assert.deepEqual(listLessons(sidecar, { recent: 2 }).map((l) => l.id), ['lesson-2', 'lesson-3']);
  // --rule：精确匹配，保持插入序
  assert.deepEqual(listLessons(sidecar, { rule: 'r1' }).map((l) => l.id), ['lesson-1', 'lesson-3']);
  assert.deepEqual(listLessons(sidecar, { rule: 'r9' }), []);
  // 组合：先 rule 过滤再按 at 倒序截取
  assert.deepEqual(listLessons(sidecar, { rule: 'r1', recent: 1 }).map((l) => l.id), ['lesson-3']);
  assert.deepEqual(listLessons(sidecar, { rule: 'r1', recent: 2 }).map((l) => l.id), ['lesson-3', 'lesson-1']);
  // 非法 --recent fail-loud
  assert.throws(() => listLessons(sidecar, { recent: 0 }), { code: 'bad_args' });
  assert.throws(() => listLessons(sidecar, { recent: 'x' }), { code: 'bad_args' });
  assert.throws(() => listLessons(sidecar, { recent: -1 }), { code: 'bad_args' });
});

test('D3 lib：新条目 status=active；retireLesson 幂等；未知 id 抛 lesson_not_found；list 缺省隐藏 retired，includeRetired 含之', () => {
  const sidecar = { schemaVersion: 1, nodes: {} };
  const l = addLesson(sidecar, { lesson: '禁止全仓回归', rule: 'no-full-regression' });
  assert.equal(l.status, 'active');
  assert.equal(retireLesson(sidecar, l.id).status, 'retired');
  assert.equal(retireLesson(sidecar, l.id).status, 'retired', '已 retired 再 retire 幂等不报错');
  assert.throws(() => retireLesson(sidecar, 'lesson-nope'), { code: 'lesson_not_found' });
  // list 缺省只列 active；--all（includeRetired）才含 retired
  assert.deepEqual(listLessons(sidecar), [], '缺省隐藏 retired');
  assert.equal(listLessons(sidecar, { includeRetired: true }).length, 1);
  assert.equal(listLessons(sidecar, { includeRetired: true })[0].status, 'retired');
  // 既有 B4 语义不受损：retired 条目的 hits 存量照读（0.10.1 删计数器后，hits 仅为只读字段）
  assert.equal(listLessons(sidecar, { includeRetired: true })[0].hits, 0);
});

test('D3 lib：旧侧车条目无 status 字段按 active（与 hits 同模式向后兼容）', () => {
  const legacy = { schemaVersion: 1, nodes: {}, lessons: [{ id: 'lesson-old', at: 't', rule: 'r', lesson: '旧经验', source: null }] };
  assert.equal(listLessons(legacy)[0].status, 'active');
  assert.equal(legacy.lessons[0].status, undefined, 'list 不改侧车原对象');
});

// —— A2 lib ——

test('A2 lib：parseSince 合法/非法（消息带示例）；listTraces/replayNode --since 含边界过滤三源合并时间线', () => {
  assert.equal(parseSince('2026-08-15T02:00:00.000Z'), null);
  assert.equal(parseSince(undefined), null);
  assert.equal(parseSince(''), null);
  const bad = parseSince('不是时间');
  assert.ok(bad && bad.includes('2026-08-15T00:00:00.000Z'), '非法格式消息带 ISO 示例：' + bad);

  const sidecar = {
    schemaVersion: 1,
    nodes: { n1: nodeOf({ history: [
      { at: '2026-08-15T01:00:00.000Z', kind: 'set', reason: '早', by: 'o' },
      { at: '2026-08-15T03:00:00.000Z', kind: 'settle', reason: '晚', by: 'o' },
    ] }) },
    trace: [
      { id: 'trace-1', at: '2026-08-15T00:30:00.000Z', kind: 'decision', actor: 'o', note: '最早', node: 'n1' },
      { id: 'trace-2', at: '2026-08-15T02:00:00.000Z', kind: 'tool_call', actor: 'o', note: '中', node: 'n1' },
    ],
    lessons: [{ id: 'lesson-1', at: '2026-08-15T02:30:00.000Z', rule: 'r', lesson: '经验', source: 'trace-2' }],
  };
  // list：--since 过滤 trace 事件（含边界）
  assert.equal(listTraces(sidecar, null, '2026-08-15T02:00:00.000Z').length, 1);
  assert.equal(listTraces(sidecar, null, '2026-08-15T02:00:00.000Z')[0].id, 'trace-2');
  assert.equal(listTraces(sidecar, 'n1', '2026-08-15T02:00:00.000Z').length, 1);
  assert.equal(listTraces(sidecar, null, '2026-08-15T02:00:00.001Z').length, 0);
  // replay：--since 作用于三源合并后时间线（state+trace+lesson），含边界
  const tl = replayNode(sidecar, 'n1', '2026-08-15T02:00:00.000Z');
  assert.deepEqual(tl.events.map((e) => e.source), ['trace', 'lesson', 'state']);
  assert.deepEqual(tl.events.map((e) => e.at), ['2026-08-15T02:00:00.000Z', '2026-08-15T02:30:00.000Z', '2026-08-15T03:00:00.000Z']);
  assert.equal(replayNode(sidecar, 'n1', '2026-08-15T03:00:00.000Z').events.length, 1, '边界 at==since 计入');
  assert.equal(replayNode(sidecar, 'n1', '2026-08-15T03:00:00.001Z').events.length, 0);
  // 缺省：行为完全不变
  assert.equal(replayNode(sidecar, 'n1').events.length, 5);
});

// —— A3 lib ——

test('A3 lib：buildReport --brief 只留计数 + error 诊断；warning 降计数、明细数组略去；缺省非 brief 形状不变', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      v: nodeOf({ progress: 'verified' }), // A3 error
      w: nodeOf({ progress: 'in_progress', evidence: ['/no/such/file.ts:1'] }), // lint warning
    },
    lessons: [{ id: 'l1', at: 't', rule: 'r', lesson: 'x', source: null }],
  };
  const brief = buildReport(sidecar, { root: '/', codeSha: 'abc', specSha: 'def', brief: true, replays: ['v', 'ghost'] });
  assert.equal(brief.nodes, 2, '节点数');
  assert.equal(brief.state_changes, 0);
  assert.equal(brief.warnings, 1, '警告降为计数');
  assert.deepEqual(brief.lessons, { count: 1 }, 'lessons 仅计数');
  assert.ok(Array.isArray(brief.errors) && brief.errors.some((e) => e.rule === 'verified_requires_evidence'), 'error 诊断全文保留');
  assert.ok(!('shas' in brief) && !('verify' in brief), 'shas/verify 略去');
  assert.deepEqual(brief.replays, [{ node: 'v', total: 0 }, { node: 'ghost', error: brief.replays[1].error }], 'replays 每节点只出事件计数');

  // 缺省（非 brief）：形状与既有完全一致
  const full = buildReport(sidecar, { root: '/', codeSha: 'abc', specSha: 'def', replays: ['v'] });
  assert.ok(Array.isArray(full.nodes) && full.nodes.length === 2, '非 brief nodes 仍为数组');
  assert.ok(Array.isArray(full.warnings) && full.warnings.length === 1, '非 brief warnings 仍为数组');
  assert.deepEqual(full.lessons, { count: 1, rules: ['r'] });
  assert.equal(full.shas.code, 'abc');
  assert.ok(full.replays[0].events, '非 brief replays 仍内联事件摘要');
});

test('A3 lib：--brief 时 a1 小节仅计数，nonClaims 降为条数；非 brief 保持数组', () => {
  const spec = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 't', quality_profile: 'showcase' },
    components: [{ id: 'v', type: 'backend', label: 'V', pos: [0, 0], size: [10, 10] }],
    boundaries: [], connections: [],
  };
  const sidecar = { schemaVersion: 1, nodes: { v: nodeOf({ progress: 'verified' }) } };
  const brief = buildReport(sidecar, { specs: [spec], brief: true });
  assert.equal(brief.a1.checkedNodes, 1);
  assert.equal(brief.a1.errors, 1, 'a1 小节只计 A1 规则码（a1-missing-evidence）；A3 码不计入');
  assert.equal(typeof brief.a1.nonClaims, 'number', 'brief 下 nonClaims 是条数');
  assert.ok(brief.a1.nonClaims >= 1);
  assert.ok(!Array.isArray(brief.a1.nonClaims));
  const full = buildReport(sidecar, { specs: [spec] });
  assert.ok(Array.isArray(full.a1.nonClaims), '非 brief nonClaims 仍为数组');
});

// —— CLI ——

test('CLI A1：lessons list --recent/--rule 组合、缺省不变、回执 total/filtered；非法 --recent=exit 1 bad_args', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    lessons: [
      { id: 'lesson-1', at: '2026-08-15T01:00:00.000Z', rule: 'r1', lesson: 'a', source: null },
      { id: 'lesson-2', at: '2026-08-15T03:00:00.000Z', rule: 'r2', lesson: 'b', source: null },
      { id: 'lesson-3', at: '2026-08-15T02:00:00.000Z', rule: 'r1', lesson: 'c', source: null },
    ],
  });
  const def = run(['lessons', 'list', '--sidecar', sidecar]);
  assert.equal(def.code, 0);
  assert.equal(def.receipt.data.count, 3);
  assert.equal(def.receipt.data.total, 3);
  assert.equal(def.receipt.data.filtered, false, '缺省无截断 filtered=false');
  assert.deepEqual(def.receipt.data.lessons.map((l) => l.id), ['lesson-1', 'lesson-2', 'lesson-3'], '缺省全量序不变');

  const recent = run(['lessons', 'list', '--recent', '2', '--sidecar', sidecar]);
  assert.equal(recent.receipt.data.count, 2);
  assert.equal(recent.receipt.data.total, 3);
  assert.equal(recent.receipt.data.filtered, true, '截断时 filtered=true');
  assert.deepEqual(recent.receipt.data.lessons.map((l) => l.id), ['lesson-2', 'lesson-3'], '按 at 倒序');

  const rule = run(['lessons', 'list', '--rule', 'r1', '--sidecar', sidecar]);
  assert.deepEqual(rule.receipt.data.lessons.map((l) => l.id), ['lesson-1', 'lesson-3']);
  assert.equal(rule.receipt.data.filtered, true);

  const combo = run(['lessons', 'list', '--rule', 'r1', '--recent', '1', '--sidecar', sidecar]);
  assert.deepEqual(combo.receipt.data.lessons.map((l) => l.id), ['lesson-3'], 'rule 过滤后按 at 倒序截取');

  const bad = run(['lessons', 'list', '--recent', 'abc', '--sidecar', sidecar]);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(bad.receipt.diagnostics[0].evidence.includes('--recent 5'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI D3：retire 幂等 + 未知 id lesson_not_found + list 缺省隐藏 retired、--all 含之、total 报全量', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir);
  const added = run(['lessons', 'add', '--lesson', '旧经验应归档', '--rule', 'archive', '--sidecar', sidecar]);
  assert.equal(added.code, 0);
  assert.equal(added.receipt.data.item.status, 'active', '新条目 status=active');
  const id = added.receipt.data.item.id;

  const r1 = run(['lessons', 'retire', '--id', id, '--sidecar', sidecar]);
  assert.equal(r1.code, 0);
  assert.equal(r1.receipt.data.item.status, 'retired', '回执含新状态');
  const r2 = run(['lessons', 'retire', '--id', id, '--sidecar', sidecar]);
  assert.equal(r2.code, 0, '已 retired 再 retire 幂等');
  assert.equal(r2.receipt.data.item.status, 'retired');

  const missing = run(['lessons', 'retire', '--id', 'lesson-nope', '--sidecar', sidecar]);
  assert.equal(missing.code, 1);
  assert.equal(missing.receipt.diagnostics[0].rule, 'lesson_not_found');

  const def = run(['lessons', 'list', '--sidecar', sidecar]);
  assert.equal(def.receipt.data.count, 0, '缺省只列 active（retired 隐藏）');
  assert.equal(def.receipt.data.total, 1, 'total 仍报全量');
  assert.equal(def.receipt.data.filtered, true);
  const all = run(['lessons', 'list', '--all', '--sidecar', sidecar]);
  assert.equal(all.receipt.data.count, 1, '--all 含 retired');
  assert.equal(all.receipt.data.lessons[0].status, 'retired');
  assert.equal(all.receipt.data.filtered, false, '--all 无截断');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI A2：trace list/replay --since 过滤（含边界）；非法格式=exit 1 bad_args 带示例；缺省不变', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    nodes: { n1: nodeOf({ history: [
      { at: '2026-08-15T01:00:00.000Z', kind: 'set', reason: '早', by: 'o' },
      { at: '2026-08-15T03:00:00.000Z', kind: 'settle', reason: '晚', by: 'o' },
    ] }) },
    trace: [
      { id: 'trace-1', at: '2026-08-15T00:30:00.000Z', kind: 'decision', actor: 'o', note: '最早', node: 'n1' },
      { id: 'trace-2', at: '2026-08-15T02:00:00.000Z', kind: 'tool_call', actor: 'o', note: '中', node: 'n1' },
    ],
    lessons: [{ id: 'lesson-1', at: '2026-08-15T02:30:00.000Z', rule: 'r', lesson: '经验', source: 'trace-2' }],
  });

  const list = run(['trace', 'list', '--since', '2026-08-15T02:00:00.000Z', '--sidecar', sidecar]);
  assert.equal(list.code, 0);
  assert.equal(list.receipt.data.count, 1, '含边界只留 trace-2');
  assert.equal(list.receipt.data.events[0].id, 'trace-2');

  const replay = run(['trace', 'replay', '--node', 'n1', '--since', '2026-08-15T02:00:00.000Z', '--sidecar', sidecar]);
  assert.equal(replay.code, 0);
  assert.deepEqual(replay.receipt.data.events.map((e) => e.source), ['trace', 'lesson', 'state'], '--since 作用于三源合并后时间线');

  const def = run(['trace', 'replay', '--node', 'n1', '--sidecar', sidecar]);
  assert.equal(def.receipt.data.events.length, 5, '缺省行为不变（2 history + 2 trace + 1 lesson）');

  for (const args of [
    ['trace', 'list', '--since', '不是时间', '--sidecar', sidecar],
    ['trace', 'replay', '--node', 'n1', '--since', '2026-13-99', '--sidecar', sidecar],
  ]) {
    const bad = run(args);
    assert.equal(bad.code, 1);
    assert.equal(bad.receipt.diagnostics[0].rule, 'bad_args');
    assert.ok(bad.receipt.diagnostics[0].evidence.includes('2026-08-15T00:00:00.000Z'), '非法格式消息带示例');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI A3：--brief 形状（无 warning 明细/error 保留/计数正确）+ --brief+--replay 组合 + exit 语义不变', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    nodes: {
      v: nodeOf({ progress: 'verified' }), // A3 error
      w: nodeOf({ progress: 'in_progress', evidence: [path.join(dir, 'no.ts') + ':1'] }), // lint warning
    },
    lessons: [
      { id: 'l1', at: 't', rule: 'r1', lesson: 'x', source: null },
      { id: 'l2', at: 't', rule: 'r2', lesson: 'y', source: null },
    ],
  });

  // error 存在 → 仍 exit 1；data 为计数摘要；diagnostics 只含 error 级
  const err = run(['report', '--brief', '--sidecar', sidecar, '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(err.code, 1, 'exit 语义不变');
  assert.equal(err.receipt.status, 'failed');
  assert.equal(err.receipt.data.nodes, 2, '节点数');
  assert.equal(err.receipt.data.warnings, 1, '警告降为计数（无明细）');
  assert.deepEqual(err.receipt.data.lessons, { count: 2 }, 'lessons 仅计数（无规则明细）');
  assert.ok(!('shas' in err.receipt.data) && !('verify' in err.receipt.data));
  const rules = err.receipt.diagnostics.map((d) => d.rule);
  assert.ok(rules.includes('verified_requires_evidence'), 'error 诊断全文保留');
  assert.ok(rules.every((r) => r !== 'evidence_lint_warnings' && r !== 'missing_code_sha'), 'warning 级诊断不进 failed 信封');

  // 纯 warning → 仍 exit 0
  const warnOnly = run(['report', '--brief', '--sidecar', sidecar, '--slice', 'w', '--code-sha', 'abc', '--spec-sha', 'def', '--no-trace']);
  assert.equal(warnOnly.code, 0, '纯 warning 不阻断');
  assert.equal(warnOnly.receipt.data.nodes, 1);
  assert.equal(warnOnly.receipt.data.warnings, 1);
  assert.equal(warnOnly.receipt.data.lessons.count, 2);

  // --brief + --replay：replays 每节点只出事件计数（slice 用无 error 节点，exit 语义不变）
  const rep = run(['report', '--brief', '--sidecar', sidecar, '--slice', 'w', '--code-sha', 'abc', '--spec-sha', 'def', '--replay', 'w', '--replay', 'ghost', '--no-trace']);
  assert.equal(rep.code, 0, JSON.stringify(rep.receipt.diagnostics));
  assert.deepEqual(Object.keys(rep.receipt.data.replays[0]).sort(), ['node', 'total'], '每节点只出计数');
  assert.equal(rep.receipt.data.replays[0].node, 'w');
  assert.ok(rep.receipt.data.replays[1].error, '未知节点条目带 error 不整体失败');
  assert.ok(!('events' in rep.receipt.data.replays[0]), 'replays 事件全文略去');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI D3 旧侧车兼容：无 status 字段条目 list 显示 active，--all 全量无截断', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, {
    lessons: [{ id: 'lesson-legacy', at: '2026-08-15T00:00:00.000Z', rule: 'old', lesson: '旧条目', source: null }],
  });
  const def = run(['lessons', 'list', '--sidecar', sidecar]);
  assert.equal(def.receipt.data.lessons[0].status, 'active', '旧条目缺省按 active');
  assert.equal(def.receipt.data.total, 1);
  assert.equal(def.receipt.data.filtered, false);
  const all = run(['lessons', 'list', '--all', '--sidecar', sidecar]);
  assert.equal(all.receipt.data.count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
