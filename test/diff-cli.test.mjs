// diff CLI 端到端牙齿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

test('diff spec：base/head 差异行与汇总；diff state：since 过滤时间线', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-cli-'));
  const baseFile = path.join(dir, 'base.json');
  const headFile = path.join(dir, 'head.json');
  fs.writeFileSync(baseFile, JSON.stringify({ a: 1, n: { x: '1' } }));
  fs.writeFileSync(headFile, JSON.stringify({ a: 2, n: { x: '1' } }));

  const specRun = run(['diff', 'spec', '--base', baseFile, '--head', headFile]);
  assert.equal(specRun.code, 0);
  assert.equal(specRun.receipt.data.summary.changed, 1);
  assert.equal(specRun.receipt.data.rows[0].subject, 'a');

  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, nodes: { m1: { owner: '一线席位', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [{ at: '2026-08-15T01:00:00.000Z', kind: 'settle', from: { progress: 'in_progress' }, to: { progress: 'verified' }, reason: 'r', by: '一线席位' }] } } }));

  const stateRun = run(['diff', 'state', '--sidecar', sidecar, '--since', '2026-08-15T00:00:00.000Z']);
  assert.equal(stateRun.code, 0);
  assert.equal(stateRun.receipt.data.count, 1);
  assert.equal(stateRun.receipt.data.rows[0].kind, 'settle');

  fs.rmSync(dir, { recursive: true, force: true });
});

