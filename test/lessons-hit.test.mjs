// B4 lessons 防膨胀+回写提示牙齿（2026-08-15 清单）：hits 计数字段、settle/A3 拦截/gate fail 回执附 lessonPrompt、旧侧车无 hits 字段兼容。
// 0.10.0：lessons hit 子命令物理移除（两段式废弃第二阶段）——hits 字段与既有数据保留只读；CLI 调用 → exit 1 unknown_subcommand。
// 0.10.1：lib 层 hitLesson 一并删除——零调用方、仅被自身测试养活（Sculley 死分支处方），且「只读」声明与保留 mutator 相矛盾。
// 红线：全部用临时目录侧车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { addLesson, listLessons } from '../lib/lessons.mjs';
import * as lessonsMod from '../lib/lessons.mjs';
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lessons-hit-'));
}

test('B4/0.10.1 lib：hits 为存量只读字段——新条目 0、既有值照读、旧条目无字段补 0，且全仓无计数器', () => {
  const sidecar = { schemaVersion: 1, nodes: {} };
  const l = addLesson(sidecar, { lesson: '全仓回归是禁令', rule: 'no-full-regression' });
  assert.equal(l.hits, 0);
  assert.equal(listLessons(sidecar)[0].hits, 0);

  // 存量非零 hits 照读不丢（v0.10.0 移除写入口时的承诺）
  const withHits = { schemaVersion: 1, nodes: {}, lessons: [{ id: 'lesson-h', at: 't', rule: 'r', lesson: '存量', source: null, hits: 7 }] };
  assert.equal(listLessons(withHits)[0].hits, 7, '存量 hits 照读');

  // 旧侧车条目（无 hits 字段）兼容：list 补 0；原对象不被 list 改写
  const legacy = { schemaVersion: 1, nodes: {}, lessons: [{ id: 'lesson-old', at: 't', rule: 'r', lesson: '旧经验', source: null }] };
  assert.equal(listLessons(legacy)[0].hits, 0);
  assert.equal(legacy.lessons[0].hits, undefined, 'list 返回拷贝不改侧车原对象');

  // 0.10.1：hitLesson 已删（零调用方的死代码）——存量读不受影响，但仓内不再存在任何 hits 计数器
  assert.equal(typeof lessonsMod.hitLesson, 'undefined', 'hitLesson 应已从 lib 删除');
});

test('0.10.0：lessons hit CLI 已移除——exit 1 unknown_subcommand，hits 落账原样不 +1（只删写入口）', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  // 0.12.0：写路径不再静默自建账本（P0-1 同族），夹具预建侧车。
  fs.writeFileSync(sidecar, '{"schemaVersion":1,"nodes":{},"revision":0}');
  const added = run(['lessons', 'add', '--lesson', '销账五动作第4步曾整批漏做', '--rule', 'settle-5-step', '--sidecar', sidecar]);
  assert.equal(added.code, 0);
  const id = added.receipt.data.item.id;
  assert.equal(added.receipt.data.item.hits, 0);

  const hit = run(['lessons', 'hit', '--id', id, '--sidecar', sidecar]);
  assert.equal(hit.code, 1, 'lessons hit 已于 v0.10.0 移除（0.9.0 为 exit 0 + deprecated_command warning）');
  assert.equal(hit.receipt.status, 'failed');
  assert.equal(hit.receipt.diagnostics[0].rule, 'unknown_subcommand');
  assert.equal(hit.receipt.diagnostics[0].subject, 'hit');
  const persisted = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(persisted.lessons[0].hits, 0, '被拒调用不得改账：hits 原样');

  // 读方不受移除影响：list 每条照带 hits。
  const list = run(['lessons', 'list', '--sidecar', sidecar]);
  assert.equal(list.code, 0);
  assert.equal(list.receipt.data.lessons[0].hits, 0, 'list 输出每条带 hits（字段保留）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B4 旧侧车兼容：无 hits 字段条目 list 显示 0（0.10.0 后 hits 只读，不再经 CLI 递增）', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({
    schemaVersion: 1, atlas: null, nodes: {},
    lessons: [{ id: 'lesson-legacy', at: '2026-08-15T00:00:00.000Z', rule: 'old', lesson: '旧条目', source: null }],
  }) + '\n');
  const list = run(['lessons', 'list', '--sidecar', sidecar]);
  assert.equal(list.receipt.data.lessons[0].hits, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B4 lessonPrompt：settle 成功回执 + A3 拦截失败回执（settle/transition）均附带', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');

  // settle 的 A3 拦截（无证据销账）
  run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--sidecar', sidecar]);
  const a3Settle = run(['state', 'settle', '--node', 'n1', '--reason', '无证据销账', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(a3Settle.code, 1);
  assert.equal(a3Settle.receipt.diagnostics[0].rule, 'verified_requires_evidence');
  assert.ok(a3Settle.receipt.data.lessonPrompt.includes('lessons add'), 'A3 拦截失败回执附 lessonPrompt');

  // transition 的 A3 拦截（in_progress→verified 无证据）
  const a3Trans = run(['state', 'transition', '--node', 'n1', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified', '--reason', '无证据', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(a3Trans.code, 1);
  assert.equal(a3Trans.receipt.diagnostics[0].rule, 'verified_requires_evidence');
  assert.ok(a3Trans.receipt.data.lessonPrompt.includes('lessons add'));

  // settle 成功回执（补证据后）
  run(['state', 'evidence-add', '--node', 'n1', '--locator', 'test/fake.ts:1', '--sidecar', sidecar]);
  const settled = run(['state', 'settle', '--node', 'n1', '--reason', '销账', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(settled.code, 0);
  assert.ok(settled.receipt.data.lessonPrompt.includes('lessons add'), 'settle 成功回执附 lessonPrompt');
  assert.ok(settled.receipt.data.next.includes('report'), '既有 data.next 不受损（纯增字段）');
  fs.rmSync(dir, { recursive: true, force: true });
});
