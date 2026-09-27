// trace import / trace order 端到端（真进程 + 临时 atlas + 夹具 git 仓）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
const DATE = '2026-09-01T10:00:00Z';
function run(args) {
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout };
}
function fixture(t, { sourcePath = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-trajcli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 代码仓置于 atlas 根内：锚根白名单按设计拒绝临时目录作锚根（lib/anchor-roots.mjs 禁入来源），atlas 根本身在白名单内。
  const repo = path.join(dir, 'atlas', 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE };
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'src/a.mjs'), 'export const a = 1;\n');
  git('add', '-A'); git('commit', '-q', '-m', 'a');
  fs.writeFileSync(path.join(repo, 'src/b.mjs'), "import { a } from './a.mjs';\nexport const b = a;\n");
  git('add', '-A'); git('commit', '-q', '-m', 'b');
  const state = path.join(dir, 'atlas', 'state');
  fs.mkdirSync(state, { recursive: true });
  const entry = { project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json', ...(sourcePath ? { sourcePath: repo } : {}) };
  fs.writeFileSync(path.join(state, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [entry] }));
  const sidecar = path.join(state, 'atlas-state.json');
  for (const [node, file] of [['demo-a', 'src/a.mjs'], ['demo-b', 'src/b.mjs']]) {
    assert.equal(run(['state', 'set', '--node', node, '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'o', '--class', 'task', '--sidecar', sidecar]).code, 0);
    assert.equal(run(['state', 'evidence-add', '--node', node, '--locator', path.join(repo, file) + ':1', '--sidecar', sidecar]).code, 0);
  }
  return { dir, repo, sidecar, data: path.join(dir, 'atlas', 'data', 'demo', 'trajectory.jsonl') };
}

test('trace order：facts.builtOn 由 git + 证据锚推出；无会话事件 = no-data；侧车字节不变（只读派生）', (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.sidecar);
  const r = run(['trace', 'order', '--sidecar', f.sidecar]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.receipt.data.facts.builtOn.map((x) => [x.from, x.to, x.level]), [['demo-a', 'demo-b', 'M']]);
  assert.deepEqual(r.receipt.data.nominations.readBeforeWrite, { status: 'no-data' });
  assert.deepEqual(fs.readFileSync(f.sidecar), before, 'trace order 不得写侧车');
  assert.deepEqual(r.receipt.data.repos.map((x) => x.repo), ['.']);
  assert.deepEqual(r.receipt.data.order.map((o) => o.firstRepo), ['.', '.']);
});

test('trace import → trace order：会话读后写出 I 级提名；重复导入幂等', (t) => {
  const f = fixture(t);
  const src = path.join(f.dir, 'events.jsonl');
  const ev = (id, tool, reads, writes) => JSON.stringify({ schemaVersion: 1, source: 'fixture', session: 's1', eventId: id, at: '2026-09-02T00:00:0' + id + 'Z', tool, reads, writes });
  fs.writeFileSync(src, [ev('1', 'Read', [path.join(f.repo, 'src/a.mjs')], []), ev('2', 'Edit', [], [path.join(f.repo, 'src/b.mjs')])].join('\n') + '\n');
  const imp = run(['trace', 'import', '--source', src, '--sidecar', f.sidecar]);
  assert.equal(imp.code, 0, imp.stdout);
  assert.equal(imp.receipt.data.appended, 2);
  assert.equal(imp.receipt.data.file, f.data);
  assert.equal(run(['trace', 'import', '--source', src, '--sidecar', f.sidecar]).receipt.data.duplicates, 2);
  const ord = run(['trace', 'order', '--sidecar', f.sidecar]);
  assert.deepEqual(ord.receipt.data.nominations.readBeforeWrite, [{ from: 'demo-a', to: 'demo-b', weight: 1, level: 'I' }]);
  assert.equal(ord.receipt.data.sessionEvents, 2);
});

test('trace order --brief / --node / --since：形状与过滤；非法 since = bad_args；未知节点 = node_not_found', (t) => {
  const f = fixture(t);
  const brief = run(['trace', 'order', '--brief', '--sidecar', f.sidecar]);
  assert.equal(brief.receipt.data.facts.builtOn.count, 1);
  const focus = run(['trace', 'order', '--node', 'demo-a', '--sidecar', f.sidecar]);
  assert.deepEqual(focus.receipt.data.order.map((o) => o.node), ['demo-a']);
  const late = run(['trace', 'order', '--since', '2030-01-01T00:00:00Z', '--sidecar', f.sidecar]);
  assert.equal(late.receipt.data.commits, 0);
  assert.equal(run(['trace', 'order', '--since', 'yesterday', '--sidecar', f.sidecar]).receipt.diagnostics[0].rule, 'bad_args');
  assert.equal(run(['trace', 'order', '--node', 'nope', '--sidecar', f.sidecar]).receipt.diagnostics[0].rule, 'node_not_found');
});

test('红路：缺 --source = bad_args；源不可读 / 坏事件 / 无 sourcePath / 非 git / 已落盘文件被改坏 → 各自错误码 exit 1', (t) => {
  const f = fixture(t);
  const rule = (args) => { const r = run(args); assert.equal(r.code, 1, r.stdout); return r.receipt.diagnostics[0].rule; };
  assert.equal(rule(['trace', 'import', '--sidecar', f.sidecar]), 'bad_args');
  assert.equal(rule(['trace', 'import', '--source', path.join(f.dir, 'nope.jsonl'), '--sidecar', f.sidecar]), 'trajectory_source_unreadable');
  const bad = path.join(f.dir, 'bad.jsonl');
  fs.writeFileSync(bad, '{"schemaVersion":1}\n');
  assert.equal(rule(['trace', 'import', '--source', bad, '--sidecar', f.sidecar]), 'trajectory_bad_event');
  fs.mkdirSync(path.dirname(f.data), { recursive: true });
  fs.writeFileSync(f.data, 'broken\n');
  assert.equal(rule(['trace', 'order', '--sidecar', f.sidecar]), 'trajectory_bad_event');
  fs.rmSync(f.data);
  const reg = path.join(path.dirname(f.sidecar), 'projects.json');
  const empty = path.join(f.dir, 'empty-ws');
  fs.mkdirSync(empty);
  fs.writeFileSync(reg, JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json', sourcePath: empty }] }));
  assert.equal(rule(['trace', 'order', '--sidecar', f.sidecar]), 'project_source_not_git');
  fs.writeFileSync(reg, JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json', sourcePath: f.dir }] }));
  const wsRun = run(['trace', 'order', '--sidecar', f.sidecar]);
  assert.equal(wsRun.code, 0, '非 git 工作区根 + 嵌套仓 = 合法（0.27.0）');
  assert.deepEqual(wsRun.receipt.data.repos.map((r) => r.repo), ['atlas/repo']);
  fs.writeFileSync(reg, JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json' }] }));
  assert.equal(rule(['trace', 'order', '--sidecar', f.sidecar]), 'project_source_missing');
});

test('红路：自由侧车（非 atlas 版式）trace order = trajectory_no_atlas', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-trajfree-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sidecar = path.join(dir, 'free.json');
  assert.equal(run(['state', 'set', '--node', 'n', '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'o', '--class', 'task', '--sidecar', sidecar]).code, 0);
  const r = run(['trace', 'order', '--sidecar', sidecar]);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.diagnostics[0].rule, 'trajectory_no_atlas');
});

test('I1（CLI 级）：trace order --since 不把同提交创建的 import 错判为 dependsOnNewer', (t) => {
  const f = fixture(t);
  const env = (d) => ({ ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
  const commitAt = (d, rel, body) => {
    fs.writeFileSync(path.join(f.repo, rel), body);
    execFileSync('git', ['-C', f.repo, 'add', '-A'], { env: env(d) });
    execFileSync('git', ['-C', f.repo, 'commit', '-q', '-m', rel], { env: env(d) });
  };
  // 夹具已有：a（首提交）与 b import a（第二提交），均在 2026-09-01。之后先改 b、再改 a。
  commitAt('2026-09-10T00:00:00Z', 'src/b.mjs', "import { a } from './a.mjs';\nexport const b = a + 1;\n");
  commitAt('2026-09-11T00:00:00Z', 'src/a.mjs', 'export const a = 2;\n');
  const r = run(['trace', 'order', '--since', '2026-09-05T00:00:00Z', '--sidecar', f.sidecar]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.receipt.data.facts.dependsOnNewer, [], '窗口内先改 b 后改 a 不代表 a 晚于 b 出现');
  assert.deepEqual(r.receipt.data.facts.builtOn.map((x) => [x.from, x.to]), [['demo-a', 'demo-b']]);
});

// —— 0.29.1：回执顶层字段预算（契约为唯一来源）——
// 契约 §8「order → { … }」的顶层字段表 = 实测回执顶层字段；字段数 ≤ 契约治理节写明的预算。
// 防回执字段被动膨胀：命令 / 旗标有预算、回执字段没有，0.24.0→0.29.0 顶层由 10 涨到 18。
const CONTRACT = new URL('../specs/command-contract.md', import.meta.url).pathname;
function contractReceiptFields(text) {
  const start = text.indexOf('order → {');
  assert.ok(start >= 0, '契约 §8 缺「order → { … }」回执字段表');
  const open = { '{': '}', '[': ']', '（': '）' };
  const stack = [];
  let body = '';
  for (const ch of text.slice(start + 'order → '.length)) {
    if (open[ch]) stack.push(open[ch]);
    else if (ch === stack[stack.length - 1]) { stack.pop(); if (stack.length === 0) break; }
    if (stack.length === 1 && ch !== '{') body += ch;
    else if (stack.length > 1) body += ' ';
  }
  return body.split(',').map((s) => (s.trim().match(/^[A-Za-z]+/) || [''])[0]).filter(Boolean);
}

test('0.29.1 回执字段预算：实测顶层字段 = 契约 §8 字段表；字段数 ≤ 契约治理节预算', (t) => {
  const text = fs.readFileSync(CONTRACT, 'utf8');
  const fields = contractReceiptFields(text);
  const budget = Number((text.match(/trace order 回执顶层字段 ≤(\d+)/) || [])[1]);
  assert.ok(budget > 0, '契约治理节须写明「trace order 回执顶层字段 ≤N」');
  assert.ok(fields.length <= budget, `契约字段表 ${fields.length} 个 > 预算 ${budget}`);
  const f = fixture(t);
  const full = run(['trace', 'order', '--sidecar', f.sidecar]);
  const brief = run(['trace', 'order', '--brief', '--sidecar', f.sidecar]);
  assert.deepEqual(Object.keys(full.receipt.data).sort(), [...fields].sort());
  assert.deepEqual(Object.keys(brief.receipt.data).sort(), [...fields].sort());
});
