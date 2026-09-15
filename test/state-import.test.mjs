// 0.17.0（路线一裁定 2026-09-14）：
//   ① state import —— 历史/迁移导入的唯一合法跨轴写（原子双写 verified+settled，强制证据锚，
//      history kind='import' 带 source/cutoff 溯源，自动投递 notice，与 settle 永久可区分）；
//   ② set 终态守卫 —— progress→verified 无证据拒（init 首写不豁免）；ledger→settled 一律拒
//      （只能经 settle/import 事件）；--correction 为唯一显式出口；
//   ③ report import_unmarked —— 存量 settled 无 settle/import 事件的清洗信号（warning 不阻断）。
// 红线：全部用 mkdtemp 临时目录与临时证据文件，绝不触碰真实侧车。
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

function seed(sidecarPath, nodes) {
  fs.writeFileSync(sidecarPath, JSON.stringify({ schemaVersion: 1, atlas: null, nodes, notices: [], trace: [], lessons: [] }) + '\n');
}

function readSidecar(sidecarPath) {
  return JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
}

// 临时工程目录：侧车 + 真实证据文件（锚哈希需要真实行）。
function tmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-'));
  const evidenceFile = path.join(dir, 'handoff.md');
  fs.writeFileSync(evidenceFile, '# 历史交付回执\n2026-08-10 负责人验收通过\n');
  return { dir, sidecar: path.join(dir, 'atlas-state.json'), locator: evidenceFile + ':2' };
}

test('import  happy path：新节点原子双写 verified+settled，证据锚+哈希+溯源+notice 全落', () => {
  const { dir, sidecar, locator } = tmpWorkspace();
  seed(sidecar, {});
  const r = run(['state', 'import', '--node', 'imp1', '--reason', '历史闭环导入', '--owner', '一线席位', '--locator', locator, '--source', 'legacy-ledger', '--cutoff', '2026-08-10'], sidecar);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.receipt.data.receipt.rule, 'A2-cross-axis-import');
  assert.equal(r.receipt.data.receipt.dualWrite, true);
  assert.equal(r.receipt.data.receipt.provenance, 'imported');

  const sc = readSidecar(sidecar);
  const node = sc.nodes.imp1;
  assert.equal(node.progress, 'verified');
  assert.equal(node.ledger, 'settled');
  assert.deepEqual(node.evidence, [locator]);
  assert.ok(node.evidenceMeta[locator].h, '锚行哈希必须落 evidenceMeta');
  const ev = node.history[0];
  assert.equal(ev.kind, 'import');
  assert.equal(ev.source, 'legacy-ledger');
  assert.equal(ev.cutoff, '2026-08-10');
  assert.equal(ev.by, '一线席位');
  assert.deepEqual(ev.to, { progress: 'verified', ledger: 'settled' });
  assert.equal(sc.notices.length, 1);
  assert.equal(sc.notices[0].kind, 'settled');
  assert.ok(sc.notices[0].summary.startsWith('[import] '), 'notice 须带 [import] 前缀以便席位区分');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import 缺 --locator 为 bad_args 且零写入；锚格式坏 = bad_locator', () => {
  const { dir, sidecar } = tmpWorkspace();
  seed(sidecar, {});
  const before = fs.readFileSync(sidecar, 'utf8');
  // 缺必填参数属于调用错误；合法账本让目标诊断不被 sidecar_missing 遮蔽。
  const missing = run(['state', 'import', '--node', 'imp2', '--reason', 'x', '--owner', '一线席位'], sidecar);
  assert.equal(missing.code, 1);
  assert.equal(missing.receipt.diagnostics[0].rule, 'bad_args');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before, '缺参失败不得写入');
  const bad = run(['state', 'import', '--node', 'imp2', '--reason', 'x', '--owner', '一线席位', '--locator', 'no-line-number'], sidecar);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'bad_locator');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before, '锚格式失败不得写入');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import 只登记零执行史节点：in_progress=import_conflict，已 settled=already_settled，属主不符=owner_mismatch；planned/clean 桩可导入', () => {
  const { dir, sidecar, locator } = tmpWorkspace();
  seed(sidecar, {
    active: { owner: '一线席位', truth: 'candidate', progress: 'in_progress', ledger: 'backlog', evidence: [locator], history: [] },
    done: { owner: '一线席位', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [locator], history: [{ kind: 'settle' }] },
    stub: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] },
  });
  const conflict = run(['state', 'import', '--node', 'active', '--reason', 'x', '--owner', '一线席位', '--locator', locator], sidecar);
  assert.equal(conflict.code, 1);
  assert.equal(conflict.receipt.diagnostics[0].rule, 'import_conflict');
  const settled = run(['state', 'import', '--node', 'done', '--reason', 'x', '--owner', '一线席位', '--locator', locator], sidecar);
  assert.equal(settled.code, 1);
  assert.equal(settled.receipt.diagnostics[0].rule, 'already_settled');
  const foreign = run(['state', 'import', '--node', 'stub', '--reason', 'x', '--owner', 'other', '--locator', locator], sidecar);
  assert.equal(foreign.code, 1);
  assert.equal(foreign.receipt.diagnostics[0].rule, 'owner_mismatch');
  const stub = run(['state', 'import', '--node', 'stub', '--reason', '桩节点历史导入', '--owner', '一线席位', '--locator', locator], sidecar);
  assert.equal(stub.code, 0, stub.stderr);
  assert.equal(readSidecar(sidecar).nodes.stub.progress, 'verified');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set 终态守卫：init 直达 settled / backlog→settled 一律 settled_requires_event；--correction 放行并留痕', () => {
  const { dir, sidecar, locator } = tmpWorkspace();
  const initDirect = run(['state', 'set', '--node', 'n1', '--axis', 'ledger', '--value', 'settled', '--reason', '直达', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(initDirect.code, 1);
  assert.equal(initDirect.receipt.diagnostics[0].rule, 'settled_requires_event');
  // O1–O5 合并注记：建号校验（O3 class_required）先于轴级终态守卫——无 class 的建号先被拒。
  const classless = run(['state', 'set', '--node', 'n0', '--axis', 'ledger', '--value', 'settled', '--reason', '直达', '--owner', '一线席位'], sidecar);
  assert.equal(classless.code, 1);
  assert.equal(classless.receipt.diagnostics[0].rule, 'class_required');

  seed(sidecar, { n2: { owner: '一线席位', truth: 'candidate', progress: 'in_progress', ledger: 'backlog', evidence: [locator], history: [] } });
  const viaSet = run(['state', 'set', '--node', 'n2', '--axis', 'ledger', '--value', 'settled', '--reason', '绕过 settle', '--owner', '一线席位'], sidecar);
  assert.equal(viaSet.code, 1);
  assert.equal(viaSet.receipt.diagnostics[0].rule, 'settled_requires_event');

  const corrected = run(['state', 'set', '--node', 'n2', '--axis', 'ledger', '--value', 'settled', '--reason', '显式纠错', '--owner', '一线席位', '--correction'], sidecar);
  assert.equal(corrected.code, 0, corrected.stderr);
  const last = readSidecar(sidecar).nodes.n2.history.at(-1);
  assert.equal(last.corrected, true, '纠错通道必须 corrected:true 留痕');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set 终态守卫：init/写入 verified 无证据 = verified_requires_evidence；--correction 放行；同值原地写不拦', () => {
  const { dir, sidecar } = tmpWorkspace();
  const initDirect = run(['state', 'set', '--node', 'v1', '--axis', 'progress', '--value', 'verified', '--reason', '直达', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(initDirect.code, 1);
  assert.equal(initDirect.receipt.diagnostics[0].rule, 'verified_requires_evidence');

  const corrected = run(['state', 'set', '--node', 'v1', '--axis', 'progress', '--value', 'verified', '--reason', '显式纠错', '--owner', '一线席位', '--correction', '--class', 'task'], sidecar);
  assert.equal(corrected.code, 0, corrected.stderr);

  // 同值原地写（无状态变更）不触发守卫——否则存量违例节点连 reason 更新都被锁死
  const noop = run(['state', 'set', '--node', 'v1', '--axis', 'progress', '--value', 'verified', '--reason', '原地重写', '--owner', '一线席位'], sidecar);
  assert.equal(noop.code, 0, noop.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report import_unmarked：存量 settled 无事件发 warning（不阻断）；import 落账后消解', () => {
  const { dir, sidecar, locator } = tmpWorkspace();
  seed(sidecar, {
    legacy: { owner: '一线席位', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [locator], history: [] },
  });
  const before = run(['report', '--no-trace'], sidecar);
  assert.equal(before.code, 0, before.stderr);
  const hit = (before.receipt.data.warnings || []).filter((w) => w.rule === 'import_unmarked');
  assert.equal(hit.length, 1);
  assert.ok(hit[0].subject === 'legacy');

  const imp = run(['state', 'import', '--node', 'fresh', '--reason', '历史导入', '--owner', '一线席位', '--locator', locator], sidecar);
  assert.equal(imp.code, 0, imp.stderr);
  const after = run(['report', '--no-trace'], sidecar);
  assert.equal(after.code, 0, after.stderr);
  const remaining = (after.receipt.data.warnings || []).filter((w) => w.rule === 'import_unmarked').map((w) => w.subject);
  assert.deepEqual(remaining, ['legacy'], 'import 落账的节点不得再发 import_unmarked；存量未处理节点仍报');
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const classification of [undefined, 'task', 'not-a-class']) {
  test(`import optional class ${classification} and unknown provenance`, () => {
    const { dir, sidecar, locator } = tmpWorkspace();
    seed(sidecar, {});
    const before = fs.readFileSync(sidecar, 'utf8');
    const args = ['state', 'import', '--node', 'fresh', '--reason', 'legacy', '--owner', '一线席位', '--locator', locator];
    if (classification !== undefined) args.push('--class', classification);
    const r = run(args, sidecar);
    if (classification === 'not-a-class') {
      assert.equal(r.code, 1);
      assert.equal(r.receipt.diagnostics[0].rule, 'invalid_state_value');
      assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
    } else {
      assert.equal(r.code, 0, r.stdout);
      const n = readSidecar(sidecar).nodes.fresh;
      assert.equal(n.class, classification);
      assert.equal(n.history[0].class, classification);
      assert.equal(n.history[0].source, null);
      assert.equal(n.history[0].cutoff, null);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
