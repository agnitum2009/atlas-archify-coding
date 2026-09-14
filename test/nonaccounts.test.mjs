// A1 非账本实体声明（P4，2026-09-11 负责人令）的牙齿：
//   <侧车同目录>/diagram-nonaccounts.json 声明哪些图件 id 是架构构件/图内局部标签、不要求账本记账；
//   命中者计入 a1.nonAccountDeclared 且不再报 a1-diagram-local-id；无声明文件=零破坏（行为与改动前一致）。
// 红线：只用临时目录，绝不触碰真实侧车。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-nonacct-'));
}
function nodeOf(over) {
  const base = { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] };
  return Object.assign(base, over || {});
}

test('A1 非账本实体声明：无声明文件时行为不变（local id 照报）', () => {
  const dir = tmpDir();
  const sidecar = { schemaVersion: 1, atlas: null, nodes: { 'demo-b-real': nodeOf({}) } };
  const spec = { diagram_type: 'architecture', components: [{ id: 'demo-b-real' }, { id: 'local-label' }] };
  const r = buildReport(sidecar, { specs: [spec], root: dir });
  assert.equal(r.a1.diagramLocalIds, 1);
  assert.equal(r.a1.nonAccountDeclared, 0);
});

test('A1 非账本实体声明：命中声明的 id 计入 nonAccountDeclared，不再计入 diagramLocalIds', () => {
  const dir = tmpDir();
  const sidecar = { schemaVersion: 1, atlas: null, nodes: { 'demo-b-real': nodeOf({}) } };
  const spec = { diagram_type: 'architecture', components: [{ id: 'demo-b-real' }, { id: 'local-label' }] };
  const decl = { schemaVersion: 1, nonAccounts: { 'test-diagram': { ids: ['local-label'], reason: 'fixture' } } };
  const declPath = path.join(dir, 'diagram-nonaccounts.json');
  fs.writeFileSync(declPath, JSON.stringify(decl) + '\n');
  const r = buildReport(sidecar, { specs: [spec], root: dir, nonAccountsPath: declPath });
  assert.equal(r.a1.diagramLocalIds, 0);
  assert.equal(r.a1.nonAccountDeclared, 1);
});

test('A1 非账本实体声明：声明文件损坏时降级为空集（不抛错、行为同无声明）', () => {
  const dir = tmpDir();
  const sidecar = { schemaVersion: 1, atlas: null, nodes: { 'demo-b-real': nodeOf({}) } };
  const spec = { diagram_type: 'architecture', components: [{ id: 'demo-b-real' }, { id: 'local-label' }] };
  const declPath = path.join(dir, 'diagram-nonaccounts.json');
  fs.writeFileSync(declPath, '{ not json');
  const r = buildReport(sidecar, { specs: [spec], root: dir, nonAccountsPath: declPath });
  assert.equal(r.a1.diagramLocalIds, 1);
  assert.equal(r.a1.nonAccountDeclared, 0);
});
