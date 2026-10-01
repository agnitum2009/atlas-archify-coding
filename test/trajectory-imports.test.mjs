// import 解析（lib/trajectory-imports.mjs）：夹具 git 仓，全在临时目录；只认 HEAD。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { real } from '../lib/trajectory.mjs';
import { readHeadFiles, repoIndex, extLabel, importKind, importsOf } from '../lib/trajectory-imports.mjs';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function repoWith(t, files, { commit = true } = {}) {
  const dir = real(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-imp-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['-C', dir, 'init', '-q'], { env });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  if (commit) {
    execFileSync('git', ['-C', dir, 'add', '-A', '-f'], { env });
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'x'], { env });
  }
  return dir;
}
function parse(repo, rel, inRepo) {
  const index = repoIndex(repo);
  const src = readHeadFiles(repo, [rel]).get(rel);
  const { deps, unresolved } = importsOf(path.join(repo, rel), src, index, inRepo);
  return { deps: deps.map((d) => (d.dir ? path.relative(repo, d.dir) + '/' : path.relative(repo, d.file))), unresolved };
}

test('JS/TS 相对路径：.tsx / index.ts 补全、./x.js → x.ts、require 与 import()；注释掉的不计；第三方与 node: 忽略', (t) => {
  const repo = repoWith(t, {
    'src/a.ts': [
      "import { b } from './b';",
      "import './c.js';",
      "const d = require('./d');",
      "const e = await import('./e.mjs');",
      "// import { z } from './z';",
      "/* import { y } from './y'; */",
      "import { q } from './missing';",
      "import fs from 'node:fs';",
      "import lodash from 'lodash';",
      "import { s } from './空 格';",
    ].join('\n') + '\n',
    'src/b.tsx': 'export const b = 1;\n',
    'src/c.ts': 'export {};\n',
    'src/d/index.ts': 'module.exports = 1;\n',
    'src/e.mjs': 'export const e = 1;\n',
    'src/空 格.ts': 'export const s = 1;\n',
  });
  assert.deepEqual(parse(repo, 'src/a.ts'), {
    deps: ['src/b.tsx', 'src/空 格.ts', 'src/c.ts', 'src/d/index.ts', 'src/e.mjs'],
    unresolved: ['./missing'],
  });
});

test('只认 HEAD：工作树里未提交的新文件不命中，计 unresolved；inRepo 为假的相对引用既不出边也不计 unresolved', (t) => {
  const repo = repoWith(t, { 'src/a.ts': "import { n } from './new';\nimport { s } from './sub/s';\n" });
  fs.writeFileSync(path.join(repo, 'src/new.ts'), 'export const n = 1;\n');
  assert.deepEqual(parse(repo, 'src/a.ts'), { deps: [], unresolved: ['./new', './sub/s'] });
  const notSub = (p) => !p.includes(path.sep + 'sub' + path.sep);
  assert.deepEqual(parse(repo, 'src/a.ts', notSub), { deps: [], unresolved: ['./new'] });
});

test('语言登记：parsed / unparsed / notApplicable；extLabel 小写、无扩展名单独标记', () => {
  assert.deepEqual(['x.ts', 'x.tsx', 'x.cjs', 'x.go', 'x.py', 'x.sh', 'x.css', 'x.md', 'x.sql', 'x.json', 'Makefile', 'A.PNG'].map(importKind),
    ['parsed', 'parsed', 'parsed', 'parsed', 'unparsed', 'unparsed', 'unparsed', 'notApplicable', 'notApplicable', 'notApplicable', 'notApplicable', 'notApplicable']);
  assert.deepEqual([extLabel('Makefile'), extLabel('A.PNG'), extLabel('a/b.Ts')], ['(无扩展名)', '.png', '.ts']);
});

test('空仓（已 init 无提交）：repoIndex 为空、不抛错；readHeadFiles 省略缺失文件', (t) => {
  const repo = repoWith(t, { 'a.ts': 'x\n' }, { commit: false });
  const idx = repoIndex(repo);
  assert.equal(idx.files.size, 0);
  assert.equal(idx.packages.size, 0);
  assert.deepEqual([...readHeadFiles(repo, ['a.ts']).keys()], []);
});

test('monorepo 包名：main 指向构建产物时回退 src/index.*；exports 字符串；module + TS ESM；子路径先包目录后 src/；第三方与 node_modules 内包忽略', (t) => {
  const repo = repoWith(t, {
    'packages/core/package.json': JSON.stringify({ name: '@s/core', main: 'dist/index.js' }),
    'packages/core/src/index.ts': 'export const core = 1;\n',
    'packages/core/src/util/x.ts': 'export const x = 1;\n',
    'packages/ui/package.json': JSON.stringify({ name: '@s/ui', exports: './lib/main.ts' }),
    'packages/ui/lib/main.ts': 'export const ui = 1;\n',
    'packages/cfg/package.json': JSON.stringify({ name: 'cfg', module: 'm.js' }),
    'packages/cfg/m.ts': 'export const c = 1;\n',
    'packages/empty/package.json': JSON.stringify({ name: '@s/empty' }),
    'packages/broken/package.json': '{ not json',
    'packages/noname/package.json': JSON.stringify({ version: '1.0.0' }),
    'packages/dup-b/package.json': JSON.stringify({ name: 'dup', main: 'b.ts' }),
    'packages/dup-b/b.ts': 'export const b = 1;\n',
    'packages/dup-a/package.json': JSON.stringify({ name: 'dup', main: 'a.ts' }),
    'packages/dup-a/a.ts': 'export const a = 1;\n',
    'node_modules/@s/fake/package.json': JSON.stringify({ name: '@s/fake', main: 'index.js' }),
    'node_modules/@s/fake/index.js': 'module.exports = 1;\n',
    'apps/web/src/app.ts': [
      "import { core } from '@s/core';",
      "import { x } from '@s/core/util/x';",
      "import { ui } from '@s/ui';",
      "import { c } from 'cfg';",
      "import { d } from 'dup';",
      "import { e } from '@s/empty';",
      "import { f } from '@s/fake';",
      "import React from 'react';",
      "import { n } from '@s/core/nope';",
    ].join('\n') + '\n',
  });
  assert.deepEqual([...repoIndex(repo).packages.keys()].sort(), ['@s/core', '@s/empty', '@s/ui', 'cfg', 'dup']);
  assert.deepEqual(parse(repo, 'apps/web/src/app.ts'), {
    deps: ['packages/core/src/index.ts', 'packages/core/src/util/x.ts', 'packages/ui/lib/main.ts', 'packages/cfg/m.ts', 'packages/dup-a/a.ts'],
    unresolved: ['@s/empty', '@s/core/nope'],
  });
});

test('Go：最近 go.mod 的 module 前缀解析到包目录；import 块/别名/_；注释掉的不计；外部包忽略；无非测试 .go 的目录 = unresolved', (t) => {
  const repo = repoWith(t, {
    'go.mod': 'module example.com/app\n\ngo 1.22\n',
    'internal/db/db.go': 'package db\n',
    'internal/db/db_test.go': 'package db\n\nimport "example.com/app/internal/util"\n',
    'internal/util/u.go': 'package util\n',
    'internal/tonly/t_test.go': 'package tonly\n',
    'internal/docs/README.md': '# d\n',
    'cmd/main.go': [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\td "example.com/app/internal/db"',
      '\t_ "example.com/app/internal/util"',
      '\t// "example.com/app/internal/commented"',
      '\t"example.com/app/internal/docs"',
      ')',
      '',
      'import "example.com/app/internal/tonly"',
    ].join('\n') + '\n',
  });
  assert.deepEqual(parse(repo, 'cmd/main.go'), {
    deps: ['internal/db/', 'internal/util/'],
    unresolved: ['example.com/app/internal/tonly', 'example.com/app/internal/docs'],
  });
  assert.deepEqual(parse(repo, 'internal/db/db_test.go'), { deps: ['internal/util/'], unresolved: [] });
});

test('Go：无 go.mod 时全部视为外部包（不出边、不计 unresolved）', (t) => {
  const repo = repoWith(t, { 'x.go': 'package x\n\nimport "foo/bar"\n' });
  assert.deepEqual(parse(repo, 'x.go'), { deps: [], unresolved: [] });
});

test('require / import() 在字符串字面量里（示例代码、测试夹具）不算引用；真实调用照认', (t) => {
  const repo = repoWith(t, {
    'src/a.ts': 'export const a = 1;\n',
    'src/m.ts': [
      'const s1 = "const d = require(\'./a\');";',
      "const s2 = 'await import(\"./a\")';",
      'const s3 = `x = require("./a")`;',
      "const real = require('./a');",
    ].join('\n') + '\n',
  });
  assert.deepEqual(parse(repo, 'src/m.ts'), { deps: ['src/a.ts'], unresolved: [] });
  const repo2 = repoWith(t, { 'src/a.ts': 'x\n', 'src/n.ts': 'const s = "require(\'./a\')";\n' });
  assert.deepEqual(parse(repo2, 'src/n.ts'), { deps: [], unresolved: [] });
});

// —— 整分支审阅修复（0.29.0）——
test('readHeadFiles：缺失文件名含空格、路径含换行都不串位（其后文件内容正确）', (t) => {
  const repo = repoWith(t, { 'x.js': 'X\n', 'a\nb.js': 'NL\n', 'y.js': 'Y\n' });
  const got = readHeadFiles(repo, ['a b.js', 'a\nb.js', 'x.js', 'y.js']);
  assert.deepEqual([...got], [['x.js', 'X\n'], ['y.js', 'Y\n']]);
});

test('Go：只解析首个顶层声明之前的 import（原始字符串里的 import 模板不算）', (t) => {
  const repo = repoWith(t, {
    'go.mod': 'module example.com/app\n',
    'internal/db/db.go': 'package db\n',
    'internal/util/u.go': 'package util\n',
    'gen/g.go': 'package gen\n\nimport "example.com/app/internal/util"\n\nvar tmpl = `\nimport "example.com/app/internal/db"\n`\n',
  });
  assert.deepEqual(parse(repo, 'gen/g.go'), { deps: ['internal/util/'], unresolved: [] });
});

// —— 0.29.1 ——
test('JS/TS 规格先去 ?query / #hash 再解析（报告仍用原规格）；# 开头的 Node imports 写法忽略', (t) => {
  const repo = repoWith(t, {
    'src/a.mjs': 'export const a = 1;\n',
    'src/b.ts': 'export const b = 1;\n',
    'src/m.mjs': [
      "import a from './a.mjs?raw';",
      "import { b } from './b?x=1#frag';",
      "import { c } from './gone.mjs?ops-tools';",
      "import { i } from '#internal/util';",
    ].join('\n') + '\n',
  });
  assert.deepEqual(parse(repo, 'src/m.mjs'), { deps: ['src/a.mjs', 'src/b.ts'], unresolved: ['./gone.mjs?ops-tools'] });
});

test('cross-line quoted/template bodies never create imports, but nested template expressions remain real dependencies', (t) => {
  const repo = repoWith(t, {
    'src/fake.mjs': 'export const a = 1;\n',
    'src/real-a.mjs': 'export const a = 1;\n',
    'src/real-b.mjs': 'export const b = 1;\n',
    'src/main.mjs': [
      'const example = `',
      "import { a } from './fake.mjs';",
      "export { a } from './fake.mjs';",
      "require('./fake.mjs'); import('./fake.mjs');",
      '`;',
      'const continued = "first\\',
      "import './fake.mjs';\\",
      '";',
      'const nested = `require("./fake.mjs") ${`import("./fake.mjs") ${require("./real-b.mjs")}`}`;',
      'const real = `text ${import("./real-a.mjs")}`;',
    ].join('\n') + '\n',
  });
  const got = parse(repo, 'src/main.mjs');
  assert.deepEqual(got.deps.sort(), ['src/real-a.mjs', 'src/real-b.mjs']);
  assert.deepEqual(got.unresolved, []);
});

test('literal import syntax keeps comments, escapes, module.require and division distinct from non-code or object methods', (t) => {
  const repo = repoWith(t, {
    'packages/fake/package.json': JSON.stringify({ name: 'fake-pkg', main: 'index.mjs' }),
    'packages/fake/index.mjs': 'export const a = 1;\n',
    'src/real-a.mjs': 'export const a = 1;\n',
    'src/real-b.mjs': 'export const b = 1;\n',
    'src/real-c.mjs': 'export const c = 1;\n',
    'src/main.mjs': [
      '#!/usr/bin/env node require("fake-pkg")',
      'import /* import "fake-pkg" */ { a } from /* comment */ "./real-a.mjs";',
      'export { "a" as renamed } from "./real-a.mjs";',
      'const regexp = /require("fake-pkg")/;',
      'if (true) /import("fake-pkg")/.test("x");',
      'const text = "/* require(\\\"fake-pkg\\\") */";',
      'obj.require("fake-pkg");',
      'const αrequire = x => x; αrequire("fake-pkg");',
      'module /* comment */ . require("./real-b.mjs");',
      'let x = 2; const ratio = x++ / require("./real-c.mjs");',
      'import("./\\u0072eal-a.mjs", { with: { type: "json" } });',
    ].join('\n') + '\n',
  });
  const got = parse(repo, 'src/main.mjs');
  assert.deepEqual(got.deps.sort(), ['src/real-a.mjs', 'src/real-b.mjs', 'src/real-c.mjs']);
  assert.deepEqual(got.unresolved, []);
});

test('JSX text and attributes are not code; expressions and typed TSX generic arrows preserve real imports', (t) => {
  const repo = repoWith(t, {
    'src/fake.ts': 'export const fake = 1;\n',
    'src/real-a.ts': 'export const a = 1;\n',
    'src/real-b.ts': 'export const b = 1;\n',
    'src/main.tsx': [
      'import { a } from "./real-a";',
      'const view = <div title=\'import("./fake")\'>',
      'import { fake } from "./fake"; require("./fake");',
      '<span>{"require(\\"./fake\\")"}</span>',
      '{import("./real-b")}',
      '</div>;',
      'const identity = <T extends object>(x: T): T => x;',
    ].join('\n') + '\n',
  });
  const got = parse(repo, 'src/main.tsx');
  assert.deepEqual(got.deps.sort(), ['src/real-a.ts', 'src/real-b.ts']);
  assert.deepEqual(got.unresolved, []);
});

test('unclosed lexical contexts disclose unparsed instead of returning guessed dependency facts', (t) => {
  const repo = repoWith(t, { 'src/a.mjs': 'export const a = 1;\n',
    'src/b.mjs': 'import "./a.mjs";\nconst example = `\nrequire("./a.mjs");\n' });
  const index = repoIndex(repo), file = path.join(repo, 'src/b.mjs');
  const got = importsOf(file, readHeadFiles(repo, ['src/b.mjs']).get('src/b.mjs'), index);
  assert.deepEqual(got, { deps: [], unresolved: [], unparsed: true });
});
