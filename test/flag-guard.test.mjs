// 增长控制开发规范批一#2/#4 牙齿：未知旗标 fail-loud（--sidcar 不再静默新建平行账本）+ 预算硬顶 + 旗标三向对账。
// 红线：全部用临时目录侧车，绝不触碰 <home>/demo-ledger/state/atlas-state.json。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'atlas-engine.mjs');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-contract-freshness.mjs');

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-flags-'));
}

test('未知旗标 --sidcar：exit 1 bad_args 带合法清单，且不静默新建平行账本', () => {
  const dir = tmpDir();
  const typoPath = path.join(dir, 'atlas-state.json');
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidcar', typoPath]);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'failed');
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--sidcar'), '消息须列出未知旗标名');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--sidecar'), '消息须带合法旗标清单（含正确拼写 --sidecar）');
  assert.ok(!fs.existsSync(typoPath), '拼错旗标不得静默新建平行账本');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('未知旗标 --slcie（report）：exit 1 bad_args 带清单', () => {
  const r = run(['report', '--slcie', 'x']);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'failed');
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--slcie'));
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--slice'));
});

test('未知旗标在子命令（state get）同样被拒', () => {
  const r = run(['state', 'get', '--node', 'n1', '--slcie', 'x']);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'failed');
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--slcie'));
});

test('布尔旗标越权使用（init --no-trace）：exit 1 bad_args（白名单外布尔同样被拒）', () => {
  const r = run(['init', '--no-trace']);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'failed');
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(r.receipt.diagnostics[0].evidence.includes('--no-trace'));
});

test('合法旗标回归：注册表全部 flags 白名单经 parseArgs 逐一放行（布尔/带值双形态）', async () => {
  const { COMMANDS } = await import(pathToFileURL(path.join(ROOT, 'lib', 'commands.mjs')).href);
  const { parseArgs, BOOLEAN_FLAGS } = await import(pathToFileURL(path.join(ROOT, 'lib', 'cli-util.mjs')).href);
  for (const entry of COMMANDS) {
    assert.ok(Array.isArray(entry.flags) && entry.flags.length > 0, entry.name + ' 缺 flags 白名单');
    for (const flag of entry.flags) {
      const argv = Object.prototype.hasOwnProperty.call(BOOLEAN_FLAGS, flag) ? ['--' + flag] : ['--' + flag, 'v'];
      assert.doesNotThrow(() => parseArgs(argv, entry.flags), entry.name + ' 合法旗标 --' + flag + ' 被误拒');
    }
  }
});

test('合法旗标端到端回归：state set / report --no-trace / trace add 正常路径不受影响', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  const set = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(set.code, 0, set.stdout);
  const rep = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(rep.code, 0, rep.stdout);
  const tr = run(['trace', 'add', '--kind', 'decision', '--note', 'n', '--node', 'n1', '--sidecar', sidecar]);
  assert.equal(tr.code, 0, tr.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('预算对账绿路：真实仓 contract-freshness 全绿（命令 ≤10、唯一旗标 ≤50、flags⊆usage∪契约节）', () => {
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('预算红路：--flags-budget 覆盖为 实有-1 → exit 1 且打印「预算超限」', async () => {
  const { COMMANDS } = await import(pathToFileURL(path.join(ROOT, 'lib', 'commands.mjs')).href);
  const actual = new Set(COMMANDS.flatMap((c) => c.flags)).size;
  const res = spawnSync(process.execPath, [SCRIPT, '--flags-budget', String(actual - 1)], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes('预算超限'), res.stderr);
  assert.ok(res.stderr.includes('提预算或退一个旗标'), res.stderr);
});

test('预算红路：--commands-budget 0 → exit 1（命令数超顶）', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--commands-budget', '0'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes('预算超限'), res.stderr);
});

test('三向对账红路：临时拷贝注入未登记旗标（flags 有、usage 与契约节皆无）→ exit 1 列名', () => {
  const dir = tmpDir();
  // 镜像仓内最小布局：scripts/bin/lib/specs 四件 + package.json（lib/version.mjs 启动读版本）足够对账脚本自洽运行。
  for (const sub of ['scripts', 'bin', 'lib', 'specs']) {
    fs.cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  const regPath = path.join(dir, 'lib', 'commands.mjs');
  const reg = fs.readFileSync(regPath, 'utf8');
  assert.ok(reg.includes("init: ['dir', 'title'"), '注入锚点漂移');
  fs.writeFileSync(regPath, reg.replace("init: ['dir', 'title'", "init: ['dir', 'bogus-flag', 'title'"));
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify-contract-freshness.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes('init:bogus-flag'), res.stderr);
  assert.ok(res.stderr.includes('usage 与契约节均未提及'), res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
