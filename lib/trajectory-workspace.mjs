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
    .map((root) => ({ repo: path.relative(sourceRoot, root).split(path.sep).join('/') || '.', root }))
    .sort((a, b) => (a.repo === '.' ? -1 : b.repo === '.' ? 1 : a.repo.localeCompare(b.repo)));
}

// 无主改动按「仓 / 仓内前两层目录」聚合（0.28.0）：完整回执不再逐文件列出（demo-b 实测约 4 万条），每组附 ≤3 个样本（相对 sourcePath、字典序）。
// 同一路径在顶层旧史与嵌套仓都出现只计一次，归到路径前缀最深的参与仓（按 / 边界匹配）。
export function groupUnowned(files, repoNames) {
  const deep = repoNames.filter((r) => r !== '.').sort((a, b) => b.length - a.length);
  const groups = new Map();
  for (const f of [...new Set(files)].sort()) {
    const repo = deep.find((r) => f.startsWith(r + '/')) || '.';
    const rel = repo === '.' ? f : f.slice(repo.length + 1);
    const dir = rel.split('/').slice(0, -1).slice(0, 2).join('/') || '.';
    const key = repo + '\0' + dir;
    const g = groups.get(key) || { repo, dir, count: 0, sample: [] };
    g.count += 1;
    if (g.sample.length < 3) g.sample.push(f);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo) || a.dir.localeCompare(b.dir));
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// 仓内引用解析失败的披露（0.29.0）：{ count, top≤10 }，file 相对 sourcePath，按 file、spec code-unit 序。
function unresolvedOf(items) {
  const all = [...items].sort((a, b) => cmp(a.file, b.file) || cmp(a.spec, b.spec));
  return { count: all.length, top: all.slice(0, 10) };
}

const toSlash = (p) => p.split(path.sep).join('/');

// 盲区披露（0.30.0）：atlas 看不见什么、为什么——收在一处，按原因分四类；只披露，不裁决、不建议。
//   anchors = 锚本身不可用；nodes = 有锚但 git 从未见过（桶互斥，count = 各桶之和）；
//   files = git 见过但无锚（路径归属、去重；聚焦时只给 count）；imports = 解析层缺口（全局，不随聚焦）。
// 锚共享面（0.31.0）：被 ≥2 个节点认领的锚文件。按整个侧车计（锚归属与仓无关）；无锚定节点时照算为 0——账本静态属性，测过为零。
function sharedAnchorsOf(own, sourceRoot) {
  const shared = [...own].filter(([, s]) => s.size >= 2);
  const all = new Set([...own.values()].flatMap((s) => [...s]));
  const withSpecific = new Set([...own.values()].filter((s) => s.size === 1).flatMap((s) => [...s]));
  const top = shared.map(([f, s]) => ({ file: toSlash(path.relative(sourceRoot, f)), nodes: s.size }))
    .sort((a, b) => b.nodes - a.nodes || cmp(a.file, b.file)).slice(0, 10);
  return { files: shared.length, nodes: [...all].filter((n) => !withSpecific.has(n)).length, top };
}
function filesOf(paths, repoNames, focusNode) {
  const all = [...new Set(paths)];
  return focusNode ? { omitted: 'focus', count: all.length } : { count: all.length, groups: groupUnowned(all, repoNames) };
}
function blindSpotsOf({ anchorsSkipped, shared, notSeenReasons: r, files, imports }) {
  // 无锚定节点 = 无锚定文件可解析：imports 给 status，不给一组零（零读作「全部解析成功」，DEFENSIVE §9）。
  if (r.status) return { anchors: { ...anchorsSkipped, shared }, nodes: r, files, imports: { status: r.status } };
  const nodes = r.status ? r : { count: r.outsideRepo.length + r.nestedRepo.length + r.neverCommitted.length + r.mixed.length, ...r };
  return { anchors: { ...anchorsSkipped, shared }, nodes, files, imports };
}

// --brief：数组换为 { count, top≤10 }。作用于回执形状（含 blindSpots），故在组装层。
export function briefOrder(data) {
  const cut = (v) => (Array.isArray(v) ? { count: v.length, top: v.slice(0, 10) } : v);
  const group = (g) => (g && !g.status ? Object.fromEntries(Object.entries(g).map(([k, v]) => [k, cut(v)])) : g);
  const { files } = data.blindSpots;
  return {
    ...data, order: cut(data.order), recency: cut(data.recency), facts: group(data.facts), nominations: group(data.nominations),
    blindSpots: { ...data.blindSpots, nodes: group(data.blindSpots.nodes), files: files.groups ? { ...files, groups: cut(files.groups) } : files },
  };
}

// 单仓：内核已按聚焦算好；无主文件路径统一为 /（内核给的是本机分隔符）。
function decorateSingle(d, repo, shared) {
  const tag = (e) => ({ ...e, firstRepo: repo, lastRepo: repo });
  // notSeen 不再单列：由 blindSpots.nodes 各桶拼出。
  const { anchorsSkipped, notSeen, notSeenReasons, unowned, importsUnparsed, importsNotApplicable, importsUnresolved, ...rest } = d;
  return {
    ...rest,
    repos: [{ repo, commits: d.commits, totalCommits: d.totalCommits, span: d.span }],
    order: Array.isArray(d.order) ? d.order.map(tag) : d.order,
    recency: Array.isArray(d.recency) ? d.recency.map(tag) : d.recency,
    blindSpots: blindSpotsOf({
      anchorsSkipped, shared, notSeenReasons,
      files: Array.isArray(unowned) ? filesOf(unowned.map(toSlash), [repo], null) : unowned,
      imports: { unparsed: importsUnparsed, notApplicable: importsNotApplicable, unresolved: unresolvedOf(importsUnresolved) },
    }),
  };
}

function mergeNodes(per) {
  const nodes = new Map();
  for (const { repo, out } of per) {
    if (!Array.isArray(out.recency)) continue;
    for (const r of out.recency) {
      const e = nodes.get(r.node) || { node: r.node, progress: r.progress, ledger: r.ledger, specificAnchors: r.specificAnchors, parts: [] };
      e.parts.push({ repo, firstSeq: r.firstSeq, firstAt: r.firstAt, lastSeq: r.lastSeq, lastAt: r.lastAt, firstSpecificAt: r.firstSpecificAt, lastSpecificAt: r.lastSpecificAt, touches: r.touches, commitsSince: r.commitsSince });
      nodes.set(r.node, e);
    }
  }
  return nodes;
}

function nodeEntry(n, repoIndex) {
  const t = (s) => Date.parse(s);
  const f = [...n.parts].sort((a, b) => t(a.firstAt) - t(b.firstAt) || repoIndex(a.repo) - repoIndex(b.repo))[0];
  const l = [...n.parts].sort((a, b) => t(b.lastAt) - t(a.lastAt) || repoIndex(a.repo) - repoIndex(b.repo))[0];
  // 独占锚时刻跨仓：首次取各仓最早、最近取各仓最晚（按时刻比较），与 firstAt / lastAt 同规则。
  const fs0 = n.parts.map((p) => p.firstSpecificAt).filter(Boolean).sort((a, b) => t(a) - t(b));
  const ls0 = n.parts.map((p) => p.lastSpecificAt).filter(Boolean).sort((a, b) => t(b) - t(a));
  const entry = { node: n.node, firstSeq: f.firstSeq, firstAt: f.firstAt, firstRepo: f.repo, lastSeq: l.lastSeq, lastAt: l.lastAt, lastRepo: l.repo, firstSpecificAt: fs0[0] ?? null, lastSpecificAt: ls0[0] ?? null };
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

export function computeWorkspaceOrder({ sidecar, sourceRoot, repos, events, focusNode = null, sinceIso = null }) {
  if (repos.length === 0) throw fail('project_source_not_git', 'sourcePath 下没有可读的 git 仓：它本身不是仓根，其下也没有证据锚所在的嵌套仓（若 sourcePath 位于某仓的子目录，请改登记该仓根）：' + sourceRoot);
  if (repos.length === 1 && repos[0].root === sourceRoot) {
    return decorateSingle(computeOrder({ sidecar, repo: sourceRoot, commits: repos[0].commits, events, focusNode, sinceIso }), '.', sharedAnchorsOf(nodeFiles(sidecar), sourceRoot));
  }
  const rootCache = new Map();
  const rootOf = (f) => { if (!rootCache.has(f)) rootCache.set(f, real(gitRepoRootOf(f) || '/')); return rootCache.get(f); };
  const per = repos.map((r) => ({ ...r, out: computeOrder({ sidecar, repo: r.root, commits: r.commits, events: [], sinceIso, sameRepo: (f) => rootOf(f) === r.root, withNotSeenReasons: false }) }));
  // 各仓不聚焦地算，聚焦在合并层统一施加（unowned 需全量路径才能与非聚焦同口径去重）。
  const focusHit = (r) => !focusNode || r.from === focusNode || r.to === focusNode || r.a === focusNode || r.b === focusNode;
  const repoIndex = (name) => repos.findIndex((r) => r.repo === name);
  const nodes = mergeNodes(per);
  const active = new Set(per.flatMap((p) => (Array.isArray(p.out.order) ? p.out.order.map((o) => o.node) : [])));
  const built = new Map([...nodes.values()].map((n) => [n.node, nodeEntry(n, repoIndex)]));
  const lists = repos.map((r) => [...built.values()]
    .filter((b) => active.has(b.entry.node) && b.entry.firstRepo === r.repo)
    .sort((a, b) => a.entry.firstSeq - b.entry.firstSeq || a.entry.node.localeCompare(b.entry.node)));
  const order = mergeByTime(lists).map((b) => ({ ...b.entry, ...b.detail })).filter((o) => !focusNode || o.node === focusNode);
  const recency = [...built.values()]
    .map((b) => {
      const n = nodes.get(b.entry.node);
      return { ...b.entry, touches: n.parts.reduce((s, p) => s + p.touches, 0), commitsSince: b.last.commitsSince, specificAnchors: n.specificAnchors, progress: n.progress, ledger: n.ledger, level: 'M', ...b.detail };
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.node.localeCompare(b.node))
    .filter((r) => !focusNode || r.node === focusNode);
  const facts = {};
  for (const key of ['builtOn', 'dependsOnNewer', 'importSameCommit', 'coChange']) {
    facts[key] = per.flatMap(({ repo, out }) => (Array.isArray(out.facts[key]) ? out.facts[key].filter(focusHit).map((x) => ({ ...x, repo })) : []));
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
    order, recency, facts, nominations,
    blindSpots: blindSpotsOf({
      anchorsSkipped: per[0].out.anchorsSkipped,
      shared: sharedAnchorsOf(own, sourceRoot),
      notSeenReasons: notSeenReasonsOf(own, notSeen, sourceRoot, new Set(repos.map((r) => r.root))),
      // 先按 sourcePath 相对路径去重，再决定是否聚焦省略——聚焦 count 与非聚焦 count 同口径（同一路径在顶层旧史与嵌套仓都出现只计一次）。
      files: filesOf(per.flatMap(({ root, out }) => out.unowned.map((rel) => toSlash(path.relative(sourceRoot, path.join(root, rel))))), per.map((p) => p.repo), focusNode),
      imports: {
        unparsed: [...new Set(per.flatMap((p) => p.out.importsUnparsed))].sort(),
        notApplicable: [...new Set(per.flatMap((p) => p.out.importsNotApplicable))].sort(),
        unresolved: unresolvedOf(per.flatMap(({ root, out }) => out.importsUnresolved.map((u) => ({ file: toSlash(path.relative(sourceRoot, path.join(root, u.file))), spec: u.spec })))),
      },
    }),
  };
}
