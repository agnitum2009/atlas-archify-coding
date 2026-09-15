#!/usr/bin/env node
// 边级对账（P-2，负责人令 2026-09-01 批落）：图上的 connection ↔ codegraph 边 ↔ 真码 三方核。
//
// 立法动机（同一批两令）：
//  ① 实测：archify 的 connections 只有 from/id/label/to/variant 五字段——边是无证据断言；
//     codegraph 的 edges 表（calls/imports/references/instantiates/implements/extends）恰是
//     "边"的唯一机器来源。本脚本把"边是否有据"从模型自觉变成机器可核。
//  ② 精度红线（纪律）：codegraph 行号有偏移、calls 边是 I 级提名——所以本脚本只做
//     "有/无"层面提名对账，绝不裁决语义；无据边=提示复核，漏边=提示候选，均不自动改图。
// 2026-09-15（缺陷8）——口径收紧，杜绝过度声称：
//   · 旧实现用 `COUNT(*) WHERE kind != 'contains'` 且双向任一命中即计 calibrated——**方向与类型都没验**，
//     却报成"已校准"。现在分开计数：typedDirectionalHits（方向+类型双证）/ directionalFileLevelHits
//     （仅方向一致的文件级提名）/ reverseOnly（只有反向边，方向未证）/ kindMismatch（有边但类型不符）。
//   · 类型只在**显式声明**且可映射时比对：读 connections[].kind / edge_kind / edgeKind；
//     `variant` 是样式（default/emphasis/security/dashed）、`label` 是自然语言——都不猜（旧实现留了
//     edgeKinds 集合却从未使用）。未声明/不可映射 ⇒ 类型记为 unchecked，绝不当已验。
//   · 声明了但不在可映射表内的 kind：如实报 unknown，不做「未知⇒跳过⇒通过」的伪通过。
//   · 漏边查询：确定顺序（ORDER BY）+ 显式截断披露（nominationTruncated），不再静默截断。
//   · 一文件多节点：旧实现 Map last-wins 静默丢归属；现在 Set 多归属并逐对提名，且标 multiOwner。
//   · 无索引仓不再一律称"图内自锚"：只有锚**确实指向本次传入的 spec 文件**才算 specAnchored，
//     其余如实记 noIndexAnchored（码证据不适用/未检查）。
//
// 粒度桥：连接端点（图 id）→ 账本节点（同 id）→ 证据锚（绝对路径）→ 仓内相对路径（向上找 .git）
// → codegraph.db 的 nodes.file_path 匹配。读库用 node:sqlite（Node ≥22；更低版本 N/A 不谎报）。
// 降级：无索引/无 sqlite/无账本节点 → 全部如实记 N/A（口径纪律：空对象不报 0）。
//
// 用法：node scripts/reconcile-graph-edges.mjs --spec <图.json> [--spec ...] --sidecar <账> [--repo <仓> ...]
//        [--nonaccounts <件>] [--strict] [--json] [--cap N]
//   --nonaccounts 缺省=<首个 --sidecar 同目录>/diagram-nonaccounts.json（与 A1 同源；缺文件=空集，零破坏）
// 信任模型：防误不防恶——本脚本只做**文件级提名**（proofLevel=file-level-nomination），
// 不声称证明边的语义（方向/类型只在上面明载的可判条件下判定，其余一律如实标 unchecked）。
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const multi = (k) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === k && argv[i + 1]) out.push(argv[i + 1]); return out; };
const one = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const JSON_OUT = argv.includes('--json');
const STRICT = argv.includes('--strict');
const CAP = one('--cap', 20);
const specs = multi('--spec');
const sidecars = multi('--sidecar');
const extraRepos = multi('--repo');
// 非账本实体声明（2026-09-14，A 批边可核率；与 A1 同构）：<侧车同目录>/diagram-nonaccounts.json
// 声明哪些图件 id 是**架构构件/图内局部标签**（非账本实体）——它们的端点边“码证据不适用”，
// 不入 ungrounded（另计 ungroundedDeclared），但**仍逐条入 findings**（可举可审，非静默抑制）。
// 依据：负责人 2026-09-11 P4「图绑定收窄」+ report.mjs A1 同款机制（口径一致）。
const NA_DEFAULT = (() => {
  const i = argv.indexOf('--sidecar');
  return i >= 0 && argv[i + 1] ? path.join(path.dirname(argv[i + 1]), 'diagram-nonaccounts.json') : null;
})();
const NONACCOUNTS_PATH = (() => { const i = argv.indexOf('--nonaccounts'); return i >= 0 && argv[i + 1] ? argv[i + 1] : NA_DEFAULT; })();
const declaredNonAccounts = new Set();
if (NONACCOUNTS_PATH && fs.existsSync(NONACCOUNTS_PATH)) {
  const parsed = (() => { try { return JSON.parse(fs.readFileSync(NONACCOUNTS_PATH, 'utf8')); } catch { return null; } })();
  const groups = parsed && parsed.nonAccounts && typeof parsed.nonAccounts === 'object' ? parsed.nonAccounts : {};
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    for (const gid of (g && Array.isArray(g.ids) ? g.ids : [])) declaredNonAccounts.add(String(gid));
  }
}

function fail(msg) {
  console.log(JSON.stringify({ schemaVersion: 1, command: 'reconcile-graph-edges', status: 'failed',
    diagnostics: [{ rule: 'bad_args', severity: 'error', evidence: msg }] }, null, 2));
  process.exit(2);
}
if (specs.length === 0 || sidecars.length === 0) fail('需要 --spec <图.json>（可重复）与 --sidecar <账>（只处理显式传入，不猜路径）');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node <22：N/A 降级 */ }

function repoRootOf(absPath) {
  let d = path.dirname(absPath);
  for (let i = 0; i < 20; i += 1) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

// ---------- 类型映射（只在显式声明且可映射时生效） ----------
// codegraph 的 kind 枚举（读库时只接受这些，未知 kind 不参与类型比对）。
const EDGE_KINDS = new Set(['calls', 'imports', 'references', 'instantiates', 'extends', 'implements']);
// 图边若显式声明机器可读类型（kind / edge_kind / edgeKind），值经此表映射到 codegraph kind。
// 注意：**不读 `variant`**（archify 里是样式枚举 default|emphasis|security|dashed）与 **不读 `label`**
// （自然语言，如"引 a"），二者都不构成类型声明——照旧实现那样从类型字段猜，即等于制造假证据。
const KIND_ALIASES = {
  call: 'calls', calls: 'calls',
  import: 'imports', imports: 'imports',
  reference: 'references', references: 'references', ref: 'references',
  instantiate: 'instantiates', instantiates: 'instantiates',
  extend: 'extends', extends: 'extends',
  implement: 'implements', implements: 'implements',
};

function explicitKindOf(conn) {
  for (const field of ['kind', 'edge_kind', 'edgeKind']) {
    const raw = conn[field];
    if (typeof raw !== 'string') continue;
    const key = raw.trim().toLowerCase();
    return { declared: raw, field, kind: KIND_ALIASES[key] || null };
  }
  return { declared: null, field: null, kind: null };
}

// ---------- 图与账 ----------
const specAbs = new Set(specs.map((p) => path.resolve(p)));
const connections = [];
let kindDeclaredTyped = 0;
let kindDeclaredUnknown = 0;
let kindUndeclared = 0;
for (const sp of specs) {
  let d;
  try { d = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (e) { fail('spec 非合法 JSON：' + sp + '（' + e.message + '）'); }
  // 2026-09-10 修（负责人责问的 worker 面缺口同批实捕）：workflow/sequence 型图用
  // `edges[]`（无 connections）——先前只读 connections，致 workflow 图的边全部不可见，
  // 反向报成“码有据而图未画”漏边（knifeseq e4 实测误报）。两形并入同一口径。
  for (const c of [...(d.connections || []), ...(d.edges || [])]) {
    if (!c || !c.from || !c.to) continue;
    const ek = explicitKindOf(c);
    if (ek.kind) kindDeclaredTyped += 1;
    else if (ek.declared === null) kindUndeclared += 1; else kindDeclaredUnknown += 1;
    connections.push({
      spec: path.basename(sp),
      id: c.id || null,
      from: String(c.from),
      to: String(c.to),
      label: c.label || '',
      kind: ek.kind,
      declaredKind: ek.declared,
      kindField: ek.field,
    });
  }
}
const ledger = { nodes: {} };
for (const sc of sidecars) {
  let d;
  try { d = JSON.parse(fs.readFileSync(sc, 'utf8')); } catch (e) { fail('侧车非合法 JSON：' + sc + '（' + e.message + '）'); }
  Object.assign(ledger.nodes, d.nodes || {});
}
const anchoredFiles = (id) => {
  const n = ledger.nodes[id];
  if (!n) return null;
  // 锚文件一律取绝对路径（缺陷8）：旧相对锚（读方按 cwd 解析）会让 repoRootOf/path.relative/
  // spec 归属比较三处口径不一致，进而误判 specAnchored 或丢掉多归属映射。
  return (n.evidence || [])
    .map((l) => String(l).match(/^(.*):(\d+)$/)?.[1])
    .filter(Boolean)
    .map((f) => path.resolve(f));
};

// ---------- codegraph 只读口 ----------
function openDb(repoPath) {
  if (!DatabaseSync) return { err: 'node:sqlite 不可用（需 Node ≥22）' };
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) return { err: '无 codegraph 索引（' + dbPath + '）' };
  try { return { db: new DatabaseSync(dbPath, { readOnly: true }) }; } catch (e) { return { err: '索引打不开：' + e.message }; }
}

// 两个方向各查一次，返回各自出现的 edge kind 集合（不含 contains）。
// 方向是判据的一部分（缺陷8）：只有"画的方向上真有边"才算方向已证；仅反向有边 = 方向未证。
function dbEdgeKinds(db, fromRelFiles, toRelFiles) {
  const out = { forward: new Set(), reverse: new Set() };
  if (fromRelFiles.length === 0 || toRelFiles.length === 0) return out;
  const f = fromRelFiles.map(() => '?').join(',');
  const t = toRelFiles.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT DISTINCT e.kind AS kind FROM edges e
     JOIN nodes s ON e.source = s.id JOIN nodes t ON e.target = t.id
     WHERE e.kind != 'contains' AND s.file_path IN (${f}) AND t.file_path IN (${t})`
  );
  for (const row of stmt.all(...fromRelFiles, ...toRelFiles)) if (row && EDGE_KINDS.has(row.kind)) out.forward.add(row.kind);
  for (const row of stmt.all(...toRelFiles, ...fromRelFiles)) if (row && EDGE_KINDS.has(row.kind)) out.reverse.add(row.kind);
  return out;
}

// ---------- 判定 ----------
const findings = [];
/** 方向+类型双证（图边显式声明了可映射 kind，且该 kind 在图上所画方向上存在） */
let typedDirectionalHits = 0;
/** 文件级方向提名（图上所画方向存在非 contains 边；类型未声明/不可映射 ⇒ 类型记为 unchecked，不称已校准） */
let directionalFileLevelHits = 0;
/** 仅反向有同类边：文件级有关系，但**方向未证**（不并入上面的提名，单列） */
let reverseOnly = 0;
/** 有边（任一方向）但类型与图边显式声明不符 */
let kindMismatch = 0;
let ungrounded = 0;
/** 已声明非账本实体（架构构件/局部标签）的端点边——与 ungrounded 分列（口径：码证据不适用，非缺陷） */
let ungroundedDeclared = 0;
let withoutEvidence = 0;
/** 跨仓边计数（两端锚分属不同仓——本提名器只做同仓核对，跨仓归人工；2026-09-10 triage 分拆） */
let crossRepo = 0;
/** 两端锚**确实指向本次传入的 spec 文件**且该仓无代码索引——码证据不适用 */
let specAnchored = 0;
/** 两端锚同处一仓但该仓无代码索引，且锚不是本次 spec 文件——**未检查**（不冒充 spec 自锚） */
let noIndexAnchored = 0;
let withoutEdge = 0;
/** 漏边提名里「一端或两端有多于一个归属节点」的条数（归属不唯一，须人工判定，不当唯一认领） */
let withoutEdgeMultiOwner = 0;
/** 漏边提名按「两锚文件类型」计数（事实标註；2026-09-10 triage 加） */
const byClass = {};
const naRepos = new Set();

/**
 * 锚文件类型（doc/spec/sql/test/script/src/other）——只做事实分类，不裁决语义。
 * 用途：漏边提名里「src+src」占比高但节点对若是工作项/记录类（节点=批次/债/
 * 性能项，锚=该项动过的文件），两锚互引只说明两项动过同一片码，**不蕴含图上
 * 应有连线**（图语义=工作项依赖，非组件调用）。行动政策见 runbook 图码纪律节。
 */
const fileClassOf = (p) => {
  const s = String(p).toLowerCase();
  if (s.endsWith('.md')) return 'doc';
  if (s.endsWith('.sql')) return 'sql';
  if (s.endsWith('.json') || s.endsWith('.tsv')) return 'spec';
  if (s.includes('.test.') || s.includes('.spec.') || s.includes('/__tests__/')) return 'test';
  if (s.startsWith('scripts/') || s.includes('/scripts/')) return 'script';
  if (/(\.ts|\.tsx|\.mjs|\.js|\.jsx)$/.test(s)) return 'src';
  return 'other';
};
const edgeNominationClass = (a, b) => {
  const pair = [fileClassOf(a), fileClassOf(b)].sort();
  return `${pair[0]}+${pair[1]}`;
};

/** 索引可用性缓存（每仓只探测一次；无索引仓的锚不作码证据） */
const indexCache = new Map();
/** 未检查范围披露（口径纪律：说清"没查什么"，不承诺全图语义） */
const unchecked = { ungrounded: 0, ungroundedDeclared: 0, crossRepo: 0, specAnchored: 0, noIndexAnchored: 0, withoutEvidence: 0 };

for (const conn of connections) {
  const af = anchoredFiles(conn.from);
  const bf = anchoredFiles(conn.to);
  if (!af || !bf || af.length === 0 || bf.length === 0) {
    // 2026-09-14（A 批）：两端均在非账本实体声明内 ⇒ 属「码证据不适用」，与真缺账分列
    if (declaredNonAccounts.has(conn.from) && declaredNonAccounts.has(conn.to)) {
      ungroundedDeclared += 1;
      unchecked.ungroundedDeclared += 1;
      findings.push({ rule: 'edge-ungrounded-declared', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
        evidence: `边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）两端均为**已声明非账本实体**（架构构件/图内局部标签）⇒ 码证据不适用；声明件 ${NONACCOUNTS_PATH}` });
      continue;
    }
    ungrounded += 1;
    unchecked.ungrounded += 1;
    findings.push({ rule: 'edge-ungrounded', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
      evidence: `边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）端点无账或无锚，不可核对` });
    continue;
  }
  const byRepo = (files) => {
    const m = new Map();
    for (const f of files) {
      const root = repoRootOf(f);
      if (!root) continue;
      if (!m.has(root)) m.set(root, []);
      m.get(root).push(path.relative(root, f));
    }
    return m;
  };
  const ra = byRepo(af);
  const rb = byRepo(bf);
  const kindsF = new Set();
  const kindsR = new Set();
  let indexedSharedRepo = false;
  let indexedRootCount = 0;
  const seenRoots = new Set();
  for (const root of ra.keys()) seenRoots.add(root);
  for (const root of rb.keys()) seenRoots.add(root);
  // 索引可用性探测（缓存）：无索引仓的锚只是文件事实，不能当码证据用
  for (const root of seenRoots) {
    if (!indexCache.has(root)) {
      const probe = openDb(root);
      if (probe.err) { indexCache.set(root, false); naRepos.add(path.basename(root)); }
      else { indexCache.set(root, true); probe.db.close(); }
    }
    if (indexCache.get(root)) indexedRootCount += 1;
  }
  for (const [root, fa] of ra) {
    if (!rb.has(root)) continue; // 异仓边本提名器不可见（跨仓归人工）
    if (!indexCache.get(root)) continue; // 共享仓但无索引：不能当码证据
    const opened = openDb(root);
    if (opened.err) { naRepos.add(path.basename(root)); continue; }
    indexedSharedRepo = true;
    const got = dbEdgeKinds(opened.db, fa, rb.get(root));
    for (const k of got.forward) kindsF.add(k);
    for (const k of got.reverse) kindsR.add(k);
    opened.db.close();
  }
  if (!indexedSharedRepo && indexedRootCount >= 2) {
    // 两端锚分属 ≥２ 个「有索引」的仓：同仓索引结构上不可能命中（跨仓归人工）。
    // 2026-09-10 triage 实证：demo-b 全 34 图的 31 条「无据边」里此类与自锚类混同。
    crossRepo += 1;
    unchecked.crossRepo += 1;
    findings.push({ rule: 'edge-cross-repo-manual', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
      evidence: `图边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）两端锚分属不同仓（均有代码索引）——同仓索引不可见（提名器设计如此），归人工核对两端锚行是否真支撑该连线`,
      supportedFixes: ['人工核对：是否有跨仓实物（包依赖/脚本调用/HTTP 契约文件）；有则给两端补该实物为锚，无则删边'] });
    continue;
  }
  if (!indexedSharedRepo && indexedRootCount < 2) {
    // 两端锚同处一仓且该仓无代码索引：**只有锚确实指向本次传入的 spec 文件**才叫「图内自锚」，
    // 否则只是「无索引未检查」（缺陷8：旧实现把这一类一律写成 spec 自锚，属于过度声称）。
    const pointsAtSpec = [...af, ...bf].some((f) => specAbs.has(path.resolve(f)));
    if (pointsAtSpec) {
      specAnchored += 1;
      unchecked.specAnchored += 1;
      findings.push({ rule: 'edge-spec-anchored', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
        evidence: `图边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）两端锚指向图/spec 自身（本次已传入的 spec 文件）——码证据不适用；若该边本应有码支撑，请给端点补码锚`,
        supportedFixes: ['给端点补码/文档实物锚（替代或叠加 spec 自锚）；若为声明性关系则保留并在规程里标该类'] });
    } else {
      noIndexAnchored += 1;
      unchecked.noIndexAnchored += 1;
      findings.push({ rule: 'edge-no-index-unchecked', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
        evidence: `图边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）两端锚同处一仓但该仓无代码索引（锚不是本次传入的 spec 文件）——**未检查**（不是"图内自锚"，也不是"无据"）；补 codegraph 索引或人工核对`,
        supportedFixes: ['对该仓跑 codegraph sync 后重跑本脚本；或人工核对两端锚行'] });
    }
    continue;
  }
  const forwardHit = kindsF.size > 0;
  const reverseHit = kindsR.size > 0;
  // 类型判定：只有图边**显式声明且可映射**时才比对；未知/未声明一律不做通过性判定（不伪通过）。
  if (conn.kind !== null) {
    if (kindsF.has(conn.kind)) { typedDirectionalHits += 1; continue; }
    if (kindsR.has(conn.kind)) {
      reverseOnly += 1;
      findings.push({ rule: 'edge-direction-unverified', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
        evidence: `图边 ${conn.from}→${conn.to} 声明 kind=${conn.kind}，该类型只在**反向**（${conn.to}→${conn.from}）出现——文件级有关系，但图上所画方向未证；人工核对方向后决定改向或删边`,
        supportedFixes: ['实读两端锚行确认调用/依赖方向；方向确实相反则改图，无关系则删边'] });
      continue;
    }
    if (forwardHit || reverseHit) {
      kindMismatch += 1;
      findings.push({ rule: 'edge-kind-mismatch', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
        evidence: `图边 ${conn.from}→${conn.to} 声明 kind=${conn.kind}，但索引里存在的是 ${[...new Set([...kindsF, ...kindsR])].join('/')}——类型与声明不符（I 级提名：先实读再改图或改声明）`,
        supportedFixes: ['实读两端锚行确认实际关系类型；改图边声明，或删边'] });
      continue;
    }
    withoutEvidence += 1;
    unchecked.withoutEvidence += 1;
    findings.push({ rule: 'edge-without-code-evidence', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
      evidence: `图边 ${conn.from}→${conn.to}（声明 kind=${conn.kind}）在同仓索引里既无该类型也无任何非 contains 边——I 级提名：不证明码无此边，但值得复核两端锚行是否真支撑这条连线`,
      supportedFixes: ['实读两端锚行核对；确无此关系则删边，确有关系则给端点补更准的锚'] });
    continue;
  }
  if (forwardHit) { directionalFileLevelHits += 1; continue; }
  if (reverseHit) {
    reverseOnly += 1;
    findings.push({ rule: 'edge-direction-unverified', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
      evidence: `图边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）在索引里只有**反向**边（${conn.to}→${conn.from}，类型 ${[...kindsR].join('/')}）——文件级有关系，方向未证；人工核对后决定改向或删边`,
      supportedFixes: ['实读两端锚行确认依赖方向；方向确实相反则改图，无关系则删边'] });
    continue;
  }
  withoutEvidence += 1;
  unchecked.withoutEvidence += 1;
  findings.push({ rule: 'edge-without-code-evidence', severity: 'warning', subject: conn.id || `${conn.from}→${conn.to}`,
    evidence: `图边 ${conn.from}→${conn.to}（${conn.label || '无标签'}）在同仓索引里无调用/引用边——I 级提名：不证明码无此边，但值得复核两端锚行是否真支撑这条连线`,
    supportedFixes: ['实读两端锚行核对；确无此关系则删边，确有关系则给端点补更准的锚'] });
}

// 漏边：同仓锚文件间有边而图上无连线。
// 归属（缺陷8）：一文件可被多个节点锚定——旧实现 Map last-wins 静默丢归属，现在 Set 多归属 +
// 逐对提名 + multiOwner 计数（归属不唯一时该提名只是候选，须人工判定，不当唯一认领）。
const fileToComponents = new Map();
for (const [id, node] of Object.entries(ledger.nodes)) {
  for (const l of node.evidence || []) {
    const m = String(l).match(/^(.*):(\d+)$/);
    if (!m) continue;
    const abs = path.resolve(m[1]); // 与 anchoredFiles 同口径（绝对路径键，避免相对锚丢映射）
    if (!fileToComponents.has(abs)) fileToComponents.set(abs, new Set());
    fileToComponents.get(abs).add(id);
  }
}
const edgeKey = new Set(connections.map((c) => `${c.from}→${c.to}`));
const byRepoAll = new Map();
for (const f of fileToComponents.keys()) {
  const root = repoRootOf(f);
  if (!root) continue;
  if (!byRepoAll.has(root)) byRepoAll.set(root, []);
  byRepoAll.get(root).push(path.relative(root, f));
}
let leakScanTruncated = false;
let leakRowsScanned = 0;
for (const [root, relFiles] of byRepoAll) {
  const opened = openDb(root);
  if (opened.err) { naRepos.add(path.basename(root)); continue; }
  const uniq = [...new Set(relFiles)].sort(); // 确定顺序（ORDER BY 同序），不依赖目录遍历顺序
  if (uniq.length < 2) { opened.db.close(); continue; }
  const marks = uniq.map(() => '?').join(',');
  const rows = opened.db.prepare(
    `SELECT DISTINCT s.file_path sf, t.file_path tf FROM edges e
     JOIN nodes s ON e.source = s.id JOIN nodes t ON e.target = t.id
     WHERE e.kind != 'contains' AND s.file_path IN (${marks}) AND t.file_path IN (${marks}) AND s.file_path != t.file_path
     ORDER BY s.file_path, t.file_path
     LIMIT ${CAP * 4 + 1}`
  ).all(...uniq, ...uniq);
  opened.db.close();
  // 截断披露：取 CAP*4+1 探测越界；命中即如实标注本轮扫描被截断（不再静默）。
  if (rows.length > CAP * 4) { leakScanTruncated = true; rows.length = CAP * 4; }
  leakRowsScanned += rows.length;
  let n = 0;
  for (const r of rows) {
    if (n >= CAP) break;
    const cas = fileToComponents.get(path.resolve(root, r.sf));
    const cbs = fileToComponents.get(path.resolve(root, r.tf));
    if (!cas || !cbs) continue;
    const multiOwner = cas.size > 1 || cbs.size > 1;
    for (const ca of cas) {
      for (const cb of cbs) {
        if (n >= CAP) break;
        if (ca === cb) continue;
        if (edgeKey.has(`${ca}→${cb}`) || edgeKey.has(`${cb}→${ca}`)) continue;
        withoutEdge += 1;
        n += 1;
        if (multiOwner) withoutEdgeMultiOwner += 1;
        // triage 分类（2026-09-10）：本轮全图 triage 实证——提名绝大多数落在
        // 工作项/记录类节点（节点=批次/债/性能项，其锚=该项动过的源码文件），
        // 此时两锚文件互引只说明「两项动过同一片码」，**不蕴含图上应有边**
        // （图语义=工作项依赖/记录关系，非组件调用）。分类只做事实标註，
        // 不改变提名口径（仍全量报出）；行动政策见 runbook 图码纪律节。
        const cls = edgeNominationClass(r.sf, r.tf);
        byClass[cls] = (byClass[cls] || 0) + 1;
        findings.push({ rule: 'code-evidence-without-edge', severity: 'warning', subject: `${ca}→${cb}`,
          evidence: `码上有据（${r.sf} ↔ ${r.tf}）而图上无边——候选漏边（I 级提名：先实读两文件确认关系再决定是否入图；分类=${cls}${multiOwner ? '；归属不唯一：该文件被多个节点锚定，候选对须人工判定' : ''}）` });
      }
    }
  }
}

const data = {
  proofLevel: 'file-level-nomination', // 文件级提名，非语义证明（方向/类型只在明载条件下判定）
  connections: connections.length,
  typedDirectionalHits,
  directionalFileLevelHits,
  reverseOnly,
  kindMismatch,
  kindDeclared: { typed: kindDeclaredTyped, unknown: kindDeclaredUnknown, undeclared: kindUndeclared },
  ungrounded, ungroundedDeclared, withoutEvidence, crossRepo, specAnchored, noIndexAnchored, withoutEdge,
  withoutEdgeMultiOwner,
  nonAccountsPath: NONACCOUNTS_PATH,
  nonAccountsDeclared: declaredNonAccounts.size,
  withoutEdgeByClass: byClass,
  noIndexRepos: [...naRepos],
  nominationTruncated: { truncated: leakScanTruncated, scannedRows: leakRowsScanned, cap: CAP * 4 },
  coverage: {
    checked: typedDirectionalHits + directionalFileLevelHits + reverseOnly + kindMismatch + withoutEvidence,
    checkedNote: 'checked = 做了同仓索引比对的连接数（其余见 unchecked：未检查或码证据不适用）',
    unchecked,
    uncheckedNote: '未检查范围：ungrounded=端点无账/无锚；ungroundedDeclared=已声明非账本实体；crossRepo=跨仓归人工；'
      + 'specAnchored=锚为本次 spec 自身；noIndexAnchored=无索引仓且锚非 spec（真未检查）；withoutEvidence=同仓无该边；'
      + (leakScanTruncated ? '漏边扫描本轮被截断（nominationTruncated.truncated=true），未覆盖全部锚文件对' : '漏边扫描未截断'),
  },
  ...(connections.length === 0 ? { note: 'spec 无 connections——本报告是"无对象"，不是"全部有边"' } : {}),
};
const receipt = { schemaVersion: 1, command: 'reconcile-graph-edges', status: 'ok',
  data: { ...data },
  diagnostics: findings };
if (JSON_OUT) console.log(JSON.stringify(receipt, null, 2));
else {
  const classStr = Object.entries(byClass).map(([k, v]) => `${k}=${v}`).join(' · ') || '无';
  console.log(`edge-reconcile ok（文件级提名，非语义证明）：连接 ${data.connections} · 方向+类型双证 ${typedDirectionalHits} · 文件级方向提名 ${directionalFileLevelHits} · 仅反向 ${reverseOnly} · 类型不符 ${kindMismatch} · 无端点 ${ungrounded}（已声明非账本实体 ${ungroundedDeclared}） · 同仓无据 ${withoutEvidence} · 跨仓边 ${crossRepo} · 图内自锚 ${specAnchored} · 无索引未检查 ${noIndexAnchored} · 漏边 ${withoutEdge}（归属不唯一 ${withoutEdgeMultiOwner}） · N/A 仓 ${naRepos.size}`);
  console.log(`  类型声明面：显式可映射 ${kindDeclaredTyped} · 显式不可映射 ${kindDeclaredUnknown} · 未声明 ${kindUndeclared}（未声明的连接不做类型判定）`);
  console.log(`  漏边分类（事实标註，不改提名口径）：${classStr}${leakScanTruncated ? ' ｜本轮漏边扫描已截断（cap=' + CAP * 4 + ' 行）' : ''}`);
  for (const f of findings.slice(0, CAP * 2)) console.log(`  [${f.severity}] ${f.subject} ${f.evidence}`.trim());
  if (findings.length > CAP * 2) console.log(`  …另 ${findings.length - CAP * 2} 条（--cap 可调）`);
}
process.exit(STRICT && findings.length > 0 ? 1 : 0);
