// archify 路径解析牙齿：env 存在于磁盘才算；env 失效自动降级 PATH → none（0.37.0 起无本机回退路径）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveArchify } from '../lib/resolve-archify.mjs';

test('resolveArchify：ARCHIFY_BIN 指向存在文件 → source=env；指向不存在路径 → 跳过 env 降级', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-resolve-'));
  const fake = path.join(dir, 'archify.mjs');
  fs.writeFileSync(fake, '// fake archify\n');
  const prev = process.env.ARCHIFY_BIN;
  try {
    process.env.ARCHIFY_BIN = fake;
    const r1 = resolveArchify();
    assert.equal(r1.source, 'env');
    assert.equal(r1.bin, fake);

    process.env.ARCHIFY_BIN = path.join(dir, 'nope.mjs');
    const r2 = resolveArchify();
    assert.notEqual(r2.source, 'env', 'env 路径不存在于磁盘时不算');
    assert.ok(r2.bin === null || fs.existsSync(r2.bin), '返回的 bin 必须存在于磁盘或为 null');
    assert.ok(['path', 'none'].includes(r2.source));
  } finally {
    if (prev === undefined) delete process.env.ARCHIFY_BIN;
    else process.env.ARCHIFY_BIN = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveArchify：无 ARCHIFY_BIN 且 PATH 无 archify → source=none、bin=null（0.37.0：不再有本机回退路径）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-none-'));
  const prevEnv = process.env.ARCHIFY_BIN;
  const prevPath = process.env.PATH;
  try {
    delete process.env.ARCHIFY_BIN;
    process.env.PATH = dir;
    assert.deepEqual(resolveArchify(), { bin: null, source: 'none' });
  } finally {
    if (prevEnv === undefined) delete process.env.ARCHIFY_BIN; else process.env.ARCHIFY_BIN = prevEnv;
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
