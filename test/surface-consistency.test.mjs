// 命令面一致性（取代旧契约保鲜门禁的预算/旗标/章节三项；错误码登记由 lib/error-codes.mjs diag() 构造时强制）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../lib/commands.mjs';
import { OPTIONS } from '../lib/cli-options.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = fs.readFileSync(path.join(ROOT, 'specs', 'command-contract.md'), 'utf8');
// 预算硬顶：数值与 specs/command-contract.md「治理」节一致；超顶 = 显式换入或退役，不在此放宽。
const COMMAND_BUDGET = 11;
const FLAG_BUDGET = 50;

test('预算硬顶：命令数 ≤11、全仓唯一旗标 ≤50', () => {
  assert.ok(COMMANDS.length <= COMMAND_BUDGET, '命令数 ' + COMMANDS.length + ' > ' + COMMAND_BUDGET + '：预算超限 = 提预算或退一个命令');
  const flags = Object.keys(OPTIONS).length;
  assert.ok(flags <= FLAG_BUDGET, '唯一旗标 ' + flags + ' > ' + FLAG_BUDGET + '：预算超限 = 提预算或退一个旗标');
});

test('每命令 OPTIONS 旗标 ⊆ 该命令 usage 文本（--help 是旗标唯一文档面）', () => {
  for (const c of COMMANDS) {
    const usage = c.usage.join('\n');
    for (const flag of c.flags) {
      const re = new RegExp('--' + flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_-])');
      assert.ok(re.test(usage), c.name + ' 的旗标 --' + flag + ' 未出现在 usage 文本');
    }
    assert.deepEqual([...c.flags].sort(), Object.keys(OPTIONS).filter((f) => OPTIONS[f].commands.includes(c.name)).sort(), c.name + ' flags 与 OPTIONS 派生不一致');
  }
});

test('每命令在契约有 `## N. <name>` 章节', () => {
  for (const c of COMMANDS) {
    assert.match(CONTRACT, new RegExp('^## \\d+\\. ' + c.name + '(?![A-Za-z0-9_-])', 'm'), '契约缺章节：' + c.name);
  }
});

test('结构守卫：commands.mjs ≤150 行且只含注册表；cmd-*.mjs 不 import commands.mjs', () => {
  const lib = path.join(ROOT, 'lib');
  const reg = fs.readFileSync(path.join(lib, 'commands.mjs'), 'utf8');
  assert.ok(reg.split('\n').length <= 150, 'lib/commands.mjs ' + reg.split('\n').length + ' 行 > 150：命令实现应放 lib/cmd-<族>.mjs');
  assert.doesNotMatch(reg, /^(export )?function run/m, 'commands.mjs 不得再定义 run* 实现');
  const cmdFiles = fs.readdirSync(lib).filter((f) => /^cmd-[a-z]+\.mjs$/.test(f));
  assert.equal(cmdFiles.length, COMMANDS.length, '每个命令族一个 cmd-*.mjs');
  for (const f of cmdFiles) {
    assert.doesNotMatch(fs.readFileSync(path.join(lib, f), 'utf8'), /from '\.\/commands\.mjs'/, f + ' 不得 import commands.mjs（防循环）');
  }
});

test('结构守卫：cmd-*.mjs 顶层函数 ≤120 行；lib 其余超长函数只能是白名单且不超上限', () => {
  // 白名单 = 0.23.1 拆分时的存量上帝函数及其行数（只减不增；拆掉一个就删一条）。
  // 0.34.0 曾因 validateLayout +3 行、buildReport +1 行越限而把本守卫整条删除；0.34.1 恢复守卫并把函数收回上限内。
  const CEILING = { validateLayout: 364, buildReport: 317, runDoctor: 276, runGateChain: 171 };
  const lib = path.join(ROOT, 'lib');
  const over = [];
  for (const f of fs.readdirSync(lib).filter((n) => n.endsWith('.mjs'))) {
    const lines = fs.readFileSync(path.join(lib, f), 'utf8').split('\n');
    let name = null;
    let start = 0;
    lines.forEach((line, i) => {
      const m = line.match(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/);
      if (m) { name = m[1]; start = i; }
      if (name && line === '}') {
        const n = i - start + 1;
        const limit = f.startsWith('cmd-') ? 120 : (CEILING[name] ?? 120);
        if (n > limit) over.push(f + ':' + name + ' ' + n + ' 行 > ' + limit);
        name = null;
      }
    });
  }
  assert.deepEqual(over, []);
});

test('结构守卫：cmd-*.mjs 的每个 import 在非注释代码中都被使用（防遮蔽变量漏解构时静默拿到模块对象）', () => {
  const lib = path.join(ROOT, 'lib');
  const unused = [];
  for (const f of fs.readdirSync(lib).filter((n) => /^cmd-[a-z]+\.mjs$/.test(n))) {
    const lines = fs.readFileSync(path.join(lib, f), 'utf8').split('\n');
    const code = lines.filter((l) => !l.startsWith('import ') && !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const l of lines.filter((x) => x.startsWith('import '))) {
      const m = l.match(/^import (?:\{([^}]+)\}|(\w+)) from/);
      const names = m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()) : [m[2]];
      // 默认导入是模块对象（fs/path）：须以 名字. 成员访问出现——同名局部变量（如侧车路径 path）不算使用。
      const used = (n) => new RegExp('(?<![.\\w$])' + n + (m[1] ? '(?![\\w$])' : '\\.')).test(code);
      for (const n of names) if (!used(n)) unused.push(f + ':' + n);
    }
  }
  assert.deepEqual(unused, []);
});

test('结构守卫：本体项目中立——lib/ 与 bin/ 不得出现任何项目名或本机路径（0.37.0）', () => {
  // 负责人 2026-10-08 裁定：本体不得知道项目叫什么；实测项目名只能写在 docs/rulings/RELEASES 或 scripts/ 适配层。
  const banned = /\bn14\b|\bo13\b|\bodoo\b|demo-c|knifeseq|demo-ledger|\/home\/umax/;
  const hits = [];
  for (const dir of ['lib', 'bin']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.mjs'))) {
      fs.readFileSync(path.join(ROOT, dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (banned.test(line)) hits.push(dir + '/' + f + ':' + (i + 1));
      });
    }
  }
  assert.deepEqual(hits, []);
});
