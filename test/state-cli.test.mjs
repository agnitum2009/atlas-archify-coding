// state CLI 端到端牙齿（真实子进程 + 临时 sidecar）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, sidecarPath) {
  const all = args.concat(['--sidecar', sidecarPath]);
  const res = spawnSync(process.execPath, [BIN].concat(all), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpSidecar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-engine-test-'));
  return path.join(dir, 'atlas-state.json');
}

test('set → get → 非法迁移 → evidence → settle 全链（含 A2/A3/A4 门禁）', () => {
  const sidecar = tmpSidecar();

  const created = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(created.code, 0);
  assert.equal(created.receipt.status, 'ok');
  assert.equal(created.receipt.data.to, 'in_progress');

  const got = run(['state', 'get', '--node', 'n1'], sidecar);
  assert.equal(got.receipt.data.owner, '一线席位');
  assert.equal(got.receipt.data.progress, 'in_progress');
  assert.equal(got.receipt.data.truth, 'candidate');
  assert.equal(got.receipt.data.ledger, 'clean');

  const illegal = run(['state', 'transition', '--node', 'n1', '--axis', 'truth', '--from', 'candidate', '--to', 'effective', '--reason', '跳级', '--owner', '一线席位'], sidecar);
  assert.equal(illegal.code, 1);
  assert.equal(illegal.receipt.diagnostics[0].rule, 'illegal_transition');

  const noEvidence = run(['state', 'transition', '--node', 'n1', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified', '--reason', '无证据销账', '--owner', '一线席位'], sidecar);
  assert.equal(noEvidence.code, 1);
  assert.equal(noEvidence.receipt.diagnostics[0].rule, 'verified_requires_evidence');

  const wrongOwner = run(['state', 'transition', '--node', 'n1', '--axis', 'progress', '--from', 'in_progress', '--to', 'blocked', '--reason', 'x', '--owner', 'intruder'], sidecar);
  assert.equal(wrongOwner.code, 1);
  assert.equal(wrongOwner.receipt.diagnostics[0].rule, 'owner_mismatch');

  // 2026-09-15（缺陷3）：完成声称要求锚可解析 ⇒ 夹具用真实证据文件（写边仍不校存在性，见下一条）
  const evFile = path.join(path.dirname(sidecar), 'ev.md');
  fs.writeFileSync(evFile, 'evidence line\n');
  const ev = run(['state', 'evidence-add', '--node', 'n1', '--locator', evFile + ':1'], sidecar);
  assert.equal(ev.code, 0);

  const badLocator = run(['state', 'evidence-add', '--node', 'n1', '--locator', 'no-line-number'], sidecar);
  assert.equal(badLocator.code, 1);
  assert.equal(badLocator.receipt.diagnostics[0].rule, 'bad_locator');

  const settled = run(['state', 'settle', '--node', 'n1', '--reason', '销账', '--owner', '一线席位'], sidecar);
  assert.equal(settled.code, 0);
  assert.equal(settled.receipt.data.to.progress, 'verified');
  assert.equal(settled.receipt.data.to.ledger, 'settled');
  assert.equal(settled.receipt.data.receipt.dualWrite, true);

  const finalState = run(['state', 'get', '--node', 'n1'], sidecar);
  assert.equal(finalState.receipt.data.progress, 'verified');
  assert.equal(finalState.receipt.data.ledger, 'settled');
  assert.equal(finalState.receipt.data.historyCount, 3); // set + evidence-add + settle（被拒操作不落历史）

  fs.rmSync(path.dirname(sidecar), { recursive: true, force: true });
});

test('实战反馈修补（实战反馈档（2026-08-15））：全角冒号提示 + settle next 指向 report', () => {
  const sidecar = tmpSidecar();
  run(['state', 'set', '--node', 'fr1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--class', 'task'], sidecar);

  // 全角冒号：bad_locator 报错含可行动提示
  const fw = run(['state', 'evidence-add', '--node', 'fr1', '--locator', '测试（副本）.md：2'], sidecar);
  assert.equal(fw.code, 1);
  assert.equal(fw.receipt.diagnostics[0].rule, 'bad_locator');
  assert.ok(fw.receipt.diagnostics[0].evidence.includes('全角冒号'));

  // 中文括号 + 半角冒号：合法通过（格式层；写边不校存在性——lint 属读方）
  const cjk = run(['state', 'evidence-add', '--node', 'fr1', '--locator', '测试（副本）.md:2'], sidecar);
  assert.equal(cjk.code, 0);

  // 完成声称要求可解析锚（2026-09-15 缺陷3）：先移除上条不可解析锚，再落一条真实锚
  const removed = run(['state', 'evidence-remove', '--node', 'fr1', '--locator', '测试（副本）.md:2'], sidecar);
  assert.equal(removed.code, 0);
  const frEv = path.join(path.dirname(sidecar), 'fr.md');
  fs.writeFileSync(frEv, 'evidence\n');
  const frAdd = run(['state', 'evidence-add', '--node', 'fr1', '--locator', frEv + ':1'], sidecar);
  assert.equal(frAdd.code, 0);

  // settle 成功回执 next 指向 report 且带实际 sidecar 路径
  const settled = run(['state', 'settle', '--node', 'fr1', '--reason', '销账', '--owner', '一线席位'], sidecar);
  assert.equal(settled.code, 0);
  assert.ok(settled.receipt.data.next.includes('销账五动作第4步'));
  assert.ok(settled.receipt.data.next.includes('report'));
  assert.ok(settled.receipt.data.next.includes(sidecar));

  fs.rmSync(path.dirname(sidecar), { recursive: true, force: true });
});

test('block 跨轴事件：--with-backlog 双写 + 无 --with-backlog 只动 progress', () => {
  const sidecar = tmpSidecar();
  run(['state', 'set', '--node', 'b1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'], sidecar);
  const blocked = run(['state', 'block', '--node', 'b1', '--with-backlog', '--reason', '阻塞', '--owner', '一线席位'], sidecar);
  assert.equal(blocked.code, 0);
  assert.equal(blocked.receipt.data.to.progress, 'blocked');
  assert.equal(blocked.receipt.data.to.ledger, 'backlog');

  run(['state', 'transition', '--node', 'b1', '--axis', 'progress', '--from', 'blocked', '--to', 'in_progress', '--reason', '恢复', '--owner', '一线席位'], sidecar);
  const blocked2 = run(['state', 'block', '--node', 'b1', '--reason', '再阻塞', '--owner', '一线席位'], sidecar);
  assert.equal(blocked2.code, 0);
  assert.equal(blocked2.receipt.data.to.ledger, 'backlog');
  fs.rmSync(path.dirname(sidecar), { recursive: true, force: true });
});

test('state get 的可选 class：历史无该字段则省略、显式 null/空串/未知值原样返回，且读命令不改账本字节', (t) => {
  const sidecar = tmpSidecar();
  t.after(() => fs.rmSync(path.dirname(sidecar), { recursive: true, force: true }));
  const legacy = { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] };
  fs.writeFileSync(sidecar, JSON.stringify({
    schemaVersion: 1,
    nodes: {
      'no-class': legacy,
      'null-class': { ...legacy, class: null },
      'empty-class': { ...legacy, class: '' },
      'future-class': { ...legacy, class: 'future-kind-2077' },
    },
  }), 'utf8');
  const bytesBefore = fs.readFileSync(sidecar, 'utf8');

  const dataOf = (id) => {
    const r = run(['state', 'get', '--node', id], sidecar);
    assert.equal(r.code, 0, r.stdout);
    return r.receipt.data;
  };

  // 历史/存量节点（O3 前建号）：不臆造默认值，字段整体省略。
  assert.ok(!Object.prototype.hasOwnProperty.call(dataOf('no-class'), 'class'), '无 class 的历史节点不得凭空补字段');
  // 已有值（含显式 null / 空串 / 未来未知字符串）：原样投影，读侧不归一化。
  assert.equal(dataOf('null-class').class, null);
  assert.equal(dataOf('empty-class').class, '');
  assert.equal(dataOf('future-class').class, 'future-kind-2077');

  assert.equal(fs.readFileSync(sidecar, 'utf8'), bytesBefore, 'state get 是读命令：账本字节不得变动');
});

