// --help 牙齿：exit 0 + 十命令名全出现 + ≤50 行。
// 0.10.0：evidence 顶层命令与 lessons hit 子命令物理移除（两段式废弃第二阶段）——
// --help 不再出现 [evidence] 块与 lessons hit 行，行数随之下降（50 → 45）。

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

test('--help（0.10.0 移除面）：不再出现 [evidence] 块与 lessons hit 行，替代路径仍在 state/doctor 行内', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('[evidence]'), '[evidence] 帮助块应随命令移除');
  assert.ok(!/^atlas-engine evidence /m.test(r.stdout), 'evidence 顶层命令用法行应移除');
  assert.ok(!/lessons hit --id/.test(r.stdout), 'lessons hit 用法行应移除（移除注记提及属文档化，非法用行）');
  // 移除后的 --help 行数应下降（0.9.0 实测 50 行 → 0.10.0 实测 45 行）。
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.length < 50, '移除后 --help 行数应下降：' + lines.length);
  // 替代路径仍可达：state evidence-add 与 doctor 行原样保留。
  assert.ok(r.stdout.includes('state evidence-add'), '替代路径（写）state evidence-add 仍在');
  assert.ok(r.stdout.includes('[doctor]'), '替代路径（读）doctor 仍在');
});

test('无参数：等同 --help，exit 0；state 六行原文保留', () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('atlas-engine state get --node <id> [--sidecar <path>]'));
  assert.ok(r.stdout.includes('atlas-engine state block --node <id> --reason <text> --owner <o> [--with-backlog] [--sidecar <path>]'));
});
