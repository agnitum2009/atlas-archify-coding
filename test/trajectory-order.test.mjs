// 节点开发先后关系（lib/trajectory.mjs computeOrder）：夹具 git 仓 + 夹具事件，全在临时目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitCommits, nodeFiles, computeOrder, briefOrder, projectRepo, real, notSeenReasonsOf } from '../lib/trajectory.mjs';

const DATE = '2026-09-01T10:00:00Z'; // 全部提交同一时刻：先后只能靠提交序
function repoFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-trajord-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE };
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env });
  git('init', '-q');
  const commit = (files, msg) => {
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), body);
    }
    git('add', '-A');
    git('commit', '-q', '-m', msg);
  };
  const sidecarOf = (map) => ({ nodes: Object.fromEntries(Object.entries(map).map(([id, files]) => [id, { evidence: files.map((f) => (f.startsWith('git ') ? f : path.join(repo, f) + ':1')) }])) });
  return { dir, repo: real(repo), rawRepo: repo, git, commit, sidecarOf };
}

function baseline(t) {
  const f = repoFixture(t);
  f.commit({ 'src/a.mjs': 'export const a = 1;\n', 'notes/plan.txt': 'x\n' }, 'a');
  f.commit({ 'src/b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n" }, 'b built on a');
  f.commit({ 'src/c.mjs': 'export const c = 3;\n', 'src/b.mjs': "import { a } from './a.mjs';\nimport { c } from './c.mjs';\nexport const b = a + c;\n" }, 'c extracted from b');
  f.commit({ 'docs/readme.md': '# r\n' }, 'unowned doc');
  const sidecar = f.sidecarOf({ nA: ['src/a.mjs'], nB: ['src/b.mjs'], nC: ['src/c.mjs'], nP: ['notes/plan.txt'] });
  return { ...f, sidecar };
}

test('gitCommits：按提交序编号（同一时刻也可排序），files 为绝对路径', (t) => {
  const f = baseline(t);
  const commits = gitCommits(f.repo, null);
  assert.deepEqual(commits.map((c) => c.seq), [1, 2, 3, 4]);
  assert.ok(commits[1].files.includes(path.join(f.repo, 'src/b.mjs')));
});

test('computeOrder：order 按首现提交序；builtOn / dependsOnNewer 判定；facts 皆 M 级；抽出只作 I 级提名', (t) => {
  const f = baseline(t);
  const data = computeOrder({ sidecar: f.sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.order.map((o) => [o.node, o.firstSeq]), [['nA', 1], ['nP', 1], ['nB', 2], ['nC', 3]]);
  assert.deepEqual(data.facts.builtOn.map((r) => [r.from, r.to, r.level]), [['nA', 'nB', 'M']]);
  // c 首现的提交同时改了 b 的 import 文件：M 级只记「b 依赖了比自己晚出现的 c」+ wiredAtCreation 事实；「抽出」只作 I 级提名。
  assert.deepEqual(data.facts.dependsOnNewer.map((r) => [r.from, r.to, r.level, r.wiredAtCreation]), [['nC', 'nB', 'M', true]]);
  assert.equal(data.facts.extractedLater, undefined, 'extractedLater 已移除（0.25.0）');
  assert.deepEqual(data.nominations.extractionCandidates.map((r) => [r.from, r.to, r.level]), [['nC', 'nB', 'I']]);
  assert.deepEqual(data.unowned, ['docs/readme.md']);
  assert.deepEqual(data.importsUnparsed, ['.txt']);
  assert.deepEqual(data.nominations.readBeforeWrite, { status: 'no-data' });
  assert.equal(data.sessionEvents, 0);
});

test('computeOrder：无任何节点带证据锚 → no-anchored-nodes（无对象 ≠ 无发现）', (t) => {
  const f = baseline(t);
  const data = computeOrder({ sidecar: { nodes: { n: { evidence: [] } } }, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.order, { status: 'no-anchored-nodes' });
  assert.deepEqual(data.facts, { status: 'no-anchored-nodes' });
});

test('readBeforeWrite：单文件读计 1 出 I 级提名；批量提及 4 文件每文件 0.25 不达阈值', (t) => {
  const f = baseline(t);
  const p = (rel) => path.join(f.repo, rel);
  const events = [
    { session: 's1', eventId: '1', at: '2026-09-02T00:00:01Z', tool: 'Read', reads: [p('src/a.mjs')], writes: [] },
    { session: 's1', eventId: '2', at: '2026-09-02T00:00:02Z', tool: 'Edit', reads: [], writes: [p('src/b.mjs')] },
    { session: 's2', eventId: '3', at: '2026-09-02T00:00:03Z', tool: 'Bash', reads: [p('src/a.mjs'), p('src/b.mjs'), p('notes/plan.txt'), p('docs/readme.md')], writes: [] },
    { session: 's2', eventId: '4', at: '2026-09-02T00:00:04Z', tool: 'Edit', reads: [], writes: [p('src/c.mjs')] },
  ];
  const data = computeOrder({ sidecar: f.sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events });
  assert.deepEqual(data.nominations.readBeforeWrite, [{ from: 'nA', to: 'nB', weight: 1, level: 'I' }]);
  assert.equal(data.sessionEvents, 4);
});

test('coChange：同提交共改 ≥3 次出 M 级；>8 文件的大提交不计', (t) => {
  const f = repoFixture(t);
  for (let i = 0; i < 3; i += 1) f.commit({ 'a.mjs': 'a' + i + '\n', 'b.mjs': 'b' + i + '\n' }, 'pair ' + i);
  const bulk = {};
  for (let i = 0; i < 9; i += 1) bulk['x' + i + '.mjs'] = 'x\n';
  f.commit({ ...bulk, 'a.mjs': 'a9\n', 'b.mjs': 'b9\n' }, 'bulk');
  const data = computeOrder({ sidecar: f.sidecarOf({ nA: ['a.mjs'], nB: ['b.mjs'] }), repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.facts.coChange, [{ a: 'nA', b: 'nB', commits: 3, level: 'M' }]);
});

test('重命名前移：git mv 后节点首现仍是原始提交', (t) => {
  const f = repoFixture(t);
  f.commit({ 'old.mjs': 'export const x = 1;\n' }, 'create');
  f.commit({ 'other.mjs': 'y\n' }, 'unrelated');
  f.git('mv', 'old.mjs', 'core.mjs');
  f.git('commit', '-q', '-m', 'rename');
  const data = computeOrder({ sidecar: f.sidecarOf({ nCore: ['core.mjs'] }), repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.equal(data.order[0].node, 'nCore');
  assert.equal(data.order[0].firstSeq, 1);
});

test('git <sha> 形态锚被跳过不报错；sourcePath 经符号链接登记仍能归属', (t) => {
  const f = baseline(t);
  const link = path.join(f.dir, 'repo-link');
  fs.symlinkSync(f.rawRepo, link);
  const own = nodeFiles({ nodes: { nA: { evidence: [path.join(link, 'src/a.mjs') + ':1', 'git abc1234'] } } });
  assert.deepEqual([...own.keys()], [path.join(f.repo, 'src/a.mjs')]);
});

test('focusNode 只保留与该节点相连的关系；briefOrder 把数组换成 { count, top }', (t) => {
  const f = baseline(t);
  const data = computeOrder({ sidecar: f.sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [], focusNode: 'nC' });
  assert.deepEqual(data.order.map((o) => o.node), ['nC']);
  assert.deepEqual(data.facts.builtOn, []);
  assert.equal(data.facts.dependsOnNewer.length, 1);
  const brief = briefOrder(data);
  assert.deepEqual(brief.facts.dependsOnNewer, { count: 1, top: data.facts.dependsOnNewer });
  assert.deepEqual(brief.nominations.extractionCandidates, { count: 1, top: data.nominations.extractionCandidates });
  assert.equal(brief.unowned.count, 1);
});

test('projectRepo：无 sourcePath = project_source_missing；gitCommits 非 git 目录 = project_source_not_git', (t) => {
  const f = baseline(t);
  const state = path.join(f.dir, 'atlas', 'state');
  fs.mkdirSync(state, { recursive: true });
  const sidecar = path.join(state, 'atlas-state.json');
  fs.writeFileSync(path.join(state, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json' }] }));
  assert.throws(() => projectRepo(sidecar), (e) => e.code === 'project_source_missing');
  fs.writeFileSync(path.join(state, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-state.json', sourcePath: f.repo }] }));
  assert.equal(projectRepo(sidecar), f.repo);
  const notGit = path.join(f.dir, 'plain');
  fs.mkdirSync(notGit);
  assert.throws(() => gitCommits(notGit, null), (e) => e.code === 'project_source_not_git');
});

// —— 整分支审阅修复（I1 / I2 / M1）——
test('I1：--since 不改变先后分类——首现一律按全史，since 只收窄输出', (t) => {
  const f = repoFixture(t);
  const env = (d) => ({ ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
  const commitAt = (d, files, msg) => {
    for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(f.repo, rel), body);
    execFileSync('git', ['-C', f.repo, 'add', '-A'], { env: env(d) });
    execFileSync('git', ['-C', f.repo, 'commit', '-q', '-m', msg], { env: env(d) });
  };
  commitAt('2025-01-01T00:00:00Z', { 'util.mjs': 'export const u = 1;\n', 'feat.mjs': "import { u } from './util.mjs';\nexport const f = u;\n" }, 'both');
  commitAt('2026-01-02T00:00:00Z', { 'feat.mjs': "import { u } from './util.mjs';\nexport const f = u + 1;\n" }, 'touch feat');
  commitAt('2026-01-03T00:00:00Z', { 'util.mjs': 'export const u = 2;\n' }, 'touch util');
  const sidecar = f.sidecarOf({ U: ['util.mjs'], F: ['feat.mjs'] });
  const data = computeOrder({ sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [], sinceIso: '2026-01-01T00:00:00Z' });
  assert.deepEqual(data.facts.dependsOnNewer, []);
  assert.deepEqual(data.facts.importSameCommit.map((r) => [r.from, r.to]), [['U', 'F']]);
  assert.deepEqual(data.order.map((o) => [o.node, o.firstSeq]), [['F', 1], ['U', 1]]);
  assert.equal(data.commits, 2, '窗口内提交数');
  assert.equal(data.totalCommits, 3);
});

test('I2：注释里的 import 与未提交的 import 都不产生 M 级 builtOn（读 HEAD、去注释）', (t) => {
  const f = repoFixture(t);
  f.commit({ 'util.mjs': 'export const u = 1;\n' }, 'util');
  f.commit({ 'other.mjs': "// import z from './util.mjs'\n/* import y from './util.mjs' */\nexport const o = 1;\n" }, 'other with commented import');
  f.commit({ 'late.mjs': 'export const l = 1;\n' }, 'late');
  fs.writeFileSync(path.join(f.repo, 'late.mjs'), "import { u } from './util.mjs';\nexport const l = u;\n"); // 工作树改动，未提交
  const sidecar = f.sidecarOf({ U: ['util.mjs'], O: ['other.mjs'], L: ['late.mjs'] });
  const data = computeOrder({ sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.facts.builtOn, []);
});

test('M1：相对锚 / 非文件锚被跳过时披露 anchorsSkipped，不让节点静默消失', (t) => {
  const f = baseline(t);
  const sidecar = { nodes: { ...f.sidecar.nodes, R: { evidence: ['src/a.mjs:1'] }, G: { evidence: ['git abc1234'] } } };
  const data = computeOrder({ sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.anchorsSkipped, { relative: 1, nonFile: 1, nodes: ['G', 'R'] });
});

test('后来接入 ≠ 抽出：A 单独创建、B 几个提交后才接入 → dependsOnNewer wiredAtCreation=false，不进抽出候选', (t) => {
  const f = repoFixture(t);
  f.commit({ 'b.mjs': 'export const b = 1;\n' }, 'b first');
  f.commit({ 'a.mjs': 'export const a = 1;\n' }, 'a created alone');
  f.commit({ 'other.mjs': 'x\n' }, 'unrelated');
  f.commit({ 'b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n" }, 'b adopts a later');
  const data = computeOrder({ sidecar: f.sidecarOf({ A: ['a.mjs'], B: ['b.mjs'] }), repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.facts.dependsOnNewer.map((r) => [r.from, r.to, r.wiredAtCreation]), [['A', 'B', false]]);
  assert.deepEqual(data.nominations.extractionCandidates, []);
});

test('recency（最后活动视图，M 级）：按最后活动从新到旧；touches 与 commitsSince 按全史；不受 --since 影响', (t) => {
  const f = repoFixture(t);
  f.commit({ 'a.mjs': 'a\n', 'b.mjs': 'b\n', 'c.mjs': 'c\n' }, '1 create');
  f.commit({ 'a.mjs': 'a2\n' }, '2 edit a');
  f.commit({ 'b.mjs': 'b2\n' }, '3 edit b');
  f.commit({ 'x.txt': 'x\n' }, '4 unowned');
  f.commit({ 'b.mjs': 'b3\n' }, '5 edit b');
  const sidecar = f.sidecarOf({ A: ['a.mjs'], B: ['b.mjs'], C: ['c.mjs'] });
  const commits = gitCommits(f.repo, null);
  const data = computeOrder({ sidecar, repo: f.repo, commits, events: [] });
  assert.deepEqual(data.recency.map((r) => [r.node, r.lastSeq, r.touches, r.commitsSince, r.level]), [
    ['B', 5, 3, 0, 'M'],
    ['A', 2, 2, 3, 'M'],
    ['C', 1, 1, 4, 'M'],
  ]);
  const late = computeOrder({ sidecar, repo: f.repo, commits, events: [], sinceIso: '2030-01-01T00:00:00Z' });
  assert.deepEqual(late.order, []);
  assert.deepEqual(late.recency.map((r) => r.node), ['B', 'A', 'C'], '--since 不得把长期未动的节点从最后活动视图里滤掉');
  const focus = computeOrder({ sidecar, repo: f.repo, commits, events: [], focusNode: 'A' });
  assert.deepEqual(focus.recency.map((r) => r.node), ['A']);
  assert.deepEqual(briefOrder(data).recency, { count: 3, top: data.recency });
});

test('recency：无锚定节点 = no-anchored-nodes（与 order 同口径）', (t) => {
  const f = repoFixture(t);
  f.commit({ 'a.mjs': 'a\n' }, 'a');
  const data = computeOrder({ sidecar: { nodes: {} }, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.recency, { status: 'no-anchored-nodes' });
});

// —— demo-b 实测三项小修（0.26.0）——
test('recency 附带节点账本状态 progress / ledger（事实并列，不作停摆判断）', (t) => {
  const f = repoFixture(t);
  f.commit({ 'a.mjs': 'a\n', 'b.mjs': 'b\n' }, 'create');
  const sidecar = f.sidecarOf({ A: ['a.mjs'], B: ['b.mjs'] });
  sidecar.nodes.A.progress = 'in_progress';
  sidecar.nodes.A.ledger = 'backlog';
  const data = computeOrder({ sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  const byNode = Object.fromEntries(data.recency.map((r) => [r.node, [r.progress, r.ledger]]));
  assert.deepEqual(byNode, { A: ['in_progress', 'backlog'], B: [null, null] });
});

test('notSeenReasons：未被 git 触及的节点按原因分桶——仓外 / 嵌套仓 / 从未提交 / 混合；嵌套仓逐个计数', (t) => {
  const f = repoFixture(t);
  f.commit({ 'a.mjs': 'a\n' }, 'create a');
  const nested = path.join(f.repo, 'sub');
  fs.mkdirSync(nested);
  execFileSync('git', ['-C', nested, 'init', '-q']);
  fs.writeFileSync(path.join(nested, 'x.mjs'), 'x\n');
  fs.writeFileSync(path.join(f.repo, 'untracked.mjs'), 'u\n');
  const outside = path.join(f.dir, 'outside.txt');
  fs.writeFileSync(outside, 'o\n');
  const sidecar = { nodes: {
    A: { evidence: [path.join(f.repo, 'a.mjs') + ':1'] },
    N: { evidence: [path.join(nested, 'x.mjs') + ':1'] },
    O: { evidence: [outside + ':1'] },
    U: { evidence: [path.join(f.repo, 'untracked.mjs') + ':1'] },
    M: { evidence: [outside + ':1', path.join(nested, 'x.mjs') + ':1'] },
  } };
  const data = computeOrder({ sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.notSeen, ['M', 'N', 'O', 'U'], 'notSeen 字符串数组保持不变（兼容）');
  assert.deepEqual(data.notSeenReasons, {
    outsideRepo: ['O'], nestedRepo: ['N'], neverCommitted: ['U'], mixed: ['M'],
    nestedRepos: [{ root: 'sub', nodes: 2 }],
  });
});

test('--node 瘦身：notSeen / notSeenReasons 随聚焦收窄；unowned 以 { omitted, count } 披露而非空数组', (t) => {
  const f = baseline(t);
  const data = computeOrder({ sidecar: f.sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [], focusNode: 'nA' });
  assert.deepEqual(data.unowned, { omitted: 'focus', count: 1 });
  assert.deepEqual(data.notSeen, []);
  const brief = briefOrder(data);
  assert.deepEqual(brief.unowned, { omitted: 'focus', count: 1 });
});

// —— 多仓准备（0.27.0 Task 1）——
test('computeOrder sameRepo：dep 不在本仓的 import 不产生关系；recency 带首现 firstSeq/firstAt', (t) => {
  const f = repoFixture(t);
  f.commit({ 'a.mjs': 'export const a = 1;\n' }, 'a');
  f.commit({ 'b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n" }, 'b');
  const sidecar = f.sidecarOf({ A: ['a.mjs'], B: ['b.mjs'] });
  const commits = gitCommits(f.repo, null);
  const all = computeOrder({ sidecar, repo: f.repo, commits, events: [] });
  assert.deepEqual(all.facts.builtOn.map((r) => [r.from, r.to]), [['A', 'B']]);
  const onlyB = computeOrder({ sidecar, repo: f.repo, commits, events: [], sameRepo: (file) => file.endsWith('b.mjs') });
  assert.deepEqual(onlyB.facts.builtOn, [], 'dep 不满足 sameRepo 时不判定');
  assert.deepEqual(all.recency.map((r) => [r.node, r.firstSeq]), [['B', 2], ['A', 1]]);
});

test('notSeenReasonsOf readRoots：嵌套仓已被读取但文件从未提交 → neverCommitted，不误报 nestedRepo', (t) => {
  const f = repoFixture(t);
  f.commit({ 'a.mjs': 'a\n' }, 'a');
  const nested = path.join(f.repo, 'sub');
  fs.mkdirSync(nested);
  execFileSync('git', ['-C', nested, 'init', '-q']);
  fs.writeFileSync(path.join(nested, 'x.mjs'), 'x\n');
  const own = nodeFiles({ nodes: { N: { evidence: [path.join(nested, 'x.mjs') + ':1'] } } });
  assert.deepEqual(notSeenReasonsOf(own, ['N'], f.repo).nestedRepo, ['N']);
  const read = notSeenReasonsOf(own, ['N'], f.repo, new Set([real(nested)]));
  assert.deepEqual([read.nestedRepo, read.neverCommitted], [[], ['N']]);
});

test('computeOrder withNotSeenReasons=false：跳过分桶计算（多仓合并层丢弃的结果不再重复算）', (t) => {
  const f = baseline(t);
  const data = computeOrder({ sidecar: f.sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [], withNotSeenReasons: false });
  assert.equal(data.notSeenReasons, undefined);
  assert.ok(Array.isArray(data.notSeen));
});
