// 轨迹：回溯已发生开发的节点先后关系——规整事件契约 + 只追加导入 + 读时投影。
// 边界：只回溯、不规划（不排期/预测/估算/判优先级）；不写任何状态轴——派生视图（A1 图=投影、码=实相）。
// harness 中立：本模块只认规整事件格式，不含任何 harness 名或原始日志格式；转换器在 scripts/。
// 证据分级：facts（提交序、HEAD import、同改）= M 级；nominations（会话读后写）= I 级提名，只提名不裁决。
import fs from 'node:fs';
import path from 'node:path';
import { resolveAtlasContext } from './atlas-data.mjs';
import { gitSync, parseLocator } from './evidence.mjs';
import { readProjectsRegistry } from './projects-registry.mjs';

export const TRAJECTORY_SCHEMA_VERSION = 1;
const FILE = 'trajectory.jsonl';

export function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

export function validateEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return '不是 JSON 对象';
  if (e.schemaVersion !== TRAJECTORY_SCHEMA_VERSION) return 'schemaVersion 必须为 ' + TRAJECTORY_SCHEMA_VERSION;
  for (const k of ['source', 'session', 'eventId', 'at', 'tool']) {
    if (typeof e[k] !== 'string' || !e[k]) return k + ' 必须是非空字符串';
  }
  if (Number.isNaN(Date.parse(e.at))) return 'at 不是可解析时间';
  for (const k of ['reads', 'writes']) {
    if (!Array.isArray(e[k]) || e[k].some((p) => typeof p !== 'string' || !path.isAbsolute(p))) return k + ' 必须是绝对路径字符串数组';
  }
  if (e.reads.length + e.writes.length === 0) return 'reads 与 writes 不能同时为空';
  return null;
}

function parseJsonl(text, label) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let e;
    try { e = JSON.parse(line); } catch { throw fail('trajectory_bad_event', label + ' 第 ' + (i + 1) + ' 行不是合法 JSON'); }
    const bad = validateEvent(e);
    if (bad) throw fail('trajectory_bad_event', label + ' 第 ' + (i + 1) + ' 行：' + bad);
    out.push(e);
  });
  return out;
}

export function trajectoryFile(sidecarPath) {
  const ctx = resolveAtlasContext(sidecarPath);
  if (!ctx) throw fail('trajectory_no_atlas', '侧车不在 atlas 版式内（所在目录无 state/spec/data 等分区），轨迹无 data/<项目>/ 落点：' + path.resolve(sidecarPath));
  return { ctx, file: path.join(ctx.dataDir, FILE) };
}

export function readEvents(sidecarPath) {
  const { file } = trajectoryFile(sidecarPath);
  if (!fs.existsSync(file)) return [];
  return parseJsonl(fs.readFileSync(file, 'utf8'), file);
}

export function importEvents(sidecarPath, sourceFile) {
  const { file } = trajectoryFile(sidecarPath);
  let text;
  try { text = fs.readFileSync(sourceFile, 'utf8'); } catch (e) {
    throw fail('trajectory_source_unreadable', '--source 不可读：' + sourceFile + '（' + (e.code || e.message) + '）');
  }
  const incoming = parseJsonl(text, sourceFile);
  const existing = fs.existsSync(file) ? parseJsonl(fs.readFileSync(file, 'utf8'), file) : [];
  const key = (e) => e.source + '\0' + e.session + '\0' + e.eventId;
  const seen = new Set(existing.map(key));
  const fresh = [];
  for (const e of incoming) {
    const k = key(e);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(e);
  }
  if (fresh.length > 0) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return { file, scanned: incoming.length, appended: fresh.length, duplicates: incoming.length - fresh.length, sources: [...new Set(incoming.map((e) => e.source))] };
}

const LOOKBACK = 30;
const COCHANGE_MIN = 3;
const BULK_COMMIT_FILES = 8;
const IMPORT_EXTS = new Set(['.mjs', '.js', '.cjs', '.jsx', '.ts', '.tsx']);

export function projectRepo(sidecarPath) {
  const { ctx } = trajectoryFile(sidecarPath);
  const registryPath = path.join(path.dirname(ctx.sidecarPath), 'projects.json');
  const entry = readProjectsRegistry(registryPath).entries.find((e) => e && e.project === ctx.project && typeof e.sourcePath === 'string' && e.sourcePath.trim());
  if (!entry) throw fail('project_source_missing', 'projects.json 无项目 ' + ctx.project + ' 的 sourcePath（轨迹回溯需要项目代码 git 仓）：' + registryPath);
  return real(entry.sourcePath);
}

export function gitCommits(repo, sinceIso) {
  const res = gitSync(['-c', 'core.quotePath=false', '-C', repo, 'log', '--reverse', '--name-status', '-M', '--format=@@%H %cI'], { maxBuffer: 1 << 28 });
  if (res.error || res.status !== 0) {
    const why = res.error ? (res.error.code || res.error.message) : String(res.stderr || '').trim().split('\n')[0];
    throw fail('project_source_not_git', 'sourcePath 不是可读 git 仓或 git 调用失败/超时：' + repo + '（' + why + '）');
  }
  const commits = [];
  let cur = null;
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('@@')) {
      const sp = line.indexOf(' ');
      cur = { seq: commits.length + 1, hash: line.slice(2, sp), at: line.slice(sp + 1), files: [] };
      commits.push(cur);
      continue;
    }
    if (!cur || !line.trim()) continue;
    const cols = line.split('\t');
    if (/^R\d*$/.test(cols[0]) && cols.length === 3) cur.files.push({ from: cols[1], to: cols[2] });
    else if (cols.length >= 2) cur.files.push({ to: cols[1] });
  }
  // 重命名前移：自新向旧累积改名映射，旧路径的历史归到最终路径。
  const renamed = new Map();
  for (let i = commits.length - 1; i >= 0; i -= 1) {
    const finals = [];
    for (const f of commits[i].files) {
      const final = renamed.get(f.to) || f.to;
      finals.push(path.join(repo, final));
      if (f.from) renamed.set(f.from, final);
    }
    commits[i].files = [...new Set(finals)];
  }
  if (!sinceIso) return commits;
  const since = Date.parse(sinceIso);
  return commits.filter((c) => Date.parse(c.at) >= since);
}

export function nodeFiles(sidecar) {
  const own = new Map();
  for (const [id, node] of Object.entries((sidecar && sidecar.nodes) || {})) {
    for (const loc of (node && node.evidence) || []) {
      const p = parseLocator(loc);
      if (!p.ok || !path.isAbsolute(p.file)) continue; // git <sha> 形态与相对锚不参与归属
      const f = real(p.file);
      if (!own.has(f)) own.set(f, new Set());
      own.get(f).add(id);
    }
  }
  return own;
}

// 被跳过的锚要披露（DEFENSIVE §9）：只有相对锚或 git <sha> 形态锚的节点不能静默从输出里消失。
function skippedAnchors(sidecar) {
  const out = { relative: 0, nonFile: 0, nodes: [] };
  for (const [id, node] of Object.entries((sidecar && sidecar.nodes) || {})) {
    const evidence = (node && node.evidence) || [];
    let usable = 0;
    for (const loc of evidence) {
      const p = parseLocator(loc);
      if (!p.ok) out.nonFile += 1;
      else if (!path.isAbsolute(p.file)) out.relative += 1;
      else usable += 1;
    }
    if (evidence.length > 0 && usable === 0) out.nodes.push(id);
  }
  out.nodes.sort();
  return out;
}

function activity(commits, own) {
  const seen = new Map();
  const touches = new Map();
  const unowned = new Set();
  const pairs = new Map();
  for (const c of commits) {
    const touched = new Set();
    for (const f of c.files) {
      const ns = own.get(f);
      if (!ns) { unowned.add(f); continue; }
      ns.forEach((n) => touched.add(n));
    }
    for (const n of touched) {
      touches.set(n, (touches.get(n) || 0) + 1);
      const r = seen.get(n);
      if (r) { r.lastSeq = c.seq; r.lastAt = c.at; } else seen.set(n, { node: n, firstSeq: c.seq, firstAt: c.at, lastSeq: c.seq, lastAt: c.at });
    }
    if (c.files.length > BULK_COMMIT_FILES) continue;
    const t = [...touched].sort();
    for (let i = 0; i < t.length; i += 1) for (let j = i + 1; j < t.length; j += 1) {
      const k = t[i] + '\0' + t[j];
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }
  return { seen, touches, unowned, pairs };
}

// 读 HEAD 版本（契约口径「HEAD import」：未提交的工作树改动不产生 M 级事实），先去注释再按行首锚定匹配。
function importsOf(file, repo) {
  const rel = path.relative(repo, file).split(path.sep).join('/');
  const res = gitSync(['-C', repo, 'show', 'HEAD:' + rel], { maxBuffer: 1 << 26 });
  if (res.error || res.status !== 0) return [];
  const src = String(res.stdout).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const out = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    const base = path.resolve(path.dirname(file), m[1] || m[2]);
    const hit = [base, base + '.mjs', base + '.js', base + '.ts', path.join(base, 'index.js')].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (hit) out.push(real(hit));
  }
  return out;
}

// builtOn = B 依赖了比自己早出现的 A；dependsOnNewer = B 依赖了比自己晚出现的 A（事实，不含「抽出」解读）。
// wiredAtCreation（可观测事实）= A 首现的提交是否同时改动了 B 中 import A 的文件；「抽出」解读只由 computeOrder 作 I 级提名。
function importRelations(own, seen, repo, commitFiles) {
  const rel = { builtOn: new Map(), dependsOnNewer: new Map(), importSameCommit: new Map() };
  const unparsed = new Set();
  for (const [file, owners] of own) {
    if (!IMPORT_EXTS.has(path.extname(file))) { unparsed.add(path.extname(file) || '(无扩展名)'); continue; }
    for (const dep of importsOf(file, repo)) {
      for (const B of owners) for (const A of own.get(dep) || []) {
        if (A === B || !seen.has(A) || !seen.has(B)) continue;
        const fa = seen.get(A).firstSeq;
        const fb = seen.get(B).firstSeq;
        const bucket = fa < fb ? rel.builtOn : fa > fb ? rel.dependsOnNewer : rel.importSameCommit;
        const k = A + '\0' + B;
        const r = bucket.get(k) || (bucket === rel.dependsOnNewer ? { from: A, to: B, via: [], level: 'M', wiredAtCreation: false } : { from: A, to: B, via: [], level: 'M' });
        if (bucket === rel.dependsOnNewer && (commitFiles.get(fa) || new Set()).has(file)) r.wiredAtCreation = true;
        if (r.via.length < 3) r.via.push(path.relative(repo, file) + ' → ' + path.relative(repo, dep));
        bucket.set(k, r);
      }
    }
  }
  const list = (m) => [...m.values()].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  return { builtOn: list(rel.builtOn), dependsOnNewer: list(rel.dependsOnNewer), importSameCommit: list(rel.importSameCommit), unparsed };
}

function readBeforeWrite(events, own) {
  if (events.length === 0) return { status: 'no-data' };
  const bySession = new Map();
  for (const e of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (!bySession.has(e.session)) bySession.set(e.session, []);
    bySession.get(e.session).push(e);
  }
  const nodesOf = (f) => own.get(real(f)) || [];
  const w = new Map();
  for (const list of bySession.values()) {
    list.forEach((e, i) => {
      const targets = new Set(e.writes.flatMap((f) => [...nodesOf(f)]));
      if (targets.size === 0) return;
      for (let j = Math.max(0, i - LOOKBACK); j < i; j += 1) {
        const prev = list[j];
        if (prev.reads.length === 0) continue;
        const share = 1 / prev.reads.length; // 单文件读计 1；提及 n 文件的读每文件计 1/n
        for (const r of prev.reads) for (const A of nodesOf(r)) for (const B of targets) {
          if (A === B) continue;
          const k = A + '\0' + B;
          w.set(k, (w.get(k) || 0) + share);
        }
      }
    });
  }
  const rbw = [...w].filter(([, x]) => x >= 1)
    .map(([k, x]) => { const [from, to] = k.split('\0'); return { from, to, weight: Math.round(x * 100) / 100, level: 'I' }; })
    .sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return rbw;
}

// commits 须为全史：首现（firstSeq）与先后分类一律按全史判定；sinceIso 只收窄输出（窗口内有活动的节点、
// 至少一端在窗口内活动的关系、窗口内的共改与无主改动），不改变分类——否则「窗口内首次被改」会冒充「首次出现」。
// 未被 git 触及的节点按原因分桶（DEFENSIVE §9：「无对象可查」不得混同「查了无发现」）：
//   outsideRepo = 锚文件不在代码仓内；nestedRepo = 锚文件在代码仓内的嵌套独立 git 仓里（顶层历史看不见）；
//   neverCommitted = 锚文件在代码仓内但从未出现在任何提交里（未跟踪/忽略/缺失）；mixed = 一个节点的锚跨多类。
function nestedRootOf(file, repo) {
  for (let d = path.dirname(file); d !== repo && d.startsWith(repo + path.sep); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
  }
  return null;
}

function notSeenReasonsOf(own, nodes, repo) {
  const filesOf = new Map();
  for (const [file, owners] of own) for (const n of owners) { if (!filesOf.has(n)) filesOf.set(n, []); filesOf.get(n).push(file); }
  const out = { outsideRepo: [], nestedRepo: [], neverCommitted: [], mixed: [] };
  const roots = new Map();
  for (const n of nodes) {
    const kinds = new Set();
    for (const file of filesOf.get(n) || []) {
      if (file !== repo && !file.startsWith(repo + path.sep)) { kinds.add('outsideRepo'); continue; }
      const root = nestedRootOf(file, repo);
      if (root) {
        kinds.add('nestedRepo');
        if (!roots.has(root)) roots.set(root, new Set());
        roots.get(root).add(n);
      } else kinds.add('neverCommitted');
    }
    out[kinds.size === 1 ? [...kinds][0] : 'mixed'].push(n);
  }
  const nestedRepos = [...roots].map(([root, set]) => ({ root: path.relative(repo, root), nodes: set.size }))
    .sort((a, b) => b.nodes - a.nodes || a.root.localeCompare(b.root));
  return { ...out, nestedRepos };
}

export function computeOrder({ sidecar, repo, commits, events, focusNode = null, sinceIso = null }) {
  const own = nodeFiles(sidecar);
  const since = sinceIso ? Date.parse(sinceIso) : null;
  const window = since === null ? commits : commits.filter((c) => Date.parse(c.at) >= since);
  const base = { repo, commits: window.length, totalCommits: commits.length, span: window.length ? [window[0].at, window[window.length - 1].at] : null, sessionEvents: events.length, anchorsSkipped: skippedAnchors(sidecar) };
  const { seen, touches } = activity(commits, own);
  const { seen: active, unowned, pairs } = activity(window, own);
  const unownedRel = [...unowned].map((f) => path.relative(repo, f)).sort();
  if (own.size === 0) {
    const none = { status: 'no-anchored-nodes' };
    return { ...base, order: none, recency: none, notSeen: [], notSeenReasons: none, facts: none, nominations: none, unowned: unownedRel, importsUnparsed: [] };
  }
  const anchored = new Set([...own.values()].flatMap((s) => [...s]));
  const commitFiles = new Map(commits.map((c) => [c.seq, new Set(c.files)]));
  const imp = importRelations(own, seen, repo, commitFiles);
  const coChange = [...pairs].filter(([, n]) => n >= COCHANGE_MIN)
    .map(([k, n]) => { const [a, b] = k.split('\0'); return { a, b, commits: n, level: 'M' }; })
    .sort((x, y) => y.commits - x.commits || x.a.localeCompare(y.a));
  // 最后活动视图（M 级，纯回溯）：始终按全史——长期未动的节点正是要显示的对象，--since 不得把它们滤掉。
  const lastSeqOfRepo = commits.length ? commits[commits.length - 1].seq : 0;
  let recency = [...seen.values()]
    .map((o) => {
      const n = (sidecar.nodes || {})[o.node] || {};
      return { node: o.node, lastSeq: o.lastSeq, lastAt: o.lastAt, touches: touches.get(o.node) || 0, commitsSince: lastSeqOfRepo - o.lastSeq, progress: n.progress ?? null, ledger: n.ledger ?? null, level: 'M' };
    })
    .sort((a, b) => b.lastSeq - a.lastSeq || a.node.localeCompare(b.node));
  let order = [...seen.values()].filter((o) => active.has(o.node)).sort((a, b) => a.firstSeq - b.firstSeq || a.node.localeCompare(b.node));
  let facts = { builtOn: imp.builtOn, dependsOnNewer: imp.dependsOnNewer, importSameCommit: imp.importSameCommit, coChange };
  if (since !== null) {
    const inWindow = (r) => active.has(r.from ?? r.a) || active.has(r.to ?? r.b);
    facts = Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v.filter(inWindow)]));
  }
  let nominations = {
    readBeforeWrite: readBeforeWrite(events, own),
    extractionCandidates: facts.dependsOnNewer.filter((d) => d.wiredAtCreation)
      .map(({ from, to, via }) => ({ from, to, via, level: 'I', basis: 'A 首现的提交同时修改了 B 中 import A 的文件' })),
    note: 'I 级提名：由启发式推得，只提名不裁决',
  };
  let notSeen = [...anchored].filter((n) => !seen.has(n)).sort();
  let unownedOut = unownedRel;
  if (focusNode) {
    notSeen = notSeen.filter((n) => n === focusNode);
    unownedOut = { omitted: 'focus', count: unownedRel.length }; // 无主改动不属于任何节点：聚焦时只披露计数，不给空数组（防「无发现」误读）
    const hits = (r) => r.from === focusNode || r.to === focusNode || r.a === focusNode || r.b === focusNode;
    order = order.filter((o) => o.node === focusNode);
    recency = recency.filter((o) => o.node === focusNode);
    facts = Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v.filter(hits)]));
    nominations = Object.fromEntries(Object.entries(nominations).map(([k, v]) => [k, Array.isArray(v) ? v.filter(hits) : v]));
  }
  return { ...base, order, recency, notSeen, notSeenReasons: notSeenReasonsOf(own, notSeen, repo), facts, nominations, unowned: unownedOut, importsUnparsed: [...imp.unparsed].sort() };
}

export function briefOrder(data) {
  const cut = (v) => (Array.isArray(v) ? { count: v.length, top: v.slice(0, 10) } : v);
  const group = (g) => (g && !g.status ? Object.fromEntries(Object.entries(g).map(([k, v]) => [k, cut(v)])) : g);
  return { ...data, order: cut(data.order), recency: cut(data.recency), notSeen: cut(data.notSeen), notSeenReasons: group(data.notSeenReasons), facts: group(data.facts), nominations: group(data.nominations), unowned: cut(data.unowned) };
}
