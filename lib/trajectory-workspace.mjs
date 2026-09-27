// 多仓工作区回溯（0.27.0）：参与仓由证据锚推出——只收 sourcePath 目录树内、锚文件所在的 git 仓（顶层 + 嵌套）。
// 各仓独立用 computeOrder 计算（仓内提交序、重命名前移、关系判定不变），再合并：跨仓只按时刻归并先后，
// import / 同改关系只在同一仓内判定（两端分属不同仓不出）。单仓（参与仓恰为 sourcePath 本身）直接委托 computeOrder。
// 只回溯、不规划、不写侧车；本模块不含任何 harness 知识。
import fs from 'node:fs';
import path from 'node:path';
import { gitRepoRootOf } from './evidence.mjs';
import { fail, real, nodeFiles, computeOrder, readBeforeWrite, notSeenReasonsOf } from './trajectory.mjs';

const inside = (root, p) => p === root || p.startsWith(root + path.sep);

export function discoverRepos(sourceRoot, sidecar) {
  const roots = new Set();
  if (fs.existsSync(path.join(sourceRoot, '.git'))) roots.add(sourceRoot);
  for (const file of nodeFiles(sidecar).keys()) {
    if (!inside(sourceRoot, file)) continue;
    const root = gitRepoRootOf(file);
    if (root && inside(sourceRoot, real(root))) roots.add(real(root));
  }
  return [...roots]
    .map((root) => ({ repo: path.relative(sourceRoot, root) || '.', root }))
    .sort((a, b) => (a.repo === '.' ? -1 : b.repo === '.' ? 1 : a.repo.localeCompare(b.repo)));
}

function topDirsOf(files) {
  const m = new Map();
  for (const f of files) { const k = f.split('/')[0]; m.set(k, (m.get(k) || 0) + 1); }
  return [...m].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir)).slice(0, 10);
}

function decorateSingle(d, repo) {
  const tag = (e) => ({ ...e, firstRepo: repo, lastRepo: repo });
  return {
    ...d,
    repos: [{ repo, commits: d.commits, totalCommits: d.totalCommits, span: d.span }],
    order: Array.isArray(d.order) ? d.order.map(tag) : d.order,
    recency: Array.isArray(d.recency) ? d.recency.map(tag) : d.recency,
    unownedByRepo: Array.isArray(d.unowned) ? [{ repo, count: d.unowned.length, topDirs: topDirsOf(d.unowned) }] : { omitted: 'focus' },
  };
}

function mergeNodes(per) {
  const nodes = new Map();
  for (const { repo, out } of per) {
    if (!Array.isArray(out.recency)) continue;
    for (const r of out.recency) {
      const e = nodes.get(r.node) || { node: r.node, progress: r.progress, ledger: r.ledger, parts: [] };
      e.parts.push({ repo, firstSeq: r.firstSeq, firstAt: r.firstAt, lastSeq: r.lastSeq, lastAt: r.lastAt, touches: r.touches, commitsSince: r.commitsSince });
      nodes.set(r.node, e);
    }
  }
  return nodes;
}

function nodeEntry(n, repoIndex) {
  const t = (s) => Date.parse(s);
  const f = [...n.parts].sort((a, b) => t(a.firstAt) - t(b.firstAt) || repoIndex(a.repo) - repoIndex(b.repo))[0];
  const l = [...n.parts].sort((a, b) => t(b.lastAt) - t(a.lastAt) || repoIndex(a.repo) - repoIndex(b.repo))[0];
  const entry = { node: n.node, firstSeq: f.firstSeq, firstAt: f.firstAt, firstRepo: f.repo, lastSeq: l.lastSeq, lastAt: l.lastAt, lastRepo: l.repo };
  const detail = n.parts.length > 1 ? { repos: n.parts.map(({ repo, firstSeq, lastSeq, touches }) => ({ repo, firstSeq, lastSeq, touches })) } : {};
  return { entry, last: l, detail };
}

// k 路归并：每仓列表内已按首现提交序排好；每步取各仓队首首现时刻最早者（同刻取仓序在前者）。
function mergeByTime(lists) {
  const heads = lists.map(() => 0);
  const out = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < lists.length; i += 1) {
      if (heads[i] >= lists[i].length) continue;
      if (best < 0 || Date.parse(lists[i][heads[i]].firstAt) < Date.parse(lists[best][heads[best]].firstAt)) best = i;
    }
    if (best < 0) return out;
    out.push(lists[best][heads[best]]);
    heads[best] += 1;
  }
}

function mergeUnowned(per, sourceRoot, focusNode) {
  if (focusNode) return { unowned: { omitted: 'focus', count: per.reduce((s, p) => s + (p.out.unowned.count || 0), 0) }, unownedByRepo: { omitted: 'focus' } };
  const all = new Set();
  const unownedByRepo = per.map(({ repo, root, out }) => {
    const files = out.unowned.map((rel) => path.relative(sourceRoot, path.join(root, rel)).split(path.sep).join('/'));
    files.forEach((f) => all.add(f));
    return { repo, count: files.length, topDirs: topDirsOf(out.unowned) };
  });
  return { unowned: [...all].sort(), unownedByRepo };
}

export function computeWorkspaceOrder({ sidecar, sourceRoot, repos, events, focusNode = null, sinceIso = null }) {
  if (repos.length === 0) throw fail('project_source_not_git', 'sourcePath 下没有可读的 git 仓：它本身不是仓根，其下也没有证据锚所在的嵌套仓（若 sourcePath 位于某仓的子目录，请改登记该仓根）：' + sourceRoot);
  if (repos.length === 1 && repos[0].root === sourceRoot) {
    return decorateSingle(computeOrder({ sidecar, repo: sourceRoot, commits: repos[0].commits, events, focusNode, sinceIso }), '.');
  }
  const rootCache = new Map();
  const rootOf = (f) => { if (!rootCache.has(f)) rootCache.set(f, real(gitRepoRootOf(f) || '/')); return rootCache.get(f); };
  const per = repos.map((r) => ({ ...r, out: computeOrder({ sidecar, repo: r.root, commits: r.commits, events: [], focusNode, sinceIso, sameRepo: (f) => rootOf(f) === r.root }) }));
  const repoIndex = (name) => repos.findIndex((r) => r.repo === name);
  const nodes = mergeNodes(per);
  const active = new Set(per.flatMap((p) => (Array.isArray(p.out.order) ? p.out.order.map((o) => o.node) : [])));
  const built = new Map([...nodes.values()].map((n) => [n.node, nodeEntry(n, repoIndex)]));
  const lists = repos.map((r) => [...built.values()]
    .filter((b) => active.has(b.entry.node) && b.entry.firstRepo === r.repo)
    .sort((a, b) => a.entry.firstSeq - b.entry.firstSeq || a.entry.node.localeCompare(b.entry.node)));
  const order = mergeByTime(lists).map((b) => ({ ...b.entry, ...b.detail }));
  const recency = [...built.values()]
    .map((b) => {
      const n = nodes.get(b.entry.node);
      return { ...b.entry, touches: n.parts.reduce((s, p) => s + p.touches, 0), commitsSince: b.last.commitsSince, progress: n.progress, ledger: n.ledger, level: 'M', ...b.detail };
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.node.localeCompare(b.node));
  const facts = {};
  for (const key of ['builtOn', 'dependsOnNewer', 'importSameCommit', 'coChange']) {
    facts[key] = per.flatMap(({ repo, out }) => (Array.isArray(out.facts[key]) ? out.facts[key].map((x) => ({ ...x, repo })) : []));
  }
  const own = nodeFiles(sidecar);
  const hits = (r) => !focusNode || r.from === focusNode || r.to === focusNode || r.a === focusNode || r.b === focusNode;
  const rbw = readBeforeWrite(events, own);
  const nominations = {
    readBeforeWrite: Array.isArray(rbw) ? rbw.filter(hits) : rbw,
    extractionCandidates: facts.dependsOnNewer.filter((d) => d.wiredAtCreation)
      .map(({ from, to, via, repo }) => ({ from, to, via, repo, level: 'I', basis: 'A 首现的提交同时修改了 B 中 import A 的文件' })),
    note: 'I 级提名：由启发式推得，只提名不裁决',
  };
  const anchored = new Set([...own.values()].flatMap((s) => [...s]));
  const notSeen = [...anchored].filter((n) => !nodes.has(n) && (!focusNode || n === focusNode)).sort();
  const windows = per.map((p) => p.out.span).filter(Boolean);
  return {
    repo: sourceRoot,
    repos: per.map(({ repo, out }) => ({ repo, commits: out.commits, totalCommits: out.totalCommits, span: out.span })),
    commits: per.reduce((s, p) => s + p.out.commits, 0),
    totalCommits: per.reduce((s, p) => s + p.out.totalCommits, 0),
    // 按时刻比较（ISO 字符串的时区偏移可能不同，字典序不等于时序）。
    span: windows.length ? [windows.map((w) => w[0]).sort((a, b) => Date.parse(a) - Date.parse(b))[0], windows.map((w) => w[1]).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)] : null,
    sessionEvents: events.length,
    anchorsSkipped: per[0].out.anchorsSkipped,
    order, recency, notSeen,
    notSeenReasons: notSeenReasonsOf(own, notSeen, sourceRoot, new Set(repos.map((r) => r.root))),
    facts, nominations,
    ...mergeUnowned(per, sourceRoot, focusNode),
    importsUnparsed: [...new Set(per.flatMap((p) => p.out.importsUnparsed))].sort(),
  };
}
