// 多仓工作区回溯（lib/trajectory-workspace.mjs）：顶层仓 + 嵌套仓（其一先在顶层后拆出），非 git 工作区根，读失败点名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitCommits, real, briefOrder } from '../lib/trajectory.mjs';
import { discoverRepos, computeWorkspaceOrder, groupUnowned } from '../lib/trajectory-workspace.mjs';

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
  assert.deepEqual(d.notSeen, []);
  assert.deepEqual(d.unowned, [{ repo: '.', dir: '.', count: 1, sample: ['.gitignore'] }]);
  assert.deepEqual(d.unownedByRepo, [
    { repo: '.', count: 1, topDirs: [{ dir: '.gitignore', count: 1 }] },
    { repo: 'opc', count: 0, topDirs: [] },
    { repo: 'svc', count: 0, topDirs: [] },
  ]);
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
  assert.deepEqual(d.unowned, [{ repo: 'svc', dir: 'docs', count: 1, sample: ['svc/docs/n.md'] }]);
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
  assert.deepEqual(d.unowned, { omitted: 'focus', count: 1 });
  assert.deepEqual(d.unownedByRepo, { omitted: 'focus' });
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
  assert.deepEqual(d.notSeenReasons.neverCommitted, ['N']);
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
  assert.deepEqual([d.notSeenReasons.outsideRepo, d.notSeenReasons.neverCommitted], [['L'], []]);
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
  assert.deepEqual(all.unowned.filter((g) => g.sample.includes('shared/readme.md')).map((g) => [g.repo, g.count]), [['shared', 1]]);
  const focus = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'CORE' });
  assert.deepEqual(focus.unowned, { omitted: 'focus', count: all.unowned.reduce((s, g) => s + g.count, 0) });
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
  assert.deepEqual(all.unowned, [
    { repo: '.', dir: '.', count: 1, sample: ['.gitignore'] },
    { repo: 'shared', dir: '.', count: 1, sample: ['shared/readme.md'] },
  ]);
  const focus = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [], focusNode: 'CORE' });
  assert.equal(focus.unowned.count, all.unowned.reduce((s, g) => s + g.count, 0));
  assert.deepEqual(briefOrder(all).unowned, { count: 2, top: all.unowned });
});

test('0.28.0 单仓（sourcePath 即仓根）：unowned 同样按两层目录分组；unownedByRepo 不变', (t) => {
  const ws = path.join(tmp(t), 'one');
  fs.mkdirSync(ws);
  git(ws, '2026-05-01T00:00:00Z', 'init', '-q');
  commitAt(ws, '2026-05-01T00:00:00Z', { 'a.mjs': 'a\n', 'x.md': 'x\n', 'p/t.md': 't\n', 'p/q/r/s.md': 's\n' }, 'A');
  const sidecar = sidecarOf(ws, { A: ['a.mjs'] });
  const repos = withCommits(discoverRepos(ws, sidecar));
  assert.deepEqual(repos.map((r) => r.repo), ['.']);
  const d = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos, events: [] });
  assert.deepEqual(d.unowned, [
    { repo: '.', dir: '.', count: 1, sample: ['x.md'] },
    { repo: '.', dir: 'p', count: 1, sample: ['p/t.md'] },
    { repo: '.', dir: 'p/q', count: 1, sample: ['p/q/r/s.md'] },
  ]);
  assert.deepEqual(d.unownedByRepo, [{ repo: '.', count: 3, topDirs: [{ dir: 'p', count: 2 }, { dir: 'x.md', count: 1 }] }]);
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
  assert.deepEqual(d.importsUnresolved, { count: 1, top: [{ file: 'apps/web/app.ts', spec: './gone' }] });
});

test('0.29.0 多仓：三项披露跨仓合并（路径相对 sourcePath）；顶层仓相对引用嵌套仓文件既不出边也不计 unresolved', (t) => {
  const { ws, sidecar } = workspace(t);
  const d0 = computeWorkspaceOrder({ sidecar, sourceRoot: ws, repos: withCommits(discoverRepos(ws, sidecar)), events: [] });
  assert.deepEqual(d0.importsUnresolved, { count: 0, top: [] }, 'core.mjs → ./svc/s.mjs 是跨仓引用，不是解析失败');

  const root = tmp(t);
  git(root, '2026-07-01T00:00:00Z', 'init', '-q');
  commitAt(root, '2026-07-01T00:00:00Z', { '.gitignore': 'svc/\n', 'a.mjs': "import { n } from './nope';\n", 'q.sql': 'select 1;\n' }, 'top');
  const svc = path.join(root, 'svc');
  fs.mkdirSync(svc);
  git(svc, '2026-07-02T00:00:00Z', 'init', '-q');
  commitAt(svc, '2026-07-02T00:00:00Z', { 's.mjs': "import { g } from './gone';\n", 'doc.md': '# d\n', 'x.py': 'import os\n' }, 'svc');
  const sc = sidecarOf(root, { A: ['a.mjs'], Q: ['q.sql'], S: ['svc/s.mjs'], D: ['svc/doc.md'], P: ['svc/x.py'] });
  const d = computeWorkspaceOrder({ sidecar: sc, sourceRoot: root, repos: withCommits(discoverRepos(root, sc)), events: [] });
  assert.deepEqual(d.importsUnresolved, { count: 2, top: [{ file: 'a.mjs', spec: './nope' }, { file: 'svc/s.mjs', spec: './gone' }] });
  assert.deepEqual(d.importsNotApplicable, ['.md', '.sql']);
  assert.deepEqual(d.importsUnparsed, ['.py']);
});
