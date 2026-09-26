// lib/error-codes.mjs：错误码唯一源 + 唯一诊断构造器（减法批二，命令面单源化）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, isRegisteredRule, diag } from '../lib/error-codes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('注册表：94 条、code 唯一、四字段均为非空字符串、冻结', () => {
  assert.equal(ERROR_CODES.length, 94);
  assert.equal(new Set(ERROR_CODES.map((e) => e.code)).size, ERROR_CODES.length, 'code 重复');
  for (const e of ERROR_CODES) {
    for (const k of ['code', 'source', 'exit', 'remedy']) assert.ok(typeof e[k] === 'string' && e[k].length > 0, e.code + '.' + k);
  }
  assert.ok(Object.isFrozen(ERROR_CODES));
});

test('注册表与现契约附录 A 逐行一致（迁移无损）', () => {
  const md = fs.readFileSync(path.join(ROOT, 'specs', 'command-contract.md'), 'utf8');
  const rows = md.slice(md.indexOf('## 附录 A')).split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| 错误码') && !l.startsWith('| ---'));
  assert.equal(rows.length, ERROR_CODES.length);
  rows.forEach((row, i) => {
    const e = ERROR_CODES[i];
    assert.equal(row, `| ${e.code} | ${e.source} | ${e.exit} | ${e.remedy} |`, '第 ' + (i + 1) + ' 行不一致');
  });
});

test('isRegisteredRule：表内码 true、gate_ 前缀按模板行放行、未知码 false', () => {
  assert.equal(isRegisteredRule('bad_args'), true);
  assert.equal(isRegisteredRule('gate_validate'), true);
  assert.equal(isRegisteredRule('gate_out_placement'), true);
  assert.equal(isRegisteredRule('layout.portal-v2'), true);
  assert.equal(isRegisteredRule('layout.'), false);
  assert.equal(isRegisteredRule('P5'), true);
  assert.equal(isRegisteredRule('P'), false);
  assert.equal(isRegisteredRule('Px'), false);
  assert.equal(isRegisteredRule('not_a_code'), false);
  assert.equal(isRegisteredRule(''), false);
});

test('diag：登记码返回契约形状；未登记码抛错并点名', () => {
  assert.deepEqual(diag('bad_args', 'm', 's'), { rule: 'bad_args', severity: 'error', subject: 's', evidence: 'm', supportedFixes: [] });
  assert.deepEqual(diag('cross_axis_unlisted', 'm', 's', 'warning', ['f']).severity, 'warning');
  assert.throws(() => diag('not_a_code', 'm', 's'), /未登记错误码：not_a_code/);
});

test('顶层 catch 与侧车操作码必须已登记（否则抛错逃出 catch）', () => {
  for (const code of ['internal', 'unknown_subcommand', 'sidecar_conflict', 'sidecar_locked', 'sidecar_readonly',
    'sidecar_missing', 'sidecar_unreadable', 'sidecar_invalid_json', 'sidecar_bad_schema', 'sidecar_bad_shape',
    'sidecar_error', 'sidecar_write_failed', 'sidecar_commit_unknown', 'sidecar_lock_failed',
    'sidecar_path_unresolvable', 'sidecar_hardlinked', 'sidecar_bad_revision']) {
    assert.equal(isRegisteredRule(code), true, code);
  }
});

test('lib 内只有 error-codes.mjs（构造器）与 layout.mjs（参数序适配器）定义 diag；诊断对象不再内联字面量', () => {
  const lib = path.join(ROOT, 'lib');
  const defs = [];
  const inline = [];
  for (const f of fs.readdirSync(lib).filter((n) => n.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(lib, f), 'utf8');
    if (/^(export )?function diag\(/m.test(src)) defs.push(f);
    src.split('\n').forEach((line, i) => {
      // 任意位置、值为字符串字面量的 rule: 键（单行对象也算）；排除成功回执（同行含 status: 'ok'）与 state-machine 的规则表。
      if (/(?<![.\w])rule\s*:\s*'/.test(line) && !/status\s*:\s*'ok'/.test(line) && f !== 'state-machine.mjs') inline.push(f + ':' + (i + 1));
    });
  }
  assert.deepEqual(defs.sort(), ['error-codes.mjs', 'layout.mjs']);
  assert.deepEqual(inline, []);
});

test('侧车操作码集合 SIDECAR_OP_CODES 全部已登记（顶层 catch 内 diag 不得抛）', async () => {
  const { SIDECAR_OP_CODES } = await import('../lib/cli-util.mjs');
  assert.ok(SIDECAR_OP_CODES instanceof Set && SIDECAR_OP_CODES.size > 0);
  for (const code of SIDECAR_OP_CODES) assert.equal(isRegisteredRule(code), true, code);
});

test('lib/bin 内所有错误码字面量（diag 首参 / .code = / code: / code ||）均已登记', () => {
  const shapes = [/diag\(\s*'([^']+)'(?!\s*\+)/g, /\.code\s*=\s*'([^']+)'/g, /\bcode\s*:\s*'([^']+)'/g, /\bcode\s*\|\|\s*'([^']+)'/g];
  const unregistered = [];
  for (const dir of ['lib', 'bin']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      for (const re of shapes) for (const m of src.matchAll(re)) if (!isRegisteredRule(m[1])) unregistered.push(dir + '/' + f + ' → ' + m[1]);
    }
  }
  assert.deepEqual(unregistered, []);
});
