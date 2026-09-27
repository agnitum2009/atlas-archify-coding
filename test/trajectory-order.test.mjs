// 节点开发先后关系（lib/trajectory.mjs computeOrder）：夹具 git 仓 + 夹具事件，全在临时目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitCommits, nodeFiles, computeOrder, briefOrder, projectRepo, real } from '../lib/trajectory.mjs';

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

test('computeOrder：order 按首现提交序；builtOn / extractedLater 判定；facts 皆 M 级', (t) => {
  const f = baseline(t);
  const data = computeOrder({ sidecar: f.sidecar, repo: f.repo, commits: gitCommits(f.repo, null), events: [] });
  assert.deepEqual(data.order.map((o) => [o.node, o.firstSeq]), [['nA', 1], ['nP', 1], ['nB', 2], ['nC', 3]]);
  assert.deepEqual(data.facts.builtOn.map((r) => [r.from, r.to, r.level]), [['nA', 'nB', 'M']]);
  assert.deepEqual(data.facts.extractedLater.map((r) => [r.from, r.to, r.level]), [['nC', 'nB', 'M']]);
  assert.deepEqual(data.unowned, ['docs/readme.md']);
  assert.deepEqual(data.importsUnparsed, ['.txt']);
  assert.deepEqual(data.nominations, { status: 'no-data' });
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
  assert.equal(data.facts.extractedLater.length, 1);
  const brief = briefOrder(data);
  assert.deepEqual(brief.facts.extractedLater, { count: 1, top: data.facts.extractedLater });
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
  assert.deepEqual(data.facts.extractedLater, []);
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
