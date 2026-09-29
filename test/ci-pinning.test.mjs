// 供应链卫生：CI 中每个 action 引用都钉到 40 位 commit SHA（可变 tag 可被上游重写）。
// 覆盖本仓 .github/workflows/*.yml 与公开投影生成的 CI 模板（scripts/export-public.mjs，仅内部树存在时检查）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('所有 uses: 引用都钉到 40 位 SHA', () => {
  const files = [];
  const wf = path.join(ROOT, '.github', 'workflows');
  if (fs.existsSync(wf)) files.push(...fs.readdirSync(wf).filter((n) => /\.ya?ml$/.test(n)).map((n) => path.join(wf, n)));
  const gen = path.join(ROOT, 'scripts', 'export-public.mjs');
  if (fs.existsSync(gen)) files.push(gen);
  const loose = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([^\s#]+)/g)) {
      if (!/^[0-9a-f]{40}$/.test(m[2])) loose.push(path.relative(ROOT, f) + ' → ' + m[1] + '@' + m[2]);
    }
  }
  assert.ok(files.length > 0, '至少有一个 CI 文件可查');
  assert.deepEqual(loose, []);
});
