// 多仓工作区回溯（lib/trajectory-workspace.mjs）：顶层仓 + 嵌套仓（其一先在顶层后拆出），非 git 工作区根，读失败点名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitCommits, real } from '../lib/trajectory.mjs';
import { discoverRepos, computeWorkspaceOrder, groupUnowned, briefOrder } from '../lib/trajectory-workspace.mjs';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return real(dir);
}
const env = (d) => ({ ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
const git = (repo, d, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: env(d) });
function commitAt(repo, d, files, msg, extra = []) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  for (const a of extra) git(repo, d, ...a);
  git(repo, d, 'add', '-A');
  git(repo, d, 'commit', '-q', '-m', msg);
}
const sidecarOf = (root, map) => ({ nodes: Object.fromEntries(Object.entries(map).map(([id, files]) => [id, { progress: 'in_progress', evidence: files.map((f) => path.join(root, f) + ':1') }])) });
const withCommits = (repos) => repos.map((r) => ({ ...r, commits: gitCommits(r.root, null) }));

// 顶层仓 ws（git）：core.mjs 与 opc/o.mjs 早期在顶层跟踪，T3 拆出（git rm --cached + gitignore）；svc 为独立嵌套仓。
function workspace(t) {
  const ws = path.join(tmp(t), 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-01-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-01-01T00:00:00Z', { '.gitignore': 'svc/\n', 'core.mjs': "import { s } from './svc/s.mjs';\nexport const c = s;\n", 'opc/o.mjs': 'export const o = 1;\n' }, 'T1');
  commitAt(ws, '2026-01-02T00:00:00Z', { 'opc/o.mjs': 'export const o = 2;\n' }, 'T2');
  fs.writeFileSync(path.join(ws, '.gitignore'), 'svc/\nopc/\n');
  git(ws, '2026-01-03T00:00:00Z', 'rm', '-r', '-q', '--cached', 'opc');
  commitAt(ws, '2026-01-03T00:00:00Z', {}, 'T3 split opc');
  const opc = path.join(ws, 'opc');
  git(opc, '2026-01-04T00:00:00Z', 'init', '-q');
  commitAt(opc, '2026-01-04T00:00:00Z', { 'o.mjs': 'export const o = 3;\n' }, 'N1');
  const svc = path.join(ws, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-01-02T12:00:00Z', 'init', '-q');
  commitAt(svc, '2026-01-02T12:00:00Z', { 's.mjs': 'export const s = 1;\n' }, 'S1');
  commitAt(svc, '2026-01-05T00:00:00Z', { 's2.mjs': "import { s } from './s.mjs';\nexport const s2 = s;\n" }, 'S2');
  const sidecar = sidecarOf(ws, { CORE: ['core.mjs'], OPC: ['opc/o.mjs'], SVC: ['svc/s.mjs'], SVC2: ['svc/s2.mjs'] });
  return { ws, sidecar };
}

test('discoverRepos：由证据锚推出 sourcePath 内的仓（顶层 + 嵌套），. 在前', (t) => {
  const { ws, sidecar } = workspace(t);
  assert.deepEqual(discoverRepos(ws, sidecar).map((r) => r.repo), ['.', 'opc', 'svc']);
});

test('多仓合并：跨仓按时间归并、仓内序不乱；跨多仓节点首现/最后活动取最早/最晚；关系只在仓内', (t) => {
  const { ws, sidecar } = workspace(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d.repos.map((r) => [r.repo, r.totalCommits]), [['.', 3], ['opc', 1], ['svc', 2]]);
  assert.equal(d.totalCommits, 6);
  assert.deepEqual(d.order.map((o) => [o.node, o.firstRepo]), [['CORE', '.'], ['OPC', '.'], ['SVC', 'svc'], ['SVC2', 'svc']]);
  const opc = d.recency.find((r) => r.node === 'OPC');
  assert.deepEqual([opc.firstRepo, opc.lastRepo, opc.touches, opc.commitsSince], ['.', 'opc', 4, 0]);
  assert.deepEqual(opc.repos.map((p) => [p.repo, p.firstSeq, p.lastSeq, p.touches]), [['.', 1, 3, 3], ['opc', 1, 1, 1]]);
  assert.deepEqual(d.recency.map((r) => [r.node, r.commitsSince]), [['SVC2', 0], ['OPC', 0], ['SVC', 1], ['CORE', 2]]);
  assert.deepEqual(d.facts.builtOn.map((r) => [r.from, r.to, r.repo]), [['SVC', 'SVC2', 'svc']], 'core.mjs → svc/s.mjs 跨仓 import 不出');
  assert.equal(d.blindSpots.nodes.count, 0);
  assert.deepEqual(d.blindSpots.files, { count: 1, groups: [{ repo: '.', dir: '.', count: 1, sample: ['.gitignore'] }] });
});

test('多仓归并：跨仓交错按实际时刻，同刻保留仓序而非按路径整仓拼接', (t) => {
  const root = tmp(t);
  const map = {};
  for (const [name, steps] of [
    ['alpha', [['A1', '2026-04-01T10:00:00Z'], ['A2', '2026-04-01T10:30:00Z'], ['A3', '2026-04-01T12:00:00Z']]],
    ['beta', [['B1', '2026-04-01T17:00:00+08:00'], ['B2', '2026-04-01T18:00:00+08:00'], ['B3', '2026-04-01T19:00:00+08:00']]],
  ]) {
    const repo = path.join(root, name);
    fs.mkdirSync(repo);
    git(repo, steps[0][1], 'init', '-q');
    for (const [id, at] of steps) {
      commitAt(repo, at, { [id + '.mjs']: 'export const value = 1;\n' }, id);
      map[id] = [name + '/' + id + '.mjs'];
    }
  }
  const sidecar = sidecarOf(root, map);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: root, repos: withCommits(discoverRepos(root, sidecar)), events: [] });
  assert.deepEqual(d.order.map((o) => o.node), ['B1', 'A1', 'B2', 'A2', 'B3', 'A3']);
});

test('多仓归并：仓内提交时钟回拨仍保留提交序，不作全局时间排序', (t) => {
  const root = tmp(t);
  const map = {};
  for (const [name, steps] of [
    ['alpha', [['A1', '2026-04-01T11:00:00Z'], ['A2', '2026-04-01T09:00:00Z']]],
    ['beta', [['B1', '2026-04-01T10:00:00Z']]],
  ]) {
    const repo = path.join(root, name);
    fs.mkdirSync(repo);
    git(repo, steps[0][1], 'init', '-q');
    for (const [id, at] of steps) {
      commitAt(repo, at, { [id + '.mjs']: 'export const value = 1;\n' }, id);
      map[id] = [name + '/' + id + '.mjs'];
    }
  }
  const sidecar = sidecarOf(root, map);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: root, repos: withCommits(discoverRepos(root, sidecar)), events: [] });
  assert.deepEqual(d.order.map((o) => o.node), ['B1', 'A1', 'A2']);
});

test('非 git 工作区根：只有嵌套仓也合法；unowned 路径相对 sourcePath', (t) => {
  const root = tmp(t);
  const svc = path.join(root, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-02-01T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-02-01T00:00:00Z', { 'a.mjs': 'a\n', 'docs/n.md': 'n\n' }, 'A');
  const sidecar = sidecarOf(root, { A: ['svc/a.mjs'] });
  const repos = discoverRepos(root, sidecar);
  assert.deepEqual(repos.map((r) => r.repo), ['svc']);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: root, repos: withCommits(repos), events: [] });
  assert.deepEqual(d.order.map((o) => [o.node, o.firstRepo]), [['A', 'svc']]);
  assert.deepEqual(d.blindSpots.files.groups, [{ repo: 'svc', dir: 'docs', count: 1, sample: ['svc/docs/n.md'] }]);
});

test('已删除文件的锚仍归到其所在仓；无参与仓 = project_source_not_git；坏仓 git 失败点名', (t) => {
  const root = tmp(t);
  const svc = path.join(root, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-02-01T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-02-01T00:00:00Z', { 'gone/x.mjs': 'x\n' }, 'x');
  commitAt(svc, '2026-02-02T00:00:00Z', {}, 'rm', [['rm', '-r', '-q', 'gone']]);
  assert.deepEqual(discoverRepos(root, sidecarOf(root, { G: ['svc/gone/x.mjs'] })).map((r) => r.repo), ['svc']);
  assert.throws(() => computeWorkspaceOrder({ sidecar: { nodes: {} }, sourceRoot: root, repos: [], events: [] }), (e) => e.code === 'project_source_not_git');
  const bad = path.join(root, 'bad');
  fs.mkdirSync(path.join(bad, '.git'), { recursive: true });
  fs.writeFileSync(path.join(bad, 'y.mjs'), 'y\n');
  const repos = discoverRepos(root, sidecarOf(root, { Y: ['bad/y.mjs'] }));
  assert.deepEqual(repos.map((r) => r.repo), ['bad']);
  assert.throws(() => gitCommits(repos[0].root, null), (e) => e.code === 'project_source_not_git' && e.message.includes(bad));
});

test('--node 聚焦：只留该节点；unowned / unownedByRepo 以 omitted 披露', (t) => {
  const { ws, sidecar } = workspace(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [], focusNode: 'OPC' });
  assert.deepEqual(d.order.map((o) => o.node), ['OPC']);
  assert.deepEqual(d.recency.map((o) => o.node), ['OPC']);
  assert.deepEqual(d.blindSpots.files, { omitted: 'focus', count: 1 });
});

// —— 整分支审阅修复（0.27.0）——
test('I1：空嵌套仓（已 init、尚无提交）按 0 提交处理，不让整条命令失败；其节点归 neverCommitted', (t) => {
  const root = tmp(t);
  const svc = path.join(root, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-03-01T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-03-01T00:00:00Z', { 'a.mjs': 'a\n' }, 'A');
  const fresh = path.join(root, 'fresh');
  fs.mkdirSync(fresh);
  git(fresh, '2026-03-01T00:00:00Z', 'init', '-q');
  fs.writeFileSync(path.join(fresh, 'n.mjs'), 'n\n');
  assert.deepEqual(gitCommits(fresh, null), [], '空仓 = 0 提交，不是读取失败');
  const sidecar = sidecarOf(root, { A: ['svc/a.mjs'], N: ['fresh/n.mjs'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: root, repos: withCommits(discoverRepos(root, sidecar)), events: [] });
  assert.deepEqual(d.repos.map((r) => [r.repo, r.totalCommits]), [['fresh', 0], ['svc', 1]]);
  assert.deepEqual(d.order.map((o) => o.node), ['A']);
  assert.deepEqual(d.blindSpots.nodes.neverCommitted, ['N']);
});

test('I2：非 git 工作区根下的散放锚文件不属于任何参与仓 → outsideRepo，不得报 neverCommitted', (t) => {
  const root = tmp(t);
  const svc = path.join(root, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-03-01T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-03-01T00:00:00Z', { 'a.mjs': 'a\n' }, 'A');
  fs.writeFileSync(path.join(root, 'loose.md'), 'l\n');
  const sidecar = sidecarOf(root, { A: ['svc/a.mjs'], L: ['loose.md'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: root, repos: withCommits(discoverRepos(root, sidecar)), events: [] });
  assert.deepEqual([d.blindSpots.nodes.outsideRepo, d.blindSpots.nodes.neverCommitted], [['L'], []]);
});

test('M1：合并 span 按时刻比较，不按 ISO 字符串（时区偏移混排）', (t) => {
  const root = tmp(t);
  for (const [name, d1, d2] of [['east', '2026-03-01T10:00:00+08:00', '2026-03-01T12:00:00+08:00'], ['utc', '2026-03-01T03:00:00Z', '2026-03-01T05:00:00Z']]) {
    const r = path.join(root, name);
    fs.mkdirSync(r);
    git(r, d1, 'init', '-q');
    commitAt(r, d1, { 'a.mjs': 'a\n' }, '1');
    commitAt(r, d2, { 'a.mjs': 'b\n' }, '2');
  }
  const sidecar = sidecarOf(root, { E: ['east/a.mjs'], U: ['utc/a.mjs'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: root, repos: withCommits(discoverRepos(root, sidecar)), events: [] });
  assert.equal(Date.parse(d.span[0]), Date.parse('2026-03-01T02:00:00Z'), 'east 10:00+08:00 = 02:00Z 早于 utc 03:00Z');
  assert.equal(Date.parse(d.span[1]), Date.parse('2026-03-01T05:00:00Z'));
});

test('M4：无参与仓的报错说明「不是仓根」并提示登记仓根（sourcePath 位于某仓子目录的情形）', (t) => {
  const root = tmp(t);
  assert.throws(() => computeWorkspaceOrder({ sidecar: { nodes: {} }, sourceRoot: root, repos: [], events: [] }), (e) => e.code === 'project_source_not_git' && /仓根/.test(e.message));
});

// —— 0.27.1 ——
test('unowned 口径一致：聚焦时 count = 不聚焦时去重后的 unowned 条数（同一路径在顶层旧史与嵌套仓都出现只计一次）', (t) => {
  const ws = path.join(tmp(t), 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-04-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-04-01T00:00:00Z', { 'core.mjs': 'c\n', 'shared/readme.md': 'r1\n', 'shared/s.mjs': 's\n' }, 'T1');
  fs.writeFileSync(path.join(ws, '.gitignore'), 'shared/\n');
  git(ws, '2026-04-02T00:00:00Z', 'rm', '-r', '-q', '--cached', 'shared');
  commitAt(ws, '2026-04-02T00:00:00Z', {}, 'split');
  const shared = path.join(ws, 'shared');
  git(shared, '2026-04-03T00:00:00Z', 'init', '-q');
  commitAt(shared, '2026-04-03T00:00:00Z', { 'readme.md': 'r2\n' }, 'N1');
  const sidecar = sidecarOf(ws, { CORE: ['core.mjs'], S: ['shared/s.mjs'] });
  const repos = withCommits(discoverRepos(ws, sidecar));
  const all = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(all.blindSpots.files.groups.filter((g) => g.sample.includes('shared/readme.md')).map((g) => [g.repo, g.count]), [['shared', 1]]);
  assert.equal(all.blindSpots.files.count, all.blindSpots.files.groups.reduce((s, g) => s + g.count, 0));
  const focus = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'CORE' });
  assert.deepEqual(focus.blindSpots.files, { omitted: 'focus', count: all.blindSpots.files.count });
  assert.deepEqual(focus.order.map((o) => o.node), ['CORE']);
});

// —— 0.28.0 ——
test('groupUnowned：仓内前两层目录聚合；仓根 = .；样本 ≤3 字典序；count 降序；仓名按 / 边界归属、去重', () => {
  const files = ['svc2/x.mjs', 'svc/pkg/a/deep/1.ts', 'svc/pkg/a/2.ts', 'svc/pkg/a/3.ts', 'svc/pkg/a/0.ts', 'svc/pkg/a/0.ts', 'README.md', 'src/m.mjs'];
  assert.deepEqual(groupUnowned(files, ['.', 'svc', 'svc2']), [
    { repo: 'svc', dir: 'pkg/a', count: 4, sample: ['svc/pkg/a/0.ts', 'svc/pkg/a/2.ts', 'svc/pkg/a/3.ts'] },
    { repo: '.', dir: '.', count: 1, sample: ['README.md'] },
    { repo: '.', dir: 'src', count: 1, sample: ['src/m.mjs'] },
    { repo: 'svc2', dir: '.', count: 1, sample: ['svc2/x.mjs'] },
  ]);
  assert.deepEqual(groupUnowned([], ['.']), []);
});

test('0.28.0 回执：跨仓同一路径归嵌套仓且只计一次；组 count 之和 = 聚焦 count；brief 为组数 + 前 10 组', (t) => {
  const ws = path.join(tmp(t), 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-04-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-04-01T00:00:00Z', { 'core.mjs': 'c\n', 'shared/readme.md': 'r1\n', 'shared/s.mjs': 's\n' }, 'T1');
  fs.writeFileSync(path.join(ws, '.gitignore'), 'shared/\n');
  git(ws, '2026-04-02T00:00:00Z', 'rm', '-r', '-q', '--cached', 'shared');
  commitAt(ws, '2026-04-02T00:00:00Z', {}, 'split');
  const shared = path.join(ws, 'shared');
  git(shared, '2026-04-03T00:00:00Z', 'init', '-q');
  commitAt(shared, '2026-04-03T00:00:00Z', { 'readme.md': 'r2\n' }, 'N1');
  const sidecar = sidecarOf(ws, { CORE: ['core.mjs'], S: ['shared/s.mjs'] });
  const repos = withCommits(discoverRepos(ws, sidecar));
  const all = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(all.blindSpots.files.groups, [
    { repo: '.', dir: '.', count: 1, sample: ['.gitignore'] },
    { repo: 'shared', dir: '.', count: 1, sample: ['shared/readme.md'] },
  ]);
  const focus = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'CORE' });
  assert.equal(focus.blindSpots.files.count, all.blindSpots.files.count);
  assert.deepEqual(briefOrder(all).blindSpots.files.groups, { count: 2, top: all.blindSpots.files.groups });
});

test('0.28.0 单仓（sourcePath 即仓根）：unowned 同样按两层目录分组；0.30.0 起无 unownedByRepo', (t) => {
  const ws = path.join(tmp(t), 'one');
  fs.mkdirSync(ws);
  git(ws, '2026-05-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-05-01T00:00:00Z', { 'a.mjs': 'a\n', 'x.md': 'x\n', 'p/t.md': 't\n', 'p/q/r/s.md': 's\n' }, 'A');
  const sidecar = sidecarOf(ws, { A: ['a.mjs'] });
  const repos = withCommits(discoverRepos(ws, sidecar));
  assert.deepEqual(repos.map((r) => r.repo), ['.']);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(d.blindSpots.files.groups, [
    { repo: '.', dir: '.', count: 1, sample: ['x.md'] },
    { repo: '.', dir: 'p', count: 1, sample: ['p/t.md'] },
    { repo: '.', dir: 'p/q', count: 1, sample: ['p/q/r/s.md'] },
  ]);
});

// —— 0.29.0 ——
test('0.29.0 单仓：monorepo 包名边入 builtOn；importsUnresolved 为 { count, top }', (t) => {
  const ws = path.join(tmp(t), 'mono');
  fs.mkdirSync(ws);
  git(ws, '2026-06-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-06-01T00:00:00Z', { 'packages/core/package.json': JSON.stringify({ name: '@s/core', main: 'dist/index.js' }), 'packages/core/src/index.ts': 'export const c = 1;\n' }, 'core');
  commitAt(ws, '2026-06-02T00:00:00Z', { 'apps/web/app.ts': "import { c } from '@s/core';\nimport { g } from './gone';\n" }, 'app');
  const sidecar = sidecarOf(ws, { CORE: ['packages/core/src/index.ts'], APP: ['apps/web/app.ts'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d.facts.builtOn.map((r) => [r.from, r.to, r.via]), [['CORE', 'APP', ['apps/web/app.ts → packages/core/src/index.ts']]]);
  assert.deepEqual(d.blindSpots.imports.unresolved, { count: 1, top: [{ file: 'apps/web/app.ts', spec: './gone' }] });
});

test('0.29.0 多仓：三项披露跨仓合并（路径相对 sourcePath）；顶层仓相对引用嵌套仓文件既不出边也不计 unresolved', (t) => {
  const { ws, sidecar } = workspace(t);
  const d0 = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d0.blindSpots.imports.unresolved, { count: 0, top: [] }, 'core.mjs → ./svc/s.mjs 是跨仓引用，不是解析失败');

  const root = tmp(t);
  git(root, '2026-07-01T00:00:00Z', 'init', '-q');
  commitAt(root, '2026-07-01T00:00:00Z', { '.gitignore': 'svc/\n', 'a.mjs': "import { n } from './nope';\n", 'q.sql': 'select 1;\n' }, 'top');
  const svc = path.join(root, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-07-02T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-07-02T00:00:00Z', { 's.mjs': "import { g } from './gone';\n", 'doc.md': '# d\n', 'x.py': 'import os\n' }, 'svc');
  const sc = sidecarOf(root, { A: ['a.mjs'], Q: ['q.sql'], S: ['svc/s.mjs'], D: ['svc/doc.md'], P: ['svc/x.py'] });
  const d = computeWorkspaceOrder({ sidecar: sc, sourceRoot: root, repos: withCommits(discoverRepos(root, sc)), events: [] });
  assert.deepEqual(d.blindSpots.imports.unresolved, { count: 2, top: [{ file: 'a.mjs', spec: './nope' }, { file: 'svc/s.mjs', spec: './gone' }] });
  assert.deepEqual(d.blindSpots.imports.notApplicable, ['.md', '.sql']);
  assert.deepEqual(d.blindSpots.imports.unparsed, ['.py']);
});

// —— 0.29.1 ——
test('0.29.1 多仓与单仓回执顶层字段集合一致（字段预算只由 CLI 测试对照契约断言一处）', (t) => {
  const { ws, sidecar } = workspace(t);
  const multi = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  const one = path.join(tmp(t), 'one');
  fs.mkdirSync(one);
  git(one, '2026-08-01T00:00:00Z', 'init', '-q');
  commitAt(one, '2026-08-01T00:00:00Z', { 'a.mjs': 'a\n' }, 'A');
  const sc = sidecarOf(one, { A: ['a.mjs'] });
  const single = computeWorkspaceOrder({ sidecar: sc, sourceRoot: one, repos: withCommits(discoverRepos(one, sc)), events: [] });
  const none = computeWorkspaceOrder({ sidecar: { nodes: {} }, sourceRoot: one, repos: withCommits(discoverRepos(one, sc)), events: [] });
  assert.deepEqual(Object.keys(multi).sort(), Object.keys(single).sort());
  assert.deepEqual(Object.keys(none).sort(), Object.keys(single).sort(), '无锚定节点的空态回执同形');
});

// —— 0.30.0 blindSpots ——
function blindFixture(t) {
  const base = tmp(t);
  const ws = path.join(base, 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-09-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-09-01T00:00:00Z', { 'a.mjs': "import { g } from './gone.mjs';\n", 'x.py': 'import os\n', 'q.sql': 'select 1;\n', 'docs/x.md': '# x\n', 'lib/y/z.txt': 'z\n' }, 'A');
  fs.writeFileSync(path.join(ws, 'wip.mjs'), 'w\n');
  fs.writeFileSync(path.join(base, 'o.mjs'), 'o\n');
  const sidecar = sidecarOf(ws, { A: ['a.mjs'], P: ['x.py'], Q: ['q.sql'], L: ['wip.mjs'] });
  sidecar.nodes.O = { evidence: [path.join(base, 'o.mjs') + ':1'] };
  sidecar.nodes.R = { evidence: ['rel/r.mjs:1'] };
  const repos = withCommits(discoverRepos(ws, sidecar));
  return { ws, sidecar, repos };
}

test('0.30.0 blindSpots：四类形状与计数；旧的 8 个顶层盲区字段不再出现', (t) => {
  const { ws, sidecar, repos } = blindFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(d.blindSpots, {
    anchors: { relative: 1, nonFile: 0, nodes: ['R'], shared: { files: 0, nodes: 0, top: [] } },
    nodes: { count: 2, outsideRepo: ['O'], nestedRepo: [], neverCommitted: ['L'], mixed: [], nestedRepos: [] },
    files: { count: 2, groups: [
      { repo: '.', dir: 'docs', count: 1, sample: ['docs/x.md'] },
      { repo: '.', dir: 'lib/y', count: 1, sample: ['lib/y/z.txt'] },
    ] },
    imports: { unparsed: ['.py'], notApplicable: ['.sql'], unresolved: { count: 1, top: [{ file: 'a.mjs', spec: './gone.mjs' }] } },
  });
  for (const old of ['anchorsSkipped', 'notSeen', 'notSeenReasons', 'unowned', 'unownedByRepo', 'importsUnparsed', 'importsNotApplicable', 'importsUnresolved']) {
    assert.equal(old in d, false, '旧顶层字段仍在：' + old);
  }
});

test('0.30.0 blindSpots 聚焦：nodes 收窄、files 只给 count、anchors 与 imports 全局；聚焦到只有相对锚的节点不崩', (t) => {
  const { ws, sidecar, repos } = blindFixture(t);
  const all = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  const f = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'L' });
  assert.deepEqual(f.blindSpots.nodes, { count: 1, outsideRepo: [], nestedRepo: [], neverCommitted: ['L'], mixed: [], nestedRepos: [] });
  assert.deepEqual(f.blindSpots.files, { omitted: 'focus', count: all.blindSpots.files.count });
  assert.deepEqual(f.blindSpots.anchors, all.blindSpots.anchors);
  assert.deepEqual(f.blindSpots.imports, all.blindSpots.imports);
  const r = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'R' });
  assert.equal(r.blindSpots.nodes.count, 0);
});

test('0.30.0 brief：nodes 各桶与 files.groups 为 { count, top }；anchors / imports 原样；空态 status 原样', (t) => {
  const { ws, sidecar, repos } = blindFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  const b = briefOrder(d).blindSpots;
  assert.deepEqual(b.nodes.outsideRepo, { count: 1, top: ['O'] });
  assert.equal(b.nodes.count, 2);
  assert.deepEqual(b.files, { count: 2, groups: { count: 2, top: d.blindSpots.files.groups } });
  assert.deepEqual(b.anchors, d.blindSpots.anchors);
  assert.deepEqual(b.imports, d.blindSpots.imports);
  const none = computeWorkspaceOrder({ sidecar: { nodes: {} }, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(none.blindSpots.nodes, { status: 'no-anchored-nodes' });
  assert.equal(none.blindSpots.files.count, 5);
  // 无锚定文件可解析：imports 不是「全部解析成功」而是「无对象」（DEFENSIVE §9），与 nodes 同为 status。
  assert.deepEqual(none.blindSpots.imports, { status: 'no-anchored-nodes' });
  assert.deepEqual(briefOrder(none).blindSpots.nodes, { status: 'no-anchored-nodes' });
});

// —— 整分支审阅修复（0.30.0）——
test('契约口径钉住：全史下「目标无锚的 import」其目标必在 blindSpots.files；--since 时 files 只含窗口内改动（不在其中）', (t) => {
  const ws = path.join(tmp(t), 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-01-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-01-01T00:00:00Z', { 'u.mjs': 'export const u = 1;\n' }, 'u');
  commitAt(ws, '2026-06-01T00:00:00Z', { 'a.mjs': "import { u } from './u.mjs';\n" }, 'a');
  const sidecar = sidecarOf(ws, { A: ['a.mjs'] });
  const repos = withCommits(discoverRepos(ws, sidecar));
  const all = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.ok(all.blindSpots.files.groups.some((g) => g.sample.includes('u.mjs')));
  const win = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], sinceIso: '2026-03-01T00:00:00Z' });
  assert.equal(win.blindSpots.files.count, 0);
});

// —— 0.31.0 共享锚口径并报 ——
// 夹具：A 认领 a.mjs（独占）+ u.mjs、s.md（共享）；B 认领 b.mjs（独占）+ s.md；C 只认领 u.mjs、s.md（无独占锚）。
// b.mjs import ./a.mjs（独占→独占）与 ./u.mjs（独占→共享）。s.md 在 01-02/03/04/07 单独被改；a、b 在 01-05/06 一起被改。
function sharedFixture(t) {
  const ws = path.join(tmp(t), 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-01-01T00:00:00Z', 'init', '-q');
  const b = (v) => "import { a } from './a.mjs';\nimport { u } from './u.mjs';\nexport const b = " + v + ';\n';
  commitAt(ws, '2026-01-01T00:00:00Z', { 'a.mjs': 'export const a = 1;\n', 'b.mjs': b(1), 'u.mjs': 'export const u = 1;\n', 's.md': 's1\n' }, 'T1');
  for (const [d, v] of [['2026-01-02', 2], ['2026-01-03', 3], ['2026-01-04', 4]]) commitAt(ws, d + 'T00:00:00Z', { 's.md': 's' + v + '\n' }, 's' + v);
  commitAt(ws, '2026-01-05T00:00:00Z', { 'a.mjs': 'export const a = 2;\n', 'b.mjs': b(2) }, 'ab5');
  commitAt(ws, '2026-01-06T00:00:00Z', { 'a.mjs': 'export const a = 3;\n', 'b.mjs': b(3) }, 'ab6');
  commitAt(ws, '2026-01-07T00:00:00Z', { 's.md': 's5\n' }, 's5');
  const sidecar = sidecarOf(ws, { A: ['a.mjs', 'u.mjs', 's.md'], B: ['b.mjs', 's.md'], C: ['u.mjs', 's.md'] });
  return { ws, sidecar, repos: withCommits(discoverRepos(ws, sidecar)) };
}
const day = (s) => (s === null ? null : new Date(Date.parse(s)).toISOString().slice(0, 10));

test('0.31.0 coChange.specificCommits：只经共享锚同改的对为 0；commits 不变', (t) => {
  const { ws, sidecar, repos } = sharedFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(d.facts.coChange.map((r) => [r.a, r.b, r.commits, r.specificCommits]), [['A', 'B', 7, 3], ['A', 'C', 5, 0], ['B', 'C', 5, 0]]);
});

test('0.31.0 import 关系 edges / specificEdges：经共享锚文件的边不计入 specificEdges', (t) => {
  const { ws, sidecar, repos } = sharedFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(d.facts.importSameCommit.map((r) => [r.from, r.to, r.edges, r.specificEdges]), [['A', 'B', 2, 1], ['C', 'B', 1, 0]]);
});

test('0.31.0 order / recency：独占锚时刻只看独占锚；共享文件的修改不推进 lastSpecificAt；specificAnchors', (t) => {
  const { ws, sidecar, repos } = sharedFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  const rec = Object.fromEntries(d.recency.map((r) => [r.node, [day(r.firstSpecificAt), day(r.lastSpecificAt), day(r.lastAt), r.specificAnchors]]));
  assert.deepEqual(rec, {
    A: ['2026-01-01', '2026-01-06', '2026-01-07', 1],
    B: ['2026-01-01', '2026-01-06', '2026-01-07', 1],
    C: [null, null, '2026-01-07', 0],
  });
  assert.deepEqual(d.order.map((o) => [o.node, day(o.firstSpecificAt), day(o.lastSpecificAt)]), [['A', '2026-01-01', '2026-01-06'], ['B', '2026-01-01', '2026-01-06'], ['C', null, null]]);
});

test('0.31.0 --since：specificCommits 与 commits 同窗口；firstSpecificAt 仍按全史', (t) => {
  const { ws, sidecar, repos } = sharedFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], sinceIso: '2026-01-05T00:00:00Z' });
  assert.deepEqual(d.facts.coChange.map((r) => [r.a, r.b, r.commits, r.specificCommits]), [['A', 'B', 3, 2]]);
  assert.equal(day(d.recency.find((r) => r.node === 'A').firstSpecificAt), '2026-01-01');
});

test('0.31.0 Go 目录目标：A 在目标目录有独占锚才计 specificEdges', (t) => {
  const ws = path.join(tmp(t), 'go');
  fs.mkdirSync(ws);
  git(ws, '2026-02-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-02-01T00:00:00Z', {
    'go.mod': 'module example.com/app\n',
    'internal/db/db.go': 'package db\n', 'internal/db/pool.go': 'package db\n',
    'internal/cfg/cfg.go': 'package cfg\n',
    'cmd/main.go': 'package main\n\nimport (\n\t"example.com/app/internal/db"\n\t"example.com/app/internal/cfg"\n)\n',
  }, 'T1');
  // DB 在 internal/db 有独占锚 db.go；CFG 与 DB2 共享 cfg.go（internal/cfg 里没有任何独占锚）。
  const sidecar = sidecarOf(ws, { DB: ['internal/db/db.go'], DB2: ['internal/db/pool.go', 'internal/cfg/cfg.go'], CFG: ['internal/cfg/cfg.go'], CMD: ['cmd/main.go'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d.facts.importSameCommit.map((r) => [r.from, r.to, r.edges, r.specificEdges]), [['CFG', 'CMD', 1, 0], ['DB', 'CMD', 1, 1], ['DB2', 'CMD', 2, 1]]);
});

test('0.31.0 多仓：独占锚时刻跨仓取最早 / 最晚；specificAnchors 按整个侧车计', (t) => {
  const { ws, sidecar } = workspace(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  const opc = d.recency.find((r) => r.node === 'OPC');
  assert.deepEqual([day(opc.firstSpecificAt), day(opc.lastSpecificAt), opc.specificAnchors], ['2026-01-01', '2026-01-04', 1]);
  assert.deepEqual(day(d.order.find((o) => o.node === 'OPC').lastSpecificAt), '2026-01-04');
  assert.deepEqual(d.blindSpots.anchors.shared, { files: 0, nodes: 0, top: [] });
});

test('0.31.0 blindSpots.anchors.shared：共享锚文件数、只有共享锚的节点数、top；聚焦与 brief 原样；空态计 0', (t) => {
  const { ws, sidecar, repos } = sharedFixture(t);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  const shared = { files: 2, nodes: 1, top: [{ file: 's.md', nodes: 3 }, { file: 'u.mjs', nodes: 2 }] };
  assert.deepEqual(d.blindSpots.anchors.shared, shared);
  assert.deepEqual(computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'C' }).blindSpots.anchors.shared, shared);
  assert.deepEqual(briefOrder(d).blindSpots.anchors.shared, shared);
  const none = computeWorkspaceOrder({ sidecar: { nodes: {} }, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(none.blindSpots.anchors.shared, { files: 0, nodes: 0, top: [] });
});

// —— 整分支审阅修复（0.31.0）——
test('edges 按文件级去重：同一文件以两种写法引用同一目标只算 1 条边', (t) => {
  const ws = path.join(tmp(t), 'dup');
  fs.mkdirSync(ws);
  git(ws, '2026-03-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-03-01T00:00:00Z', { 'a.mjs': 'export const a = 1;\n', 'b.mjs': "import './a.mjs';\nimport * as z from './a';\n" }, 'T1');
  const sidecar = sidecarOf(ws, { A: ['a.mjs'], B: ['b.mjs'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d.facts.importSameCommit.map((r) => [r.from, r.to, r.edges, r.specificEdges]), [['A', 'B', 1, 1]]);
});

test('契约读法钉住：specificCommits = 0 只表示「没有一次提交两端都经独占锚被触及」——一端每次都是自己的独占锚也可能为 0', (t) => {
  const ws = path.join(tmp(t), 'half');
  fs.mkdirSync(ws);
  for (let i = 1; i <= 3; i += 1) {
    if (i === 1) git(ws, '2026-04-01T00:00:00Z', 'init', '-q');
    commitAt(ws, `2026-04-0${i}T00:00:00Z`, { 'a.mjs': 'a' + i + '\n', 's.md': 's' + i + '\n' }, 'c' + i);
  }
  const sidecar = sidecarOf(ws, { A: ['a.mjs'], B: ['s.md'], C: ['s.md'] });
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  const ab = d.facts.coChange.find((r) => r.a === 'A' && r.b === 'B');
  assert.deepEqual([ab.commits, ab.specificCommits], [3, 0]);
  assert.equal(day(d.recency.find((r) => r.node === 'A').lastSpecificAt), '2026-04-03');
});

test('Review Focus 补测：多仓含共享锚——共享判定与仓无关；共享锚在 sourcePath 外时 top 为 ../ 路径', (t) => {
  const root = tmp(t);
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  git(ws, '2026-05-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-05-01T00:00:00Z', { '.gitignore': 'svc/\n', 'top.mjs': 't\n' }, 'T1');
  const svc = path.join(ws, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-05-02T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-05-02T00:00:00Z', { 's.mjs': 's\n', 'common.md': 'c\n' }, 'S1');
  fs.writeFileSync(path.join(root, 'OUT.md'), 'o\n');
  const sidecar = sidecarOf(ws, { TOP: ['top.mjs', 'svc/common.md'], S: ['svc/s.mjs', 'svc/common.md'] });
  for (const id of ['TOP', 'S']) sidecar.nodes[id].evidence.push(path.join(root, 'OUT.md') + ':1');
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d.blindSpots.anchors.shared, { files: 2, nodes: 0, top: [{ file: '../OUT.md', nodes: 2 }, { file: 'svc/common.md', nodes: 2 }] });
  const s = d.recency.find((r) => r.node === 'S');
  assert.deepEqual([day(s.firstSpecificAt), s.specificAnchors], ['2026-05-02', 1]);
  const top = d.recency.find((r) => r.node === 'TOP');
  assert.deepEqual([day(top.firstSpecificAt), day(top.lastAt), top.specificAnchors], ['2026-05-01', '2026-05-02', 1]);
});
