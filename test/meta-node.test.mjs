// P-3（0.15.0，边入账，负责人令 2026-09-01）：state set --kind meta 回归钉。
// 立法动机：活账里 9 个 meta 节点全是手工写账（绕过 CLI = 绕过 CAS/锁/公理）；
// 此前 CLI 无入口建 meta 节点，此旗标补上正规通道。report 的 a1-unmatched-account
// 已有豁免通道（kind='meta' 跳过），本批只补 CLI 入口与校验，豁免语义不变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, cwd) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

test('--kind meta：建号时落 kind；同 kind 幂等不炸；读得到', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  const r1 = run(['state', 'set', '--node', 'demo-conn-1', '--axis', 'ledger', '--value', 'clean', '--reason', '边登记', '--owner', 'o', '--kind', 'meta', '--sidecar', sc], dir);
  assert.equal(r1.code, 0, r1.stdout);
  const node = JSON.parse(fs.readFileSync(sc, 'utf8')).nodes['demo-conn-1'];
  assert.equal(node.kind, 'meta', 'kind 必须落账：' + JSON.stringify(node));
  const r2 = run(['state', 'set', '--node', 'demo-conn-1', '--axis', 'progress', '--value', 'in_progress', '--reason', '推进', '--owner', 'o', '--kind', 'meta', '--sidecar', sc], dir);
  assert.equal(r2.code, 0, '同 kind 幂等：' + r2.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--kind 拒非 meta 值；已存在节点不可改 kind（身份即历史）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-bad-'));
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  const bad = run(['state', 'set', '--node', 'n1', '--axis', 'ledger', '--value', 'clean', '--reason', 'r', '--owner', 'o', '--kind', 'code', '--sidecar', sc], dir);
  assert.equal(bad.code, 1);
  assert.equal(bad.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(bad.receipt.diagnostics[0].evidence.includes('仅接受 meta'));
  // 建一个默认节点再试图加 kind=meta → 拒
  run(['state', 'set', '--node', 'n1', '--axis', 'ledger', '--value', 'clean', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
  const late = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', 'o', '--kind', 'meta', '--sidecar', sc], dir);
  assert.equal(late.code, 1, '已存在节点改 kind 必须拒');
  assert.ok(late.receipt.diagnostics[0].evidence.includes('kind 不可改'));
  const persisted = JSON.parse(fs.readFileSync(sc, 'utf8')).nodes['n1'];
  assert.equal(persisted.kind, undefined, '被拒调用不得改账：kind 原样');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('meta 节点豁免：不在 spec 里也不触发 a1-unmatched-account；普通节点照旧报', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-a1-'));
  const sc = path.join(dir, 'sc.json');
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [{ id: 'in-spec', type: 'backend', label: 'In Spec', pos: [0, 0], size: [200, 100] }] }));
  // 一个 meta 边节点（不在 spec）+ 一个普通节点（不在 spec）
  run(['state', 'set', '--node', 'edge-a-b', '--axis', 'ledger', '--value', 'clean', '--reason', '边登记', '--owner', 'o', '--kind', 'meta', '--sidecar', sc], dir);
  run(['state', 'set', '--node', 'plain-node', '--axis', 'ledger', '--value', 'clean', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
  const rep = run(['report', '--sidecar', sc, '--spec', spec, '--brief', '--no-trace'], dir);
  assert.equal(rep.code, 0, rep.stdout);
  // --brief 下 warnings 折叠为计数：metaExempted 应恰为 1（meta 节点被豁免、不计 unmatched），
  // 普通节点不在 spec 须照旧报（a1.warnings 含 plain-node 的 unmatched + 缺 code-sha 提示）。
  const a1 = rep.receipt.data.a1;
  assert.equal(a1.metaExempted, 1, 'meta 节点必须被豁免：' + JSON.stringify(a1));
  assert.equal(a1.errors, 0, '豁免不制造 error');
  assert.equal(a1.warnings, 2, '普通节点不在 spec 须照旧报 unmatched（另含缺 --code-sha 提示）：' + JSON.stringify(a1));
  fs.rmSync(dir, { recursive: true, force: true });
});
