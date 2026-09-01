// 锚定位符（locator）牙齿（格式/存在性/行界）：lib 层 lint 内核——report 证据 lint（读方）与
// state evidence-reanchor（写方）共用；顶层 evidence lint 命令已于 v0.10.0 移除（两段式废弃第二阶段）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLocator, lintLocator, lintLocators, anchorQuality } from '../lib/evidence.mjs';

function tmpFile(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
  const file = path.join(dir, 'sample.ts');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return { dir, file };
}

test('parseLocator：合法/坏格式/零行号', () => {
  assert.equal(parseLocator('src/a.ts:42').ok, true);
  assert.equal(parseLocator('src/a.ts:42').line, 42);
  assert.equal(parseLocator('no-line').ok, false);
  assert.equal(parseLocator('a.ts:0').ok, true);
});

test('lintLocator：存在文件行内合法；缺失/越界/坏格式被拒', () => {
  const { dir, file } = tmpFile(['a', 'b', 'c']);
  const rel = path.relative(process.cwd(), file);

  const ok = lintLocator(rel + ':2', process.cwd());
  assert.equal(ok.ok, true);

  const missing = lintLocator('definitely-not-here.ts:1', process.cwd());
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostic.rule, 'file_missing');

  const bounds = lintLocator(rel + ':99', process.cwd());
  assert.equal(bounds.ok, false);
  assert.equal(bounds.diagnostic.rule, 'line_out_of_bounds');

  const bad = lintLocator('noline', process.cwd());
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostic.rule, 'bad_locator');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('全角冒号：bad_locator 带可行动提示；中文括号+半角冒号合法；不含则原消息不回归', () => {
  // 实战踩坑复现（实战反馈档（2026-08-15））：中文括号合法，真凶是全角冒号
  const fw = parseLocator('测试（副本）.md：2');
  assert.equal(fw.ok, false);
  assert.equal(fw.diagnostic.rule, 'bad_locator');
  assert.ok(fw.diagnostic.evidence.includes('全角冒号'));
  assert.ok(fw.diagnostic.evidence.includes("半角冒号':'"));

  const legal = parseLocator('测试（副本）.md:2');
  assert.equal(legal.ok, true);
  assert.equal(legal.file, '测试（副本）.md');
  assert.equal(legal.line, 2);

  // 不含全角冒号的坏格式：维持原消息，不追加提示
  const plain = parseLocator('no-line');
  assert.equal(plain.ok, false);
  assert.equal(plain.diagnostic.evidence, 'locator 必须形如 文件:行号');

  // 文件名本身含全角冒号且格式合法：必须照常通过（不做归一正是为了不破坏该类 locator）
  const weird = parseLocator('a：b.md:3');
  assert.equal(weird.ok, true);
  assert.equal(weird.file, 'a：b.md');
});

test('lintLocators：聚合计数与诊断列表', () => {
  const { dir, file } = tmpFile(['x']);
  const rel = path.relative(process.cwd(), file);
  const report = lintLocators([rel + ':1', 'missing.ts:1', 'bad'], process.cwd());
  assert.equal(report.valid, 1);
  assert.equal(report.invalid, 2);
  assert.equal(report.diagnostics.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anchorQuality（0.8.0）：空行→anchor-empty-line；NUL→anchor-binary；正常文本/缺失/越界/坏格式→空数组', () => {
  const { dir, file } = tmpFile(['alpha', '', 'gamma']); // 第 2 行 trim 后为空
  const empty = anchorQuality(file + ':2', '/');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].rule, 'anchor-empty-line');
  assert.equal(empty[0].severity, 'warning');
  // 只含空格的行同样判空。
  assert.equal(anchorQuality(file + ':1', '/').length, 0, '正常文本行不误报');
  assert.equal(anchorQuality(file + ':3', '/').length, 0);

  // 疑似二进制：前 8KB 含 NUL（0x41='A' 填充保证无 NUL 对照组成立）。
  const bin = path.join(dir, 'bin.dat');
  fs.writeFileSync(bin, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 0x41)]));
  assert.equal(anchorQuality(bin + ':1', '/').length, 0, '无 NUL 不判二进制');
  fs.writeFileSync(bin, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), Buffer.alloc(64, 0x41)]));
  const b = anchorQuality(bin + ':1', '/');
  assert.equal(b.length, 1);
  assert.equal(b[0].rule, 'anchor-binary');
  assert.equal(b[0].severity, 'warning');

  // broken 侧语义不在此重复发声：文件缺失/行越界/坏格式一律 []。
  assert.deepEqual(anchorQuality(path.join(dir, 'ghost.ts') + ':1', '/'), []);
  assert.deepEqual(anchorQuality(file + ':99', '/'), []);
  assert.deepEqual(anchorQuality('no-line', '/'), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

