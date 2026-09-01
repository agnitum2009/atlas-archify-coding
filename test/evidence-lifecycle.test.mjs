// 锚生命周期写路径牙齿（0.6.0，一线席位 一线实战反馈）：evidence-remove / evidence-reanchor。
// 覆盖：remove 成功（数组+meta 双清、history、回执形状）；locator_not_found；A3 守卫（声称对齐节点
// 移除最后一条证据被拒且零写入）；非声称节点移到零允许；reanchor 成功（旧走新来、meta 换新哈希、
// history 含 from/to、A3 全程不破）；旧锚不存在；新锚非法三形态零写入（逐字节验侧车未变）；
// from===to 幂等边界（按刷新哈希处理，drifted→ok）；合并去重；CAS 路径（成功恰 +1 revision、锁释放）。
// 红线：全部用临时目录，绝不触碰 <home>/demo-ledger。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorState } from '../lib/evidence.mjs';
import { loadSidecar } from '../lib/store.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-evlife-'));
}

// 建临时工作区：两份真实文件 + 已 set 的节点（evidence 空数组），返回 {dir, sidecar, a1, b2}。
// 锚一律绝对形态（evidence-add 落账即绝对化，与实战一致）。
function seedWorkspace(nodeId) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'alpha\nbravo\ncharlie\n');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'one\ntwo\n');
  const sidecar = path.join(dir, 'atlas-state.json');
  const set = run(['state', 'set', '--node', nodeId, '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(set.code, 0, set.stdout);
  return { dir, sidecar, a1: path.join(dir, 'a.ts') + ':1', b2: path.join(dir, 'b.ts') + ':2' };
}

function readNode(sidecar, nodeId) {
  return loadSidecar(sidecar).nodes[nodeId];
}

test('evidence-remove 成功：数组与 meta 双清、history 记事件、回执形状 {node, removed, remaining}', () => {
  const { dir, sidecar, a1, b2 } = seedWorkspace('r1');
  run(['state', 'evidence-add', '--node', 'r1', '--locator', a1, '--sidecar', sidecar]);
  run(['state', 'evidence-add', '--node', 'r1', '--locator', b2, '--sidecar', sidecar]);

  const res = run(['state', 'evidence-remove', '--node', 'r1', '--locator', a1, '--sidecar', sidecar]);
  assert.equal(res.code, 0, res.stdout);
  assert.equal(res.receipt.status, 'ok');
  assert.deepEqual(res.receipt.data, { node: 'r1', removed: a1, remaining: 1 });

  const node = readNode(sidecar, 'r1');
  assert.deepEqual(node.evidence, [b2], '数组只剩 b2');
  assert.equal(node.evidenceMeta[a1], undefined, 'meta 对应键已删（孤儿 meta 边界关闭）');
  assert.ok(node.evidenceMeta[b2] && typeof node.evidenceMeta[b2].h === 'string', '未动的锚 meta 保留');
  const ev = node.history.filter((h) => h.kind === 'evidence-remove');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].locator, a1);
  assert.ok(ev[0].engine, '事件带 engine 戳');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-remove 锚不在数组：exit 1 locator_not_found，零写入', () => {
  const { dir, sidecar, a1 } = seedWorkspace('r2');
  run(['state', 'evidence-add', '--node', 'r2', '--locator', a1, '--sidecar', sidecar]);
  const before = fs.readFileSync(sidecar, 'utf8');

  const ghost = path.join(dir, 'ghost.ts') + ':1';
  const res = run(['state', 'evidence-remove', '--node', 'r2', '--locator', ghost, '--sidecar', sidecar]);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.status, 'failed');
  assert.equal(res.receipt.diagnostics[0].rule, 'locator_not_found');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before, '失败零写入');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A3 守卫：verified 节点移除最后一条证据被拒（verified_requires_evidence）且零写入', () => {
  const { dir, sidecar, a1 } = seedWorkspace('r3');
  run(['state', 'evidence-add', '--node', 'r3', '--locator', a1, '--sidecar', sidecar]);
  const settled = run(['state', 'settle', '--node', 'r3', '--reason', '销账', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(settled.code, 0, settled.stdout);
  assert.equal(readNode(sidecar, 'r3').progress, 'verified');
  const before = fs.readFileSync(sidecar, 'utf8');

  const res = run(['state', 'evidence-remove', '--node', 'r3', '--locator', a1, '--sidecar', sidecar]);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.diagnostics[0].rule, 'verified_requires_evidence');
  assert.ok(res.receipt.diagnostics[0].evidence.includes('evidence-reanchor'), '消息须给出原子替换出路');
  assert.equal(res.receipt.data.lessonPrompt, '本刀有无新教训？有则 lessons add 回写（S5a 欠账教训）', 'B4 同模式 lessonPrompt');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before, '拒绝后侧车字节未变（零写入）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('非声称节点（in_progress/candidate/clean）移除到零允许', () => {
  const { dir, sidecar, a1 } = seedWorkspace('r4');
  run(['state', 'evidence-add', '--node', 'r4', '--locator', a1, '--sidecar', sidecar]);

  const res = run(['state', 'evidence-remove', '--node', 'r4', '--locator', a1, '--sidecar', sidecar]);
  assert.equal(res.code, 0, res.stdout);
  const node = readNode(sidecar, 'r4');
  assert.deepEqual(node.evidence, []);
  assert.equal(node.evidenceMeta[a1], undefined, 'meta 键随移除清理');
  assert.equal(res.receipt.data.remaining, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-reanchor 成功（drifted 处置规范路径）：旧走新来、meta 换新哈希、history 含 from/to、A3 全程不破', () => {
  const { dir, sidecar, a1, b2 } = seedWorkspace('r5');
  // 先落旧锚并销账（节点声称对齐实相；drifted 复核场景：落锚后行内容才漂移）
  run(['state', 'evidence-add', '--node', 'r5', '--locator', a1, '--sidecar', sidecar]);
  const settled = run(['state', 'settle', '--node', 'r5', '--reason', '销账', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(settled.code, 0, settled.stdout);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'alpha-DRIFTED\nbravo\ncharlie\n'); // 落锚后行内容漂移
  const pre = readNode(sidecar, 'r5');
  assert.equal(anchorState(a1, pre.evidenceMeta[a1], dir), 'drifted', '前置：旧锚 drifted');

  const res = run(['state', 'evidence-reanchor', '--node', 'r5', '--from', a1, '--to', b2, '--sidecar', sidecar]);
  assert.equal(res.code, 0, res.stdout);
  assert.equal(res.receipt.status, 'ok');
  assert.deepEqual(res.receipt.data, { node: 'r5', from: a1, to: b2, hash: readNode(sidecar, 'r5').evidenceMeta[b2].h });

  const node = readNode(sidecar, 'r5');
  assert.deepEqual(node.evidence, [b2], '旧锚走、新锚来（长度 1——中途无零证据瞬间，声称节点 A3 全程不破）');
  assert.equal(node.evidenceMeta[a1], undefined, '旧锚 meta 键已清');
  assert.ok(node.evidenceMeta[b2] && node.evidenceMeta[b2].h.length === 12, '新锚 meta 换新哈希');
  assert.equal(anchorState(b2, node.evidenceMeta[b2], dir), 'ok', '新锚三态 ok');
  const ev = node.history.filter((h) => h.kind === 'evidence-reanchor');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].from, a1);
  assert.equal(ev[0].to, b2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-reanchor 旧锚不存在：exit 1 locator_not_found，零写入', () => {
  const { dir, sidecar, a1, b2 } = seedWorkspace('r6');
  run(['state', 'evidence-add', '--node', 'r6', '--locator', a1, '--sidecar', sidecar]);
  const before = fs.readFileSync(sidecar, 'utf8');

  const a2 = path.join(dir, 'a.ts') + ':2'; // 在文件里但未落账
  const res = run(['state', 'evidence-reanchor', '--node', 'r6', '--from', a2, '--to', b2, '--sidecar', sidecar]);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.diagnostics[0].rule, 'locator_not_found');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before, '失败零写入');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-reanchor 新锚非法三形态（格式坏/行越界/文件缺）＝既有码且逐字节零写入', () => {
  const { dir, sidecar, a1 } = seedWorkspace('r7');
  run(['state', 'evidence-add', '--node', 'r7', '--locator', a1, '--sidecar', sidecar]);

  const cases = [
    { to: 'no-colon-line', rule: 'bad_locator', name: '格式坏' },
    { to: path.join(dir, 'b.ts') + ':999', rule: 'line_out_of_bounds', name: '行越界' },
    { to: path.join(dir, 'ghost.ts') + ':1', rule: 'file_missing', name: '文件缺' },
  ];
  for (const c of cases) {
    const before = fs.readFileSync(sidecar, 'utf8');
    const res = run(['state', 'evidence-reanchor', '--node', 'r7', '--from', a1, '--to', c.to, '--sidecar', sidecar]);
    assert.equal(res.code, 1, c.name + ' 应 exit 1：' + res.stdout);
    assert.equal(res.receipt.diagnostics[0].rule, c.rule, c.name);
    assert.equal(fs.readFileSync(sidecar, 'utf8'), before, c.name + '：先验后改，零写入');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-reanchor 幂等边界 from===to：按刷新哈希处理（drifted→ok，数组不动，事件仍记）', () => {
  const { dir, sidecar, a1 } = seedWorkspace('r8');
  run(['state', 'evidence-add', '--node', 'r8', '--locator', a1, '--sidecar', sidecar]);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'alpha-refreshed\nbravo\ncharlie\n'); // 目标行内容更新
  assert.equal(anchorState(a1, readNode(sidecar, 'r8').evidenceMeta[a1], dir), 'drifted');

  const res = run(['state', 'evidence-reanchor', '--node', 'r8', '--from', a1, '--to', a1, '--sidecar', sidecar]);
  assert.equal(res.code, 0, res.stdout);
  assert.equal(res.receipt.data.from, a1);
  assert.equal(res.receipt.data.to, a1);

  const node = readNode(sidecar, 'r8');
  assert.deepEqual(node.evidence, [a1], 'from===to 时 evidence 数组不动（刷新哈希语义）');
  assert.equal(anchorState(a1, node.evidenceMeta[a1], dir), 'ok', '哈希已刷新 drifted→ok');
  assert.equal(res.receipt.data.hash, node.evidenceMeta[a1].h);
  const ev = node.history.filter((h) => h.kind === 'evidence-reanchor');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].from, a1);
  assert.equal(ev[0].to, a1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-reanchor 合并去重：新锚已在 evidence 中 → 移旧不重复追加，新锚哈希刷新', () => {
  const { dir, sidecar, a1, b2 } = seedWorkspace('r9');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'one\ntwo-refreshed\n');
  run(['state', 'evidence-add', '--node', 'r9', '--locator', a1, '--sidecar', sidecar]);
  run(['state', 'evidence-add', '--node', 'r9', '--locator', b2, '--sidecar', sidecar]);

  const res = run(['state', 'evidence-reanchor', '--node', 'r9', '--from', a1, '--to', b2, '--sidecar', sidecar]);
  assert.equal(res.code, 0, res.stdout);
  const node = readNode(sidecar, 'r9');
  assert.deepEqual(node.evidence, [b2], '旧锚移除、新锚不重复（数组长度 2→1）');
  assert.equal(node.evidenceMeta[a1], undefined);
  assert.equal(anchorState(b2, node.evidenceMeta[b2], dir), 'ok', '新锚哈希已刷新');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CAS 路径：成功操作恰 +1 revision 且锁释放（与 store 测试同法：经 saveSidecar 写入）', () => {
  const { dir, sidecar, a1, b2 } = seedWorkspace('r10');
  run(['state', 'evidence-add', '--node', 'r10', '--locator', a1, '--sidecar', sidecar]);
  const revBefore = loadSidecar(sidecar).revision;

  const rm = run(['state', 'evidence-remove', '--node', 'r10', '--locator', a1, '--sidecar', sidecar]);
  assert.equal(rm.code, 0, rm.stdout);
  assert.equal(loadSidecar(sidecar).revision, revBefore + 1, 'remove 单次 save：revision 恰 +1');
  assert.equal(fs.existsSync(sidecar + '.lock'), false, '锁已释放');

  run(['state', 'evidence-add', '--node', 'r10', '--locator', a1, '--sidecar', sidecar]);
  const revMid = loadSidecar(sidecar).revision;
  const re = run(['state', 'evidence-reanchor', '--node', 'r10', '--from', a1, '--to', b2, '--sidecar', sidecar]);
  assert.equal(re.code, 0, re.stdout);
  assert.equal(loadSidecar(sidecar).revision, revMid + 1, 'reanchor 单次 save：revision 恰 +1（原子性=一次 CAS 写入）');
  assert.equal(fs.existsSync(sidecar + '.lock'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
