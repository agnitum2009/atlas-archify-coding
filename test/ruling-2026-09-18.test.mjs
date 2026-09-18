// 裁定批（2026-09-18，0.21.0）：八项裁定中可机检的五项，每条先红后绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin/atlas-engine.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function run(args, { cwd, env } = {}) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd, env: env || process.env });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpdir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedVerified(t, prefix) {
  const dir = tmpdir(t, prefix);
  const atlas = path.join(dir, 'atlas');
  assert.equal(run(['init', '--dir', atlas, '--title', 'Demo', '--diagram-id', 'demo']).code, 0);
  const sidecar = path.join(atlas, 'state/atlas-state.json');
  const proof = path.join(atlas, 'evidence/demo/proof.txt');
  fs.writeFileSync(proof, 'evidence\n');
  assert.equal(run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--class', 'task', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]).code, 0);
  assert.equal(run(['state', 'evidence-add', '--node', 'n1', '--locator', proof + ':1', '--sidecar', sidecar]).code, 0);
  assert.equal(run(['state', 'settle', '--node', 'n1', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar]).code, 0);
  return { dir, atlas, sidecar };
}

function shimPath(dir, gitScript) {
  const bin = path.join(dir, 'shim-bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, path.basename(process.execPath)));
  if (gitScript) { fs.writeFileSync(path.join(bin, 'git'), gitScript); fs.chmodSync(path.join(bin, 'git'), 0o755); }
  return bin;
}

// 裁定 2：不加 --version 旗标，--help 首行印版本。
test('--help 首行携带 package.json 版本（不占旗标预算）', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout.split('\n')[0], new RegExp('^atlas-engine ' + PKG_VERSION.replace(/\./g, '\\.') + ' — '));
});

// 裁定 1：不加 unlock 命令，sidecar_locked 回执给出可直接执行的恢复命令。
test('sidecar_locked 回执附带精确的锁文件删除命令', (t) => {
  const dir = tmpdir(t, 'atlas-lock-');
  const atlas = path.join(dir, 'atlas');
  assert.equal(run(['init', '--dir', atlas, '--title', 'Demo', '--diagram-id', 'demo']).code, 0);
  const sidecar = path.join(atlas, 'state/atlas-state.json');
  const lock = sidecar + '.lock';
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() - 60000, token: 'deadbeefdeadbeef' }));
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--class', 'task', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar],
    { env: { ...process.env, ATLAS_LOCK_TIMEOUT_MS: '50' } });
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.receipt.diagnostics[0].rule, 'sidecar_locked');
  assert.ok(r.receipt.diagnostics[0].evidence.includes("rm -- '" + lock + "'"), r.receipt.diagnostics[0].evidence);
});

// 裁定 4：progress × ledger 组合矩阵成文，report 对表外组合发 warning（不阻断）。
test('report：progress×ledger 表外组合 = cross_axis_unlisted warning；表内不报', (t) => {
  const dir = tmpdir(t, 'atlas-matrix-');
  const sidecar = path.join(dir, 'atlas-state.json');
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'evidence\n');
  // 终态节点带可解析证据，只让组合表规则发声（不与 A3 证据守卫混判）。
  const node = (progress, ledger) => ({ owner: 'o', truth: 'candidate', progress, ledger, class: 'task', evidence: [proof + ':1'], history: [] });
  fs.writeFileSync(sidecar, JSON.stringify({
    schemaVersion: 1, atlas: null, revision: 0,
    nodes: {
      orphanDebt: node('cancelled', 'backlog'),
      settledUnverified: node('planned', 'settled'),
      openDebt: node('in_progress', 'backlog'),
      doneClean: node('cancelled', 'clean'),
    },
  }, null, 2));
  const r = run(['report', '--sidecar', sidecar, '--no-trace']);
  assert.equal(r.code, 0, r.stdout);
  const hits = r.receipt.data.warnings.filter((d) => d.rule === 'cross_axis_unlisted');
  assert.deepEqual(hits.map((d) => d.subject).sort(), ['orphanDebt', 'settledUnverified']);
  assert.ok(hits.every((d) => d.severity === 'warning'));
});

// 裁定 5：git 子进程超时 = 该锚「未检查」，verdict 不得为 verified，且主命令不挂死。
test('report：git 挂起时按 ATLAS_GIT_TIMEOUT_MS 超时，锚计入 unchecked.timeout，verdict≠verified', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) { t.skip('本机无 git'); return; }
  const { dir, sidecar } = seedVerified(t, 'atlas-gittimeout-');
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init']);
  // exec 让 sleep 直接成为子进程（SIGTERM 能杀到它）；shim 置于 PATH 首位以遮蔽真 git。
  const bin = shimPath(dir, '#!/bin/sh\nexec sleep 5\n');
  const started = Date.now();
  const r = run(['report', '--sidecar', sidecar, '--no-trace'], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ATLAS_GIT_TIMEOUT_MS: '200' } });
  assert.ok(Date.now() - started < 4000, '超时未生效：耗时 ' + (Date.now() - started) + 'ms');
  assert.equal(r.receipt.status, 'ok', r.stdout);
  const head = r.receipt.data.evidenceHead;
  assert.ok(head.unchecked.timeout >= 1, JSON.stringify(head));
  assert.notEqual(head.verdict, 'verified');
  assert.equal(head.ok, false);
});

// 裁定 8：no-git 免检按原因计数，「无 git 仓」与「git 不可用」可区分。
test('report：evidenceHead.noGitReasons 区分 no-repo 与 git-unavailable', (t) => {
  const { dir, sidecar } = seedVerified(t, 'atlas-nogitreason-');
  // 显式清掉 ATLAS_GIT_ROOT：开发机若设了它，gitRepoRootOf 会命中仓根而不再是 no-repo。
  const { ATLAS_GIT_ROOT: _ignored, ...cleanEnv } = process.env;
  const noRepo = run(['report', '--sidecar', sidecar, '--no-trace'], { env: cleanEnv });
  assert.equal(noRepo.receipt.data.evidenceHead.noGitReasons['no-repo'], 1, noRepo.stdout);
  if (spawnSync('git', ['--version']).status !== 0) { t.skip('本机无 git'); return; }
  spawnSync('git', ['init', '-q', dir]);
  const bin = shimPath(dir, null);
  const noBin = run(['report', '--sidecar', sidecar, '--no-trace'], { env: { PATH: bin, HOME: process.env.HOME || dir } });
  assert.equal(noBin.receipt.data.evidenceHead.noGitReasons['git-unavailable:ENOENT'], 1, noBin.stdout);
});

// 复审（2026-09-18）：check-ignore 超时不得落成 uncommitted 误红；锁路径含单引号时恢复命令仍可原样执行。
test('report：check-ignore 超时的 gitignored 锚归 unchecked.timeout，不报 a1-evidence-uncommitted', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) { t.skip('本机无 git'); return; }
  const { dir, sidecar, atlas } = seedVerified(t, 'atlas-ignoretimeout-');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'atlas/evidence/\n');
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init']);
  const real = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const gitBin = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(real.status === 0 && gitBin, '需要真 git 路径');
  // show 走真 git（HEAD 里没有该文件 → 进入 check-ignore 分支），check-ignore 挂起。
  const bin = shimPath(dir, '#!/bin/sh\ncase "$*" in *check-ignore*) exec sleep 5;; esac\nexec ' + gitBin + ' "$@"\n');
  const r = run(['report', '--sidecar', sidecar, '--no-trace'], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ATLAS_GIT_TIMEOUT_MS: '200' } });
  assert.equal(r.receipt.status, 'ok', r.stdout);
  const head = r.receipt.data.evidenceHead;
  assert.equal(head.unchecked.timeout, 1, JSON.stringify(head));
  assert.equal(head.uncommitted, 0);
  assert.ok(fs.existsSync(atlas));
});

test("sidecar_locked 恢复命令对含单引号的路径做 shell 转义", (t) => {
  const dir = tmpdir(t, 'atlas-lockquote-');
  const atlas = path.join(dir, "it's here", 'atlas');
  fs.mkdirSync(path.dirname(atlas), { recursive: true });
  assert.equal(run(['init', '--dir', atlas, '--title', 'Demo', '--diagram-id', 'demo']).code, 0);
  const sidecar = path.join(atlas, 'state/atlas-state.json');
  const lock = sidecar + '.lock';
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() - 60000, token: 'deadbeefdeadbeef' }));
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--class', 'task', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar],
    { env: { ...process.env, ATLAS_LOCK_TIMEOUT_MS: '50' } });
  assert.equal(r.receipt.diagnostics[0].rule, 'sidecar_locked');
  const m = r.receipt.diagnostics[0].evidence.match(/rm -- ('(?:[^']|'\\'')*')/);
  assert.ok(m, r.receipt.diagnostics[0].evidence);
  const sh = spawnSync('sh', ['-c', 'rm -- ' + m[1]], { encoding: 'utf8' });
  assert.equal(sh.status, 0, sh.stderr);
  assert.equal(fs.existsSync(lock), false, '恢复命令应原样可执行并删掉锁');
});
