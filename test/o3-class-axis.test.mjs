// O3 牙齿（2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O3）：
// class 轴建号必填（只约束新建）+ state active 不静默漏出未分类节点。真实子进程 + 临时侧车。
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
  return { code: res.status, receipt, stdout: res.stdout };
}

function tmpSidecar(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-o3-'));
  const sidecar = path.join(dir, 'atlas-state.json');
  if (initial) fs.writeFileSync(sidecar, JSON.stringify(initial, null, 2) + '\n');
  return { dir, sidecar };
}

const nodeOf = (over) => Object.assign({ owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, over || {});

test('O3 新建无 class：exit 1 class_required 且零落账（文件都不建）', () => {
  const { dir, sidecar } = tmpSidecar();
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.status, 'failed');
  assert.equal(r.receipt.diagnostics[0].rule, 'class_required');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--axis class'), r.receipt.diagnostics[0].evidence);
  assert.ok(r.receipt.data.lessonPrompt.includes('lessons add'), 'A3 同例：失败回执附 lessonPrompt');
  assert.equal(fs.existsSync(sidecar), false, 'class_required 须零落账（连文件都不建）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O3 两条合规建号路径：--class <值>（同次写入）与 --axis class（首写即分类轴）', () => {
  const { dir, sidecar } = tmpSidecar();
  const viaFlag = run(['state', 'set', '--node', 'o3-a', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task', '--sidecar', sidecar]);
  assert.equal(viaFlag.code, 0, viaFlag.stdout);
  assert.equal(viaFlag.receipt.data.classAssigned, 'task');
  const viaAxis = run(['state', 'set', '--node', 'o3-b', '--axis', 'class', '--value', 'debt', '--reason', '建号分类', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(viaAxis.code, 0, viaAxis.stdout);
  assert.equal(viaAxis.receipt.data.to, 'debt');

  const sc = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(sc.nodes['o3-a'].class, 'task', '--class 须落账');
  assert.equal(sc.nodes['o3-b'].class, 'debt');
  assert.equal(sc.nodes['o3-a'].history[0].class, 'task', 'class 赋值须在 history 事件内留痕（可审计）');
  assert.equal(sc.nodes['o3-a'].history[0].axis, 'progress', '不另起事件：轴写入与 class 赋值同事件');
  assert.equal(sc.nodes['o3-b'].history[0].axis, 'class');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O3 既有节点不动：存量无 class 节点照常可写；--class 不改写已有分类；非法值被拒', () => {
  const { dir, sidecar } = tmpSidecar({ schemaVersion: 1, revision: 0, nodes: { 'o3-legacy': nodeOf() } });
  const legacy = run(['state', 'set', '--node', 'o3-legacy', '--axis', 'progress', '--value', 'in_progress', '--reason', '存量可写', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(legacy.code, 0, '存量无 class 节点不受 O3 约束（只约束新建）：' + legacy.stdout);
  assert.equal(legacy.receipt.data.classAssigned, undefined);

  const badValue = run(['state', 'set', '--node', 'o3-legacy', '--axis', 'progress', '--value', 'blocked', '--reason', 'r', '--owner', '一线席位', '--class', 'not-a-class', '--sidecar', sidecar]);
  assert.equal(badValue.code, 1);
  assert.equal(badValue.receipt.diagnostics[0].rule, 'invalid_state_value');

  const assign = run(['state', 'set', '--node', 'o3-legacy', '--axis', 'progress', '--value', 'blocked', '--reason', '补分类', '--owner', '一线席位', '--class', 'debt', '--sidecar', sidecar]);
  assert.equal(assign.code, 0, '存量无 class 可经 --class 补分类：' + assign.stdout);
  const rewrite = run(['state', 'set', '--node', 'o3-legacy', '--axis', 'progress', '--value', 'in_progress', '--reason', '改分类', '--owner', '一线席位', '--class', 'task', '--sidecar', sidecar]);
  assert.equal(rewrite.code, 1, '--class 不改写已有分类');
  assert.equal(rewrite.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(rewrite.receipt.diagnostics[0].evidence.includes('--axis class'), rewrite.receipt.diagnostics[0].evidence);
  const axisRewrite = run(['state', 'set', '--node', 'o3-legacy', '--axis', 'class', '--value', 'task', '--reason', '重分类', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(axisRewrite.code, 0, '重分类走 --axis class（独立事件留痕）：' + axisRewrite.stdout);

  const conflict = run(['state', 'set', '--node', 'o3-c', '--axis', 'class', '--value', 'task', '--reason', 'r', '--owner', '一线席位', '--class', 'debt', '--sidecar', sidecar]);
  assert.equal(conflict.code, 1, '--class 与 --axis class 值冲突须拒');
  assert.equal(conflict.receipt.diagnostics[0].rule, 'bad_args');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('O3 state active：未分类未完成节点单列 + 计入 count + warning；--all 全列不改口径', () => {
  const sidecarData = {
    schemaVersion: 1,
    revision: 0,
    nodes: {
      'o3-task': nodeOf({ class: 'task', progress: 'in_progress' }),
      'o3-debt': nodeOf({ class: 'debt', progress: 'planned' }),
      'o3-unclassified': nodeOf({ progress: 'planned' }),          // 未分类未完成 → 单列
      'o3-unclassified-done': nodeOf({ progress: 'verified' }),    // 未分类但已终态 → 不入单列（只在 unclassifiedTotal）
      'o3-declared': nodeOf({ class: 'declared', progress: 'planned' }), // 非活帐类
    },
  };
  const { dir, sidecar } = tmpSidecar(sidecarData);
  const r = run(['state', 'active', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const d = r.receipt.data;
  assert.equal(d.activeCount, 2, '活帐类未完成 2 个：' + JSON.stringify(d));
  assert.equal(d.unclassifiedCount, 1);
  assert.equal(d.unclassifiedTotal, 2, '含已终态未分类（单列只列未完成，不隐藏全量）');
  assert.equal(d.count, 3, 'count = 活帐类 + 未分类未完成（未分类不再静默漏出）');
  assert.deepEqual(d.unclassified.map((x) => x.id), ['o3-unclassified']);
  assert.ok(d.nodes.some((n) => n.id === 'o3-unclassified'), '默认视图必须列出未分类节点');
  const warn = (r.receipt.diagnostics || []).find((x) => x.rule === 'unclassified_nodes');
  assert.ok(warn && warn.severity === 'warning', '须发 unclassified_nodes warning：' + r.stdout);

  const all = run(['state', 'active', '--all', '--sidecar', sidecar]);
  assert.equal(all.receipt.data.count, 5, '--all 列全部节点');
  assert.equal(all.receipt.data.unclassifiedCount, 1, '--all 不改单列口径');

  const clean = tmpSidecar({ schemaVersion: 1, revision: 0, nodes: { 'o3-task': nodeOf({ class: 'task' }) } });
  const cleanRun = run(['state', 'active', '--sidecar', clean.sidecar]);
  assert.equal(cleanRun.receipt.diagnostics, undefined, '无未分类节点时不发 warning（不噪音）');
  assert.equal(cleanRun.receipt.data.unclassifiedCount, 0);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(clean.dir, { recursive: true, force: true });
});

for (const initialClass of [undefined, 'task', 'debt']) {
  test(`import explicit class preserves existing classification ${initialClass}`, () => {
    const { dir, sidecar } = tmpSidecar({ schemaVersion: 1, nodes: { legacy: nodeOf(initialClass === undefined ? {} : { class: initialClass }) } });
    try {
      const evidence = path.join(dir, 'legacy.md');
      fs.writeFileSync(evidence, 'accepted\n');
      const before = fs.readFileSync(sidecar, 'utf8');
      const r = run(['state', 'import', '--node', 'legacy', '--reason', 'legacy', '--owner', '一线席位', '--class', 'task', '--locator', evidence + ':1', '--sidecar', sidecar]);
      if (initialClass === 'debt') {
        assert.equal(r.code, 1, r.stdout);
        assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
        assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
      } else {
        assert.equal(r.code, 0, r.stdout);
        const n = JSON.parse(fs.readFileSync(sidecar, 'utf8')).nodes.legacy;
        assert.equal(n.class, 'task');
        assert.equal(n.history.at(-1).class, 'task');
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
