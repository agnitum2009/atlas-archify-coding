// 版本纪律（增长控制开发规范批一#1，2026-08-15）牙齿：
// ① state 写路径每条 history 事件（set/settle 代表）带可选字段 engine=package.json version；
// ② 自动留痕 autoTrace 的 detail 带 engine；
// ③ scripts/verify-release-version.mjs 一致时 exit 0、人为造不一致（临时目录拷贝法）exit 1。
// 红线：全部用临时目录侧车，绝不触碰 <home>/demo-ledger/state/atlas-state.json。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const BIN = path.join(ROOT, 'bin', 'atlas-engine.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-version-'));
}

function seedSidecar(dir, nodes) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: nodes || {} }) + '\n');
  return p;
}

function readSidecar(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('版本戳：state set 产生的 history 事件含 engine=package.json version', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir);
  const r = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', '开工', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const sc = readSidecar(sidecar);
  assert.equal(sc.nodes.n1.history.length, 1);
  assert.equal(sc.nodes.n1.history[0].kind, 'set');
  assert.equal(sc.nodes.n1.history[0].engine, PKG_VERSION, 'history 事件 engine 应等于 package.json version');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('版本戳：state settle 产生的 history 事件含 engine=package.json version', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { n1: { owner: '一线席位', truth: 'candidate', progress: 'in_progress', ledger: 'backlog', evidence: ['data/x.md:1'], history: [] } });
  const r = run(['state', 'settle', '--node', 'n1', '--reason', '验收通过', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(r.code, 0, r.stdout);
  const sc = readSidecar(sidecar);
  const settleEvent = sc.nodes.n1.history[sc.nodes.n1.history.length - 1];
  assert.equal(settleEvent.kind, 'settle');
  assert.equal(settleEvent.engine, PKG_VERSION, 'settle history 事件 engine 应等于 package.json version');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('版本戳：autoTrace 的 detail 含 engine（compile 自动留痕）', () => {
  const dir = tmpDir();
  const sidecar = seedSidecar(dir, { c1: { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [], history: [] } });
  const diagram = path.join(dir, 'spec.json');
  fs.writeFileSync(diagram, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 't', quality_profile: 'showcase', views: [] }, components: [{ id: 'c1', kind: 'service', label: 'C1' }] }));
  const r = run(['compile', '--diagram', diagram, '--sidecar', sidecar, '--out', path.join(dir, 'compiled.json')]);
  assert.equal(r.code, 0, r.stdout);
  const sc = readSidecar(sidecar);
  assert.equal(sc.trace.length, 1);
  assert.equal(sc.trace[0].kind, 'command');
  assert.equal(sc.trace[0].detail.command, 'compile');
  assert.equal(sc.trace[0].detail.engine, PKG_VERSION, 'autoTrace detail 应含 engine=package.json version');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-version：一致时 exit 0（临时目录拷贝法）', () => {
  const dir = tmpDir();
  // 镜像仓内布局（脚本在 scripts/ 一层，根 = 上一级）：脚本以 new URL('..', import.meta.url) 解析根。
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'verify-release-version.mjs'), path.join(dir, 'scripts', 'verify-release-version.mjs'));
  fs.copyFileSync(path.join(ROOT, 'RELEASES.md'), path.join(dir, 'RELEASES.md'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify-release-version.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-version：人为造不一致（临时拷贝改 RELEASES 顶部版本）exit 1 且列两值', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'verify-release-version.mjs'), path.join(dir, 'scripts', 'verify-release-version.mjs'));
  fs.copyFileSync(path.join(ROOT, 'RELEASES.md'), path.join(dir, 'RELEASES.md'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  const clPath = path.join(dir, 'RELEASES.md');
  const cl = fs.readFileSync(clPath, 'utf8').replace(/^## \[\d+\.\d+\.\d+\]/m, '## [9.9.9]');
  fs.writeFileSync(clPath, cl);
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify-release-version.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 1, '不一致必须 exit 1');
  assert.ok(res.stderr.includes('9.9.9'), '应列出 RELEASES 侧版本：' + res.stderr);
  assert.ok(res.stderr.includes(PKG_VERSION), '应列出 package.json 侧版本：' + res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
