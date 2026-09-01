// 提案④（2026-08-15 负责人裁定 yes）：set 不再架空 A2 迁移表——已存在节点的轴值变更同样过表校验。
// 两例外：初始化（节点不存在/该轴首写）免表；显式 --correction 纠错通道（history 带 corrected:true）。
// truth 回执门禁不因 --correction 豁免。全部用 mkdtemp 临时目录，绝不触碰真实侧车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, sidecarPath) {
  const res = spawnSync(process.execPath, [BIN].concat(args, ['--sidecar', sidecarPath]), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-set-a2-'));
}

// 播种任意侧车（JSON 直写，绕开 CLI 初始化路径）。
function seed(sidecarPath, nodes) {
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, JSON.stringify({ schemaVersion: 1, atlas: null, nodes }, null, 2), 'utf8');
}

function readSidecar(sidecarPath) {
  return JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
}

test('① 违表 set 被拒：exit 1 illegal_transition + 裁定④提示文案，节点不动不落历史', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const init = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位'], sidecar);
  assert.equal(init.code, 0);

  // in_progress→planned 不在迁移表（合法目标 verified|blocked）
  const bad = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'planned', '--reason', '回退', '--owner', '一线席位'], sidecar);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.status, 'failed');
  assert.equal(bad.receipt.diagnostics[0].rule, 'illegal_transition');
  assert.ok(bad.receipt.diagnostics[0].evidence.includes('set 现过 A2 校验（2026-08-15 裁定④）'), '缺裁定④注记：' + bad.receipt.diagnostics[0].evidence);
  assert.ok(bad.receipt.diagnostics[0].evidence.includes('确属纠错请加 --correction'), '缺纠错出口：' + bad.receipt.diagnostics[0].evidence);

  const side = readSidecar(sidecar);
  assert.equal(side.nodes.n1.progress, 'in_progress'); // 值未动
  assert.equal(side.nodes.n1.history.length, 1); // 仅 init；被拒不落历史

  fs.rmSync(dir, { recursive: true, force: true });
});

test('② 初始化例外：新节点任意状态直接写（免表）；同值写入不触发校验', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  // 节点不存在 → 初始化免表：planned 直达 verified（迁移表外路径）
  const created = run(['state', 'set', '--node', 'n2', '--axis', 'progress', '--value', 'verified', '--reason', '播种', '--owner', '一线席位'], sidecar);
  assert.equal(created.code, 0);
  assert.equal(created.receipt.data.to, 'verified');
  assert.equal(created.receipt.data.receipt.rule, 'A2-init');
  assert.equal(created.receipt.data.receipt.status, 'ok');

  // 同值写入（无变更）不触发 A2：truth candidate→candidate 不在迁移表也放行
  const noop = run(['state', 'set', '--node', 'n2', '--axis', 'truth', '--value', 'candidate', '--reason', '原地', '--owner', '一线席位'], sidecar);
  assert.equal(noop.code, 0);

  // 但已存在节点上换值仍被拦（同值例外不扩大为任意写）
  const bad = run(['state', 'set', '--node', 'n2', '--axis', 'truth', '--value', 'effective', '--reason', '跳级', '--owner', '一线席位'], sidecar);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'illegal_transition');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('③ 首写轴例外：该轴尚无值（节点已存在）直接写；写后该轴进入 A2 约束', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  // 播种节点：缺 progress 轴（模拟该轴尚无值的既有节点）
  seed(sidecar, { n3: { owner: '一线席位', truth: 'candidate', ledger: 'clean', evidence: [], history: [] } });

  const first = run(['state', 'set', '--node', 'n3', '--axis', 'progress', '--value', 'verified', '--reason', '首写', '--owner', '一线席位'], sidecar);
  assert.equal(first.code, 0);
  assert.equal(first.receipt.data.receipt.rule, 'A2-init'); // 首写免表

  // 首写之后该轴已有值：违表变更被拒
  const bad = run(['state', 'set', '--node', 'n3', '--axis', 'progress', '--value', 'planned', '--reason', '回退', '--owner', '一线席位'], sidecar);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'illegal_transition');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('④ --correction 纠错通道：违表放行 + history corrected:true + 回执 A2-correction；--reason 仍必填', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  run(['state', 'set', '--node', 'n4', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位'], sidecar);

  // 违表（in_progress→planned）+ --correction → 放行
  const fixed = run(['state', 'set', '--node', 'n4', '--axis', 'progress', '--value', 'planned', '--reason', '纠错回退', '--owner', '一线席位', '--correction'], sidecar);
  assert.equal(fixed.code, 0);
  assert.equal(fixed.receipt.data.receipt.rule, 'A2-correction');

  const side = readSidecar(sidecar);
  assert.equal(side.nodes.n4.progress, 'planned');
  const last = side.nodes.n4.history[side.nodes.n4.history.length - 1];
  assert.equal(last.kind, 'set');
  assert.equal(last.corrected, true, '纠错写入必须带 corrected:true 留痕');
  assert.equal(last.reason, '纠错回退');

  // 合法迁移带 --correction 不误标（corrected 只指真实绕过 A2 的写入）
  const legal = run(['state', 'set', '--node', 'n4', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--correction'], sidecar);
  assert.equal(legal.code, 0);
  assert.equal(legal.receipt.data.receipt.rule, 'A2');
  const side2 = readSidecar(sidecar);
  assert.equal(side2.nodes.n4.history[side2.nodes.n4.history.length - 1].corrected, undefined);

  // 纠错通道不豁免 --reason（requireArgs 既有行为：缺必填参数抛错 → 顶层 catch internal exit 2，本批次不改）；
  // 断言可验证语义：调用失败且不产生任何写入。
  const noReason = run(['state', 'set', '--node', 'n4', '--axis', 'progress', '--value', 'cancelled', '--owner', '一线席位', '--correction'], sidecar);
  assert.notEqual(noReason.code, 0);
  const side3 = readSidecar(sidecar);
  assert.equal(side3.nodes.n4.progress, 'in_progress'); // 值未动
  assert.equal(side3.nodes.n4.history.length, 3); // 三次成功 set（init/纠错/合法）；缺参调用不落历史

  fs.rmSync(dir, { recursive: true, force: true });
});

test('⑤ truth 前进 --correction 不免除回执：无 --receipt = receipt_required；带回执放行且 corrected:true', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  // 播种：truth=candidate 的既有节点（真实侧车形状）
  seed(sidecar, { n5: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });

  // candidate→effective 既违表又是 truth 前进：--correction 绕过 A2，但回执门禁照拦
  const noReceipt = run(['state', 'set', '--node', 'n5', '--axis', 'truth', '--value', 'effective', '--reason', '纠错推进', '--owner', '一线席位', '--correction'], sidecar);
  assert.equal(noReceipt.code, 1);
  assert.equal(noReceipt.receipt.diagnostics[0].rule, 'receipt_required');
  assert.notEqual(noReceipt.receipt.diagnostics[0].rule, 'illegal_transition', 'correction 应先放行 A2，拦点应落在回执门禁');

  // 补回执 → 放行；history 事件带 corrected:true + receipt 字段
  const receiptFile = path.join(dir, 'r5.json');
  fs.writeFileSync(receiptFile, '{}', 'utf8');
  const ok = run(['state', 'set', '--node', 'n5', '--axis', 'truth', '--value', 'effective', '--reason', '纠错推进', '--owner', '一线席位', '--correction', '--receipt', receiptFile], sidecar);
  assert.equal(ok.code, 0);
  assert.equal(ok.receipt.data.receipt.rule, 'A2-correction');

  const side = readSidecar(sidecar);
  assert.equal(side.nodes.n5.truth, 'effective');
  const last = side.nodes.n5.history[side.nodes.n5.history.length - 1];
  assert.equal(last.corrected, true);
  assert.equal(last.receipt, path.resolve(receiptFile));
  assert.equal(side.nodes.n5.truthReceipts.length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('⑥ truth 回退经 --correction 放行且无需回执；无旗标时被 A2 拒', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  seed(sidecar, { n6: { owner: '一线席位', truth: 'effective', progress: 'planned', ledger: 'clean', evidence: [], history: [] } });

  // 回退（effective→candidate）无旗标：违表被拒（先于回执判定，回退本非前进）
  const bad = run(['state', 'set', '--node', 'n6', '--axis', 'truth', '--value', 'candidate', '--reason', '回退', '--owner', '一线席位'], sidecar);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'illegal_transition');

  // 加 --correction：纠错语义放行，回退非前进 → 无需 --receipt
  const fixed = run(['state', 'set', '--node', 'n6', '--axis', 'truth', '--value', 'candidate', '--reason', '纠错回退', '--owner', '一线席位', '--correction'], sidecar);
  assert.equal(fixed.code, 0);
  assert.equal(fixed.receipt.data.to, 'candidate');
  assert.equal(fixed.receipt.data.receipt.rule, 'A2-correction');

  const side = readSidecar(sidecar);
  assert.equal(side.nodes.n6.truth, 'candidate');
  assert.equal(side.nodes.n6.truthReceipts, undefined, '回退非前进不落 truthReceipts');
  assert.equal(side.nodes.n6.history[side.nodes.n6.history.length - 1].corrected, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('⑦ transition 路径行为回归不变（A2/A3/A4 全保）；合法 set 变更过表放行', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  run(['state', 'set', '--node', 'n7', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位'], sidecar);

  // 合法 set 变更（in_progress→blocked 在迁移表内）：放行，receipt.rule=A2
  const legal = run(['state', 'set', '--node', 'n7', '--axis', 'progress', '--value', 'blocked', '--reason', '阻塞', '--owner', '一线席位'], sidecar);
  assert.equal(legal.code, 0);
  assert.equal(legal.receipt.data.receipt.rule, 'A2');

  // transition 违表仍拒（与 set 同码同表）
  const badT = run(['state', 'transition', '--node', 'n7', '--axis', 'progress', '--from', 'blocked', '--to', 'verified', '--reason', '跳级', '--owner', '一线席位'], sidecar);
  assert.equal(badT.code, 1);
  assert.equal(badT.receipt.diagnostics[0].rule, 'illegal_transition');

  // A3 仍在 transition 路径生效
  run(['state', 'transition', '--node', 'n7', '--axis', 'progress', '--from', 'blocked', '--to', 'in_progress', '--reason', '恢复', '--owner', '一线席位'], sidecar);
  const noEvidence = run(['state', 'transition', '--node', 'n7', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified', '--reason', '无证据', '--owner', '一线席位'], sidecar);
  assert.equal(noEvidence.code, 1);
  assert.equal(noEvidence.receipt.diagnostics[0].rule, 'verified_requires_evidence');

  // A4 owner 校验仍在 set 路径生效（先于 A2，不泄露迁移表判定）
  const wrongOwner = run(['state', 'set', '--node', 'n7', '--axis', 'progress', '--value', 'planned', '--reason', 'x', '--owner', 'intruder', '--correction'], sidecar);
  assert.equal(wrongOwner.code, 1);
  assert.equal(wrongOwner.receipt.diagnostics[0].rule, 'owner_mismatch');

  fs.rmSync(dir, { recursive: true, force: true });
});
