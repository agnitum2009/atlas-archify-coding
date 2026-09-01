// P5 证据列双形态牙齿（2026-08-15 裁定①）：git <sha> 格式合法即 compliant（不再 warning）+
// 二层存在性机器校验（p5-sha-broken / 无根 unchecked 具名披露 / 环境失败不伪报）。
// 0.9.0：脚手架迁 v2 版式（spec/<项目>/ 一级子目录、CSV 落 data/<项目>/）——v1 平铺已废弃塌缩不再校验。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateLayout, ZONES, UNCHECKED } from '../lib/layout.mjs';

function git(dir, args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (res.status !== 0) throw new Error('git ' + args.join(' ') + ' 失败：' + (res.stderr || res.error));
  return res.stdout.trim();
}

// 临时 git 仓 + 一个空提交，返回 { dir, sha }。
function gitRepoWithCommit(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  return { dir, sha: git(dir, ['rev-parse', 'HEAD']) };
}

// 合规布局骨架（v2 版式；data/demo/progress.csv 由各用例自写）。
function scaffoldAtlas(root) {
  for (const z of ZONES) fs.mkdirSync(path.join(root, z), { recursive: true });
  fs.writeFileSync(path.join(root, 'INDEX.md'), '# 项目注册表\n\n| demo | - | 260817 | 260817 | 1 | state/demo.json |\n');
  fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
}

function writeCsv(root, rows) {
  fs.mkdirSync(path.join(root, 'data', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'demo', 'progress.csv'), 'item,evidence\n' + rows.join('\n') + '\n');
}

function withEnv(name, value, fn) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

test('P5 双形态：仓内真实 SHA 格式合法即 compliant（0 P5 诊断）；图谱目录自身是 git 仓优先于 ATLAS_GIT_ROOT', () => {
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-self-'));
  try {
    scaffoldAtlas(atlas);
    git(atlas, ['init', '-q']);
    git(atlas, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'atlas']);
    const sha = git(atlas, ['rev-parse', 'HEAD']);
    writeCsv(atlas, ['feat,git ' + sha, 'fix,lib/x.mjs:12']);
    // 故意把 ATLAS_GIT_ROOT 指向不存在的路径：图谱目录自身是仓，应优先用之、不受污染。
    const r = withEnv('ATLAS_GIT_ROOT', path.join(atlas, 'no-such-repo'), () => validateLayout(atlas));
    assert.deepEqual(r.diagnostics.filter((x) => x.rule.startsWith('P5') || x.rule === 'p5-sha-broken'), []);
    assert.equal(r.unchecked.length, UNCHECKED.length, '根已解析，不得追加 SHA 未验披露');
  } finally {
    fs.rmSync(atlas, { recursive: true, force: true });
  }
});

test('P5 二层校验：ATLAS_GIT_ROOT 指向仓时逐条核验，仓内不存在 SHA = error p5-sha-broken（在仓 SHA 不报）', () => {
  const repo = gitRepoWithCommit('p5-repo-');
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-env-'));
  try {
    scaffoldAtlas(atlas);
    const fake = '0123456789abcdef0123456789abcdef01234567'; // 40 位十六进制，格式合法但不在仓
    writeCsv(atlas, ['ok-row,git ' + repo.sha, 'bad-row,git ' + fake, 'loc-row,lib/y.mjs:3']);
    const r = withEnv('ATLAS_GIT_ROOT', repo.dir, () => validateLayout(atlas));
    const broken = r.diagnostics.filter((x) => x.rule === 'p5-sha-broken');
    assert.equal(broken.length, 1);
    assert.equal(broken[0].severity, 'error');
    assert.equal(broken[0].subject, 'data/demo/progress.csv:3');
    assert.ok(broken[0].evidence.includes(fake), '诊断须携带失效 SHA');
    assert.deepEqual(r.diagnostics.filter((x) => x.rule === 'P5'), [], '两形态格式均合法，无政策性 warning');
    assert.equal(r.unchecked.length, UNCHECKED.length);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(atlas, { recursive: true, force: true });
  }
});

test('P5 无根：不逐条报噪音，unchecked 追加恰好一条「SHA 存在性未验」具名披露（多行 SHA 也只一条）', () => {
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-noroot-'));
  try {
    scaffoldAtlas(atlas);
    writeCsv(atlas, ['a,git 3778f51', 'b,git 0123456789abcdef0123456789abcdef01234567']);
    const r = withEnv('ATLAS_GIT_ROOT', undefined, () => validateLayout(atlas));
    assert.deepEqual(r.diagnostics.filter((x) => x.rule === 'P5' || x.rule === 'p5-sha-broken'), []);
    const extra = r.unchecked.filter((u) => u.includes('SHA 存在性未验'));
    assert.equal(extra.length, 1, '无根披露恰好一条，不逐行噪音');
    assert.ok(extra[0].includes('无可用 git 根'), '披露须说明原因');
    assert.equal(r.unchecked.length, UNCHECKED.length + 1);
  } finally {
    fs.rmSync(atlas, { recursive: true, force: true });
  }
});

test('P5 畸形形式仍 warning（git+非十六进制/短 SHA/裸 SHA），空证据仍 error；git 调用失败不伪报 p5-sha-broken', () => {
  const repo = gitRepoWithCommit('p5-badenv-');
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-mal-'));
  try {
    scaffoldAtlas(atlas);
    writeCsv(atlas, ['w1,git zzzzzzz', 'w2,git 12345', 'w3,d81d957', 'e1,']);
    const r = validateLayout(atlas); // 无根：畸形形式与空证据的判定不依赖根
    const warns = r.diagnostics.filter((x) => x.rule === 'P5' && x.severity === 'warning');
    const errs = r.diagnostics.filter((x) => x.rule === 'P5' && x.severity === 'error');
    assert.deepEqual(warns.map((w) => w.subject), ['data/demo/progress.csv:2', 'data/demo/progress.csv:3', 'data/demo/progress.csv:4']);
    assert.deepEqual(errs.map((e) => e.subject), ['data/demo/progress.csv:5']);

    // ATLAS_GIT_ROOT 指向非 git 仓目录：git 环境失败 ≠ SHA 不在仓 → 具名披露，不产 p5-sha-broken。
    writeCsv(atlas, ['a,git ' + repo.sha]);
    const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-notrepo-'));
    const r2 = withEnv('ATLAS_GIT_ROOT', notRepo, () => validateLayout(atlas));
    assert.deepEqual(r2.diagnostics.filter((x) => x.rule === 'p5-sha-broken'), [], '环境失败不得伪报 SHA 不在仓');
    assert.ok(r2.unchecked.some((u) => u.includes('git 调用失败')), '环境失败须具名披露');
    fs.rmSync(notRepo, { recursive: true, force: true });
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(atlas, { recursive: true, force: true });
  }
});
