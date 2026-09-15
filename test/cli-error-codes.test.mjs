// CLI 错误码呈现牙齿：坏 JSON 无双前缀；锁超时/冲突呈自身码非 internal；正常路径回归。
// （对应契约附录 A：store 错误码原样呈现；sidecar_conflict/sidecar_locked = exit 1 failed）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, sidecarPath, env) {
  const all = args.concat(['--sidecar', sidecarPath]);
  const res = spawnSync(process.execPath, [BIN].concat(all), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}),
  });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-engine-errcodes-'));
}

test('requireArgs 对缺参提供 bad_args 错误码', async () => {
  const { requireArgs } = await import('../lib/cli-util.mjs');
  assert.throws(() => requireArgs({}, ['reason']), { code: 'bad_args' });
});

const requiredCalls = {
  set: { node: 'n1', axis: 'progress', value: 'in_progress', reason: 'work', owner: 'o' },
  transition: { node: 'n1', axis: 'progress', from: 'planned', to: 'in_progress', reason: 'work', owner: 'o' },
  settle: { node: 'n1', reason: 'done', owner: 'o' },
  block: { node: 'n1', reason: 'waiting', owner: 'o' },
};
for (const [sub, values] of Object.entries(requiredCalls)) {
  for (const missing of ['node', 'reason', 'owner']) {
    test('state ' + sub + ' 缺 --' + missing + '：exit 1 bad_args 且磁盘不变', (t) => {
      const dir = tmpDir();
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const sidecar = path.join(dir, 'atlas-state.json');
      const before = JSON.stringify({ schemaVersion: 1, revision: 4, nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } } }) + '\n';
      fs.writeFileSync(sidecar, before);
      const args = Object.entries(values).filter(([key]) => key !== missing).flatMap(([key, value]) => ['--' + key, value]);
      const result = run(['state', sub, ...args], sidecar);
      assert.equal(result.code, 1, result.stdout);
      assert.equal(result.receipt.diagnostics[0].rule, 'bad_args');
      assert.ok(result.receipt.diagnostics[0].evidence.includes('--' + missing));
      assert.equal(fs.readFileSync(sidecar, 'utf8'), before);
      assert.deepEqual(fs.readdirSync(dir), ['atlas-state.json']);
    });
  }
}

test('未知顶层命令（0.10.0，holdout #2 P2b）：exit 1 / rule=unknown_subcommand——用户输入错误不再悬 internal/exit 2', () => {
  const res = spawnSync(process.execPath, [BIN, 'evidnece', 'lint'], { encoding: 'utf8' });
  assert.equal(res.status, 1, '拼错的顶层命令 = 用户输入校验失败 exit 1（0.9.0 为 exit 2 / rule=internal——归类错误）');
  const receipt = JSON.parse(res.stdout);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.diagnostics[0].rule, 'unknown_subcommand', '复用既有 unknown_subcommand 码');
  assert.equal(receipt.diagnostics[0].subject, 'evidnece');
  assert.ok(receipt.diagnostics[0].evidence.includes('未知命令'), receipt.diagnostics[0].evidence);
  assert.ok(receipt.diagnostics[0].evidence.includes('doctor'), '消息列出当前支持命令清单');
});

test('坏 JSON 侧车：state get exit 1，rule 恰为 sidecar_invalid_json（无双前缀）', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, '{ 不是合法 JSON', 'utf8');
  const res = run(['state', 'get', '--node', 'n1'], sidecar);
  assert.equal(res.code, 1);
  assert.equal(res.receipt.status, 'failed');
  assert.equal(res.receipt.diagnostics[0].rule, 'sidecar_invalid_json');
  assert.ok(!res.receipt.diagnostics[0].rule.startsWith('sidecar_sidecar'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('锁被存活进程持有且超时：state set exit 1，rule=sidecar_locked（非 internal、非 exit 2）', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: {}, revision: 0 }), 'utf8');
  // pid=本测试进程（存活）→ 非陈旧锁；ATLAS_LOCK_TIMEOUT_MS=150 → 快速触达超时。
  fs.writeFileSync(sidecar + '.lock', JSON.stringify({ pid: process.pid, at: Date.now() }) + '\n', 'utf8');
  const res = run(
    ['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'],
    sidecar,
    { ATLAS_LOCK_TIMEOUT_MS: '150' }
  );
  assert.equal(res.code, 1);
  assert.equal(res.receipt.status, 'failed');
  assert.equal(res.receipt.diagnostics[0].rule, 'sidecar_locked');
  assert.notEqual(res.code, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('只读侧车（chmod 444）：state set exit 1 且 rule=sidecar_readonly，内容与权限均未变（0.7.0 缺陷1；修复前 exit 0 静默写入且 444→664 被重置）', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  // 只读侧车 + 已有节点（存量无 class 不受 O3 约束）→ 写入路径才触得到 saveSidecar 的只读守卫。
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: { n1: { owner: '一线席位', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } }, revision: 0 }) + '\n', 'utf8');
  fs.chmodSync(sidecar, 0o444);
  const before = fs.readFileSync(sidecar, 'utf8');
  const res = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(res.code, 1, '只读=保护意图，必须 fail-loud（修复前此处 exit 0 静默穿过）');
  assert.equal(res.receipt.status, 'failed');
  assert.equal(res.receipt.diagnostics[0].rule, 'sidecar_readonly');
  assert.ok(res.receipt.diagnostics[0].evidence.includes('chmod +w'), '消息须给补救路径');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), before, '拒写不得改动内容');
  assert.equal(fs.statSync(sidecar).mode & 0o777, 0o444, '拒写不得改动权限');
  fs.chmodSync(sidecar, 0o644); // 恢复可写以便清理
  fs.rmSync(dir, { recursive: true, force: true });
});

test('正常路径回归：set/get 仍 exit 0 ok，revision 递增', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const set = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--class', 'task'], sidecar);
  assert.equal(set.code, 0);
  assert.equal(set.receipt.status, 'ok');
  const got = run(['state', 'get', '--node', 'n1'], sidecar);
  assert.equal(got.code, 0);
  assert.equal(got.receipt.data.progress, 'in_progress');
  const onDisk = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(onDisk.revision, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
