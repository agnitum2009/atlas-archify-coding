// --help 牙齿：exit 0 + 十命令名全出现 + ≤50 行。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'atlas-engine.mjs');
const EXPECTED_COMMANDS = ['init', 'state', 'diff', 'compile', 'report', 'gate', 'trace', 'lessons', 'notice', 'doctor'];

test('--help：exit 0，十个命令名全部出现，总长 ≤50 行', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const cmd of EXPECTED_COMMANDS) {
    assert.ok(r.stdout.includes(cmd), '--help 缺命令名：' + cmd);
  }
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.length <= 50, '--help 超 50 行：' + lines.length);
});


