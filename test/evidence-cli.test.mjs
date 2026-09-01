// evidence CLI 端到端牙齿。
// 0.10.0：evidence 顶层命令物理移除（两段式废弃第二阶段）——原「evidence lint」CLI 测试随之退役
//（lint 规则码 bad_locator/line_out_of_bounds/file_missing 的读方覆盖由 doctor evidence-resolvability
// 与 report 路径既有测试承担；写方格式校验由本文件 evidence-add 用例覆盖）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

test('evidence-add 写入绝对化（批二）：相对 locator 落账绝对形态；绝对输入原样；格式校验不变', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-abs-'));
  const file = path.join(dir, 'real.ts');
  fs.writeFileSync(file, 'one\ntwo\nthree\n');
  const sidecar = path.join(dir, 'atlas-state.json');
  const set = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(set.code, 0, set.stdout);

  // 相对 locator（相对测试进程 cwd）→ 落账为绝对形态（path.resolve against cwd）。
  const rel = path.relative(process.cwd(), file) + ':2';
  assert.ok(!path.isAbsolute(rel), '测试前提：locator 文件部分是相对的');
  const addRel = run(['state', 'evidence-add', '--node', 'n1', '--locator', rel, '--sidecar', sidecar]);
  assert.equal(addRel.code, 0, addRel.stdout);

  // 已是绝对的输入 → 原样落账。
  const addAbs = run(['state', 'evidence-add', '--node', 'n1', '--locator', file + ':3', '--sidecar', sidecar]);
  assert.equal(addAbs.code, 0, addAbs.stdout);

  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual(side.nodes.n1.evidence, [file + ':2', file + ':3'], '侧车中一律绝对形态');
  assert.equal(side.nodes.n1.history[1].kind, 'evidence-add');
  assert.equal(side.nodes.n1.history[1].locator, file + ':2', 'history 事件同样绝对形态');

  // 格式校验不变：无行号仍 bad_locator（含全角冒号提示来源）。
  const bad = run(['state', 'evidence-add', '--node', 'n1', '--locator', 'no-line-number', '--sidecar', sidecar]);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'bad_locator');
  fs.rmSync(dir, { recursive: true, force: true });
});


// 0.11.0（自嗜狗食发现）：同 locator 重复落锚 = 幂等重新加持。
// 回归钉：修复前 evidence 数组会真重复插入，而 drifted 诊断消息自己推荐「须复核后重新 evidence-add」
// ——照官方补救路径做每修一次漂移就塞一条重复锚。
test('evidence-add 幂等（0.11.0）：同锚重复落 = 重新加持（刷新哈希、不重复插入、附 evidence_reblessed warning）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-idem-'));
  const file = path.join(dir, 'real.ts');
  // 0.12.0 夹具扩行：两锚需相距 >3 行，避开新增 evidence_near_duplicate 近邻警告（本测试意图是幂等非近邻）。
  fs.writeFileSync(file, 'one\ntwo\nthree\nfour\nfive\nsix\n');
  const sidecar = path.join(dir, 'atlas-state.json');
  run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);

  const first = run(['state', 'evidence-add', '--node', 'n1', '--locator', file + ':1', '--sidecar', sidecar]);
  assert.equal(first.code, 0);
  assert.equal(first.receipt.data.evidence.length, 1);
  assert.equal(first.receipt.diagnostics, undefined, '首次落锚不发重新加持诊断');
  const h1 = JSON.parse(fs.readFileSync(sidecar, 'utf8')).nodes.n1.evidenceMeta[file + ':1'].h;

  // 目标行内容变化 → drifted；按诊断推荐的补救路径重新 evidence-add。
  fs.writeFileSync(file, 'ONE CHANGED\ntwo\nthree\nfour\nfive\nsix\n');
  const again = run(['state', 'evidence-add', '--node', 'n1', '--locator', file + ':1', '--sidecar', sidecar]);
  assert.equal(again.code, 0, '退出码不变');
  assert.equal(again.receipt.data.evidence.length, 1, '不重复插入（修复前为 2）');
  const d = again.receipt.diagnostics[0];
  assert.equal(d.rule, 'evidence_reblessed');
  assert.equal(d.severity, 'warning');
  assert.ok(d.evidence.includes('重新加持') && d.evidence.includes('未重复添加'), d.evidence);
  assert.ok(d.supportedFixes[0].includes('evidence-reanchor'), '给出换锚的正确出路');

  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual(side.nodes.n1.evidence, [file + ':1']);
  assert.notEqual(side.nodes.n1.evidenceMeta[file + ':1'].h, h1, '哈希已刷新为新内容');
  assert.equal(side.nodes.n1.history[side.nodes.n1.history.length - 1].rebless, true, 'history 标记本次为重新加持');

  // 不同锚仍正常追加，且不发该诊断。
  const other = run(['state', 'evidence-add', '--node', 'n1', '--locator', file + ':6', '--sidecar', sidecar]);
  assert.equal(other.receipt.data.evidence.length, 2);
  assert.equal(other.receipt.diagnostics, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
