// report（command-contract.md §6）：销账回执汇总（一刀的机器证据）。
// A3 硬门禁：progress=verified 且无证据 = error；缺 SHA = warning（不阻断）。
// 2026-09-15（缺陷3）：**默认面**（不传 --spec）同样拦「完成声称 + 不可解析锚」——
//   声称对齐实相（verified/settled/truth∈{effective,closed}）且携带 broken/不可解析锚 ⇒ error evidence_unresolvable
//   （此前只有 --spec 时才由 A1 报 a1-evidence-broken，默认面 exit 0 掩盖不存在的证据文件）。
// A1 图码对账（specs/ADD-SPEC.md §四 A1；仅当显式提供 --spec 时启用，不改变既有调用方语义）：
//   a) 声称对齐实相（verified / settled / truth∈{effective,closed}）而证据数为 0 → error a1-missing-evidence；
//   b) in_progress/blocked 无证据（未声称对齐）→ warning a1-weak-assertion；
//   c) 声称对齐节点携带失效 locator = 图与码矛盾 → error a1-evidence-broken；
//   c-drift) 声称对齐节点携带漂移锚（行在界但内容哈希不匹配，缺口② 2026-08-16）→ warning a1-evidence-drifted
//      （图码矛盾未证实但复核义务成立；无哈希锚=unhashed 不发声，存量容忍）；
//   d) 双向 id 对账（归一化 + specRefs 认领 + 按图作用域的非账本实体声明）→ warning a1-unmatched-account /
//      a1-diagram-local-id / a1-ambiguous-id（歧义不绑定）；node.kind='meta' 的账务/元节点跳过 d 项
//      （2026-08-15 裁定②；a/b/c 证据规则对 meta 节点照查不豁免，豁免数计入 a1.metaExempted）。
// 2026-09-15（缺陷4）：d 项改用 lib/spec-id.mjs 的单一解析入口（与 compile、settle 绑定同源）；
//   nonAccounts 按**图作用域**（分组键=图名）解释，specRefs 支持 `<图名>/<图内id>` 限定；
//   class 豁免只表示「不参与绑定核对」，不再据此推断「应上图」——分母/豁免/实际匹配全部如实入 coverage。

import fs from 'node:fs';
import path from 'node:path';
import { lintLocators, anchorState, checkVerifiedHeadAnchors } from './evidence.mjs';
import { crossAxisUnlisted, CLASS_STATES } from './state-machine.mjs';
import { buildLedgerIndex, resolveSpecBinding, parseSpecRef } from './spec-id.mjs';

/**
 * 不参与图绑定核对的 class 集（口径收窄，2026-09-10）：图=架构/流程**投影**，非台账镜像。
 * 当前 7 类 class 皆非“应上图的结构件”，故均入本集；未分类节点（结构性件）仍报 a1-unmatched-account。
 * 注意（缺陷4）：这是**豁免口径**，不代表这些节点「已核对/已上图」——计数如实入 a1.coverage。
 */
const NON_DIAGRAM_CLASSES = new Set(CLASS_STATES);

import { summarizeReplay } from './trace.mjs';

const A1_NON_CLAIMS = [
  'truth 轴业务生效性（effective/closed 是否属实）需负责人回执，机器不可判',
  '证据校验仅静态 lint（文件存在+行号在界），不验证证据内容与代码语义一致',
  '锚行哈希只证行内容未变（ok/drifted 三态判定），不证行内容对节点声称的语义支撑；且同内容重复行之间的锚位移不可测（哈希相同则判 ok，2026-08-16 督导 F2）',
  '图账交叉按 component/node id 精确匹配（辅以 demo-b- 前缀/大小写归一化与 specRefs 显式认领），不判语义等价或别名',
  'A1 图账交叉仅在「图节点 id 即账节点 id」约定成立时有信号——图=结构实体、账=工作切片的项目（如治理型项目）不满足该约定，d 项 unmatched/unaccounted 与 compile 注入将全为噪声；处置建议：不传 --spec 停用 A1，或建立 id 映射纪律后启用（2026-08-17 demo-b holdout 对抗实验实证；适用边界，非缺陷）',
  'boundary/connection 拓扑正确性不在 A1 对账范围（未提供语义基准）',
  'meta 节点豁免图账交叉（负责人裁定② 2026-08-15），豁免数见 metaExempted（仅豁免 d 项，a/b/c 照查）',
  'a1.coverage 的 class 豁免只声明「不参与绑定核对」，不证明这些节点已上图或已核对；分母 = ledgerNodes - metaExempted 如实给数，不据此推断任何节点「应上图」（图=投影，非台账镜像）',
  '归一化歧义（账本存在多个仅差 demo-b-/大小写的节点，或同一图件 id 被多个节点认领）一律不绑定，只报 a1-ambiguous-id（2026-09-15 缺陷4；不静默误绑）',
  'evidenceHead.verdict 只描述本次「工作树 vs git HEAD」比对的覆盖与结果：exempt（gitignored / no-git）与 unchecked（broken / unparseable）都不是「已核验一致」；checkedAnchors=0 时不构成任何一致性证明（2026-09-15 缺陷3）',
  '漂移锚（drifted）不阻断完成声称（最小安全语义：行仍在，内容变更可能是合法的后续编辑）——只发 warning 要求复核；不可解析锚（broken）才是阻断项',
];

/**
 * 销账链的图绑定状态（P1 余项，2026-09-11）：settle 回执直接携带「该节点落在哪些图上」，
 * 让图账绑定从**审计动作**变**销账副产物**（《N14 图面绑定呈件》§四.1）。
 *
 * 判据与 A1 反向面同源：经 lib/spec-id.mjs 单一解析入口（精确 → 归一化唯一 → specRefs 认领，
 * 且图限定 ref 只在图名匹配时生效）。目录派生：<侧车目录>/../spec/<项目>/<图>.json
 * （扫全部项目子目录，兼容项目侧车与聚合侧车）。只读、失败降级 no-specs —— **绝不阻断销账**。
 */
export function bindingStatusFor(nodeId, specRefs, sidecarPath, nodes) {
  const res = { verdict: 'no-specs', diagrams: [], checked: 0, via: null, ambiguous: [] };
  if (!sidecarPath) return res;
  // 必须用**全账本**视图解析（缺陷4 修正）：单节点视图看不见其他节点造成的归一化/ref 冲突，
  // 会让 settle 报 bound 而全账 report/compile 判 ambiguous——两个口径又分叉。缺账本视图即明说。
  if (!nodes || typeof nodes !== 'object') return { ...res, verdict: 'no-ledger' };
  const specRoot = path.resolve(path.dirname(sidecarPath), '..', 'spec');
  let projects;
  try { projects = fs.readdirSync(specRoot, { withFileTypes: true }); } catch { return res; }
  let view = nodes;
  const existing = Object.hasOwn(nodes, nodeId) ? nodes[nodeId] : null;
  if (Array.isArray(specRefs) && (!existing || existing.specRefs !== specRefs)) {
    view = { ...nodes, [nodeId]: { ...(existing || {}), specRefs: specRefs.map(String) } };
  }
  const index = buildLedgerIndex(view);
  const diagrams = new Set();
  const ambiguous = [];
  let via = null;
  let checked = 0;
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(specRoot, p.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      let sp;
      try { sp = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      checked += 1;
      const name = f.replace(/\.json$/, '');
      // 与 A1 同源：图件 id 同时取 components[] 与 states[]（lifecycle/状态机图的状态无 components）。
      const parts = [];
      if (sp && Array.isArray(sp.components)) parts.push(...sp.components);
      if (sp && Array.isArray(sp.states)) parts.push(...sp.states);
      for (const c of parts) {
        const cid = c && c.id ? String(c.id) : '';
        if (cid.length === 0) continue;
        const r = resolveSpecBinding({ nodes: view, index, specId: cid, specName: name });
        if (r.nodeId === nodeId) {
          diagrams.add(name);
          if (via === null) via = r.via;
        } else if (r.ambiguous.some((x) => x.nodeId === nodeId)) {
          ambiguous.push({ diagram: name, id: cid, candidates: r.ambiguous.map((x) => x.nodeId) });
        }
      }
    }
  }
  res.checked = checked;
  if (checked === 0) return res;
  res.diagrams = [...diagrams].sort();
  res.via = via;
  res.ambiguous = ambiguous;
  // 歧义（本节点是多个候选之一）= 不绑定，单列 verdict 'ambiguous'（与 report/compile 同判据）。
  res.verdict = res.diagrams.length > 0 ? 'bound' : (ambiguous.length > 0 ? 'ambiguous' : 'unbound');
  return res;
}

export function buildReport(sidecar, opts) {
  const opts_ = opts || {};
  const brief = !!opts_.brief;
  const nodes = sidecar.nodes || {};
  const ids = opts_.slice ? [opts_.slice] : Object.keys(nodes);
  const root = opts_.root || '.';
  const errors = [];
  const warnings = [];
  const rawSpecs = Array.isArray(opts_.specs) ? opts_.specs : [];
  const specNames = Array.isArray(opts_.specNames) ? opts_.specNames : [];
  // 图名（= 文件 basename 去扩展名）是 nonAccounts 分组键与 specRefs 图限定的作用域键；
  // 未提供（库调用）时 name=null：图限定 ref 不消解、nonAccounts 退回全图兼容语义，并在 coverage 披露。
  const specEntries = rawSpecs.map((doc, i) => ({
    name: specNames[i] === undefined || specNames[i] === null ? null : String(specNames[i]),
    ids: collectSpecIds(doc),
  }));
  const a1Active = specEntries.length > 0;
  const a1Errors = [];
  const a1Warnings = [];
  let stateChanges = 0;
  const nodeReports = [];
  for (const id of ids) {
    const node = Object.hasOwn(nodes, id) ? nodes[id] : null;
    if (!node) {
      errors.push(diag('node_not_found', '节点不存在：' + id, id, 'error'));
      continue;
    }
    const historyCount = (node.history || []).length;
    stateChanges += historyCount;
    const evidence = node.evidence || [];
    const lint = lintLocators(evidence, root);
    if (node.progress === 'verified' && evidence.length < 1) {
      errors.push(diag('verified_requires_evidence', 'A3：' + id + ' progress=verified 但证据为空', id, 'error'));
    }
    // 存量清洗（0.17.0，路线一裁定）：settled 必须可追溯到跨轴事件——settle（执行闭环）或 import（历史导入）；
    // 无事件 = 0.16.x 及更早 init 漏洞的直达赋值遗存或手工写账——提示补登/修正，warning 不阻断。
    if (node.ledger === 'settled') {
      const marked = (node.history || []).some((e) => e && (e.kind === 'settle' || e.kind === 'import'));
      if (!marked) {
        warnings.push(diag('import_unmarked', id + ' ledger=settled 但 history 无 settle/import 事件（存量直达赋值或手工写账遗存）——历史导入事实请用 state import 补登事件；误直达请用 state set --correction 修正', id, 'warning'));
      }
    }
    const unlisted = crossAxisUnlisted(node.progress, node.ledger);
    if (unlisted) {
      warnings.push(diag('cross_axis_unlisted', id + ' progress=' + node.progress + ' × ledger=' + node.ledger + ' 不在 ADD-SPEC §2.4.1 组合表内（' + unlisted + '）——存量统计期只警示不阻断；补救 = state set --correction 修正其中一轴，或经 state settle/import 事件', id, 'warning'));
    }
    const claimed = claimedAxes(node);
    if (a1Active && claimed) {
      if (evidence.length === 0) {
        a1Errors.push(diag('a1-missing-evidence', 'A1：' + id + ' 声称对齐实相（' + claimed + '）但证据数为 0', id, 'error'));
      }
      if (lint.invalid > 0) {
        a1Errors.push(diag('a1-evidence-broken', 'A1：' + id + ' 声称对齐实相（' + claimed + '）但携带 ' + lint.invalid + ' 条失效证据 locator（图与码矛盾）', id, 'error'));
      }
      // 锁口②（2026-08-16）：漂移锚（行在界但内容哈希不匹配）→ warning——图码矛盾未证实（行还在，内容已变），
      // 但复核义务成立；无哈希锚=unhashed 不发声（存量容忍，不算 drifted）。漂移不阻断（见 nonClaims）。
      const meta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
      const driftedCount = evidence.filter((loc) => anchorState(loc, meta[loc], root) === 'drifted').length;
      if (driftedCount > 0) {
        a1Warnings.push(diag('a1-evidence-drifted', 'A1：' + id + ' 声称对齐实相（' + claimed + '）但携带 ' + driftedCount + ' 条漂移锚（图码矛盾未证实但复核义务成立：目标行内容已漂移，复核后重新 evidence-add 钉新哈希）', id, 'warning'));
      }
    } else if (claimed) {
      // 默认面（未传 --spec）完成声称守卫（缺陷3）：证据有效性不依赖 spec——这正是
      // 「不存在文件 → evidence-add → settle → report exit 0」的封口。两条并查：
      //   ① 零证据却声称对齐（truth∈{effective,closed} / ledger=settled 而 progress 非 verified 的形态——
      //      progress=verified 的空证据由上方形如 A3 的 verified_requires_evidence 覆盖，不重复发码）；
      //   ② 有锚但锚不可解析（文件缺/行越界/格式坏）。
      if (evidence.length === 0 && node.progress !== 'verified') {
        errors.push(diag('evidence_missing', 'A3：' + id + ' 声称对齐实相（' + claimed + '）但证据数为 0——完成声称必须至少绑定 1 条可解析证据（先 state evidence-add/state import）', id, 'error'));
      }
      const broken = brokenEvidenceOf(lint);
      if (broken.length > 0) {
        errors.push(diag('evidence_unresolvable', 'A3：' + id + ' 声称对齐实相（' + claimed + '）但携带 ' + broken.length + ' 条不可解析证据：' + describeBroken(broken) + '——完成声称必须锚定可解析证据（补救：state evidence-add 修正锚，或 state evidence-reanchor 换锚）', id, 'error'));
      }
    } else {
      if (a1Active && (node.progress === 'in_progress' || node.progress === 'blocked') && evidence.length === 0) {
        a1Warnings.push(diag('a1-weak-assertion', 'A1：' + id + ' progress=' + node.progress + ' 无证据（断言未声称对齐实相，降级警告）', id, 'warning'));
      }
      if (lint.invalid > 0) {
        warnings.push(diag('evidence_lint_warnings', id + ' 有 ' + lint.invalid + ' 条证据未通过 lint', id, 'warning'));
      }
    }
    nodeReports.push({
      node: id,
      owner: node.owner,
      truth: node.truth,
      progress: node.progress,
      ledger: node.ledger,
      state_changes: historyCount,
      evidence: { valid: lint.valid, invalid: lint.invalid, diagnostics: lint.diagnostics },
    });
  }
  // ---------- A1 d 项：双向 id 对账（单一解析入口 + 按图作用域）----------
  let metaExempted = 0;
  let classExempted = 0;
  let diagramLocalIds = 0;
  let nonAccountDeclared = 0;
  let matched = 0;
  let unmatchedUnclassified = 0;
  let unscopedRefs = 0;
  let unscopedCrossDiagram = 0;
  let ambiguousIds = 0;
  const ledgerNodes = Object.keys(nodes).length;
  const specIdSet = new Set();
  for (const spec of specEntries) for (const sid of spec.ids) specIdSet.add(sid);
  // 每个图件 id 出现在哪些图（供「未限图 specRefs 跨图生效」的披露）
  const idDiagrams = new Map();
  for (const spec of specEntries) {
    for (const sid of spec.ids) {
      if (!idDiagrams.has(sid)) idDiagrams.set(sid, new Set());
      if (spec.name !== null) idDiagrams.get(sid).add(spec.name);
    }
  }
  for (const node of Object.values(nodes)) {
    if (node && Array.isArray(node.specRefs)) {
      for (const ref of node.specRefs) if (parseSpecRef(ref).diagram === null) unscopedRefs += 1;
    }
  }
  // 非账本实体声明（P4，2026-09-11）：<侧车同目录>/diagram-nonaccounts.json 的**分组键=图名**，
  // 声明该图内哪些组件 id 是架构构件/图内局部标签、不要求账本记账（图=投影，非台账镜像）。
  // 作用域（缺陷4）：只在该图内生效——旧实现把所有分组的 id 并成一个全局集合，导致 A 图声明的局部 id
  // 在 B 图同样被豁免（跨图同局部 ID 误豁免）。
  const declaredNonAccounts = new Map();
  if (opts_.nonAccountsPath) {
    const parsed = (() => { try { return JSON.parse(fs.readFileSync(opts_.nonAccountsPath, 'utf8')); } catch { return null; } })();
    const groups = parsed && parsed.nonAccounts && typeof parsed.nonAccounts === 'object' ? parsed.nonAccounts : {};
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      const gids = g && Array.isArray(g.ids) ? g.ids : [];
      if (!declaredNonAccounts.has(key)) declaredNonAccounts.set(key, new Set());
      for (const gid of gids) declaredNonAccounts.get(key).add(String(gid));
    }
  }
  const nonAccountsScoped = specEntries.length > 0 && specEntries.every((s) => s.name !== null);
  let nonAccountUnscoped = 0;
  // 图名未知（库调用未提供 specNames）时**不豁免**：旧实现退回「全图声明生效」会掩盖作用域未知，
  // 正是跨图同局部 id 误豁免的来源。命中即计入 nonAccountUnscoped 并逐条披露（不静默放行）。
  const isDeclaredNonAccount = (sid, specName) => {
    if (specName === null) {
      for (const set of declaredNonAccounts.values()) {
        if (set.has(sid)) { nonAccountUnscoped += 1; return false; }
      }
      return false;
    }
    const set = declaredNonAccounts.get(specName);
    return Boolean(set && set.has(sid));
  };
  if (a1Active) {
    const ledgerIndex = buildLedgerIndex(nodes);
    const bindingCache = new Map();
    const bindingFor = (specName, sid) => {
      const key = (specName === null ? '' : specName) + '\0' + sid;
      if (!bindingCache.has(key)) bindingCache.set(key, resolveSpecBinding({ nodes, index: ledgerIndex, specId: sid, specName }));
      return bindingCache.get(key);
    };
    const matchedNodeIds = new Set();
    const ambiguousKeys = new Map(); // sid → { candidates, diagrams:Set }
    for (const spec of specEntries) {
      for (const sid of spec.ids) {
        const r = bindingFor(spec.name, sid);
        if (r.nodeId !== null) {
          matchedNodeIds.add(r.nodeId);
          // 未限图 ref 命中「多图都出现同名的图件 id」⇒ 该认领跨图生效，如实披露（不静默跨图绑定）
          if (r.via === 'spec-ref' && r.matchedRef !== null && parseSpecRef(r.matchedRef).diagram === null) {
            const diagrams = idDiagrams.get(sid);
            if (diagrams && diagrams.size > 1) unscopedCrossDiagram += 1;
          }
        } else if (r.ambiguous.length > 1) {
          const prev = ambiguousKeys.get(sid) || { candidates: r.ambiguous, diagrams: new Set() };
          if (spec.name !== null) prev.diagrams.add(spec.name);
          ambiguousKeys.set(sid, prev);
        }
      }
    }
    for (const [sid, info] of ambiguousKeys) {
      ambiguousIds += 1;
      const cands = info.candidates.map((c) => c.nodeId + '（' + c.via + '）').join('、');
      const where = info.diagrams.size > 0 ? '图 ' + [...info.diagrams].sort().join('/') : '图（图名未提供）';
      a1Warnings.push(diag('a1-ambiguous-id', 'A1：图件 ' + sid + '（' + where + '）可解析到多个账本节点：' + cands + '——歧义不绑定（不静默误绑）；处置 = 用 state spec-ref 显式认领，或改名消歧', sid, 'warning'));
    }
    // 正向面（账本节点 → 是否入图）
    for (const id of Object.keys(nodes)) {
      const node = nodes[id];
      if (node && node.kind === 'meta') {
        metaExempted += 1; // 裁定②：账务/元节点（记图本身与命令本身的账）不参与图账交叉对账（仅 d 项）
        continue;
      }
      if (matchedNodeIds.has(id)) { matched += 1; continue; }
      if (typeof node.class === 'string' && NON_DIAGRAM_CLASSES.has(node.class)) {
        // 口径收窄（2026-09-10）：class 已声明的节点不参与图绑定核对——图是投影，非台账镜像。
        // 缺陷4：这里是**豁免**不是「已核对/已上图」；计数入 coverage，不据此推断任何「应上图」。
        classExempted += 1;
        continue;
      }
      unmatchedUnclassified += 1;
      a1Warnings.push(diag('a1-unmatched-account', 'A1：侧车节点 ' + id + ' 未与任何已提供 spec 绑定（覆盖缺口，非已证实矛盾）', id, 'warning'));
    }
    // 反向面（图件 id → 是否入账）
    for (const spec of specEntries) {
      const seen = new Set();
      for (const sid of spec.ids) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        const r = bindingFor(spec.name, sid);
        if (r.nodeId !== null) continue; // 已入账（精确 / 归一化唯一 / specRefs 认领）
        if (r.ambiguous.length > 1) continue; // 已由 a1-ambiguous-id 发声，不重复计入 local id
        // A3（2026-09-10）：其余多为**图内局部标签**——单列一类并计数，不并入"账本缺节点"。
        if (isDeclaredNonAccount(sid, spec.name)) { nonAccountDeclared += 1; continue; }
        diagramLocalIds += 1;
        a1Warnings.push(diag('a1-diagram-local-id', 'A1：spec 组件 ' + sid + ' 无对应账本节点（归一化与 specRefs 均未命中）——若为图内局部标签可忽略；若确为实体请补节点或用 state spec-ref 认领', sid, 'warning'));
      }
    }
    if (nonAccountUnscoped > 0) {
      a1Warnings.push(diag('a1-nonaccounts-scope-unknown', 'A1：' + nonAccountUnscoped + ' 个图件 id 命中 diagram-nonaccounts.json 的声明，但本次调用未提供图名（specNames）——按作用域未知处理：**不豁免**（旧行为会全图豁免，正是跨图同局部 id 误豁免的来源）；库调用方请传 specNames（图名 = spec 文件名去扩展名；CLI 已总是传）', 'diagram-nonaccounts.json', 'warning'));
    }
  }
  errors.push(...a1Errors);
  warnings.push(...a1Warnings);
  // O2（2026-09-14 设计件 §2 O2）：锚对 HEAD 校验——只查 progress=verified 节点（未声称对齐不查）。
  // 工作树 ≠ HEAD 属 error 级诊断（a3-head-mismatch / a1-evidence-uncommitted）；gitignored（如
  // atlas artifacts/ 生成物）不可能入 HEAD，只入回执计数不发 error（否则类红永久，消息无处着陆）；
  // 无 git 仓记 noGit 不发声。不自动改锚（改锚消不掉工作树与 HEAD 的差异）。
  // 2026-09-15（缺陷3）：回执增 verdict——「无 error」不再被当成「已核验一致」：区分
  // verified（真比对通过）/ partial / unchecked-only（锚全不可比对）/ exempt-only（全免检）/ no-scope（零检查）。
  const headScope = Object.fromEntries(ids.filter((id) => Object.hasOwn(nodes, id) && nodes[id]).map((id) => [id, nodes[id]]));
  const headChecked = checkVerifiedHeadAnchors(headScope, root);
  errors.push(...headChecked.errors);
  warnings.push(...headChecked.warnings);
  const evidenceHead = {
    verdict: headChecked.verdict,
    ok: headChecked.ok, // ok = 无 error 且无未检查锚；verdict=no-scope/exempt-only 下的 ok 不构成一致性证明（见 nonClaims）
    checkedNodes: headChecked.checkedNodes,
    checkedAnchors: headChecked.checkedAnchors,
    checked: headChecked.checked,
    exempt: headChecked.exempt,
    unchecked: headChecked.unchecked,
    counts: headChecked.counts,
    uncommitted: headChecked.uncommitted.count,
    contentMismatch: headChecked.contentMismatch.count,
    gitignored: headChecked.gitignored.count,
    noGit: headChecked.noGit.count,
    noGitReasons: headChecked.noGitReasons,
    ...(brief ? {} : { samples: {
      uncommitted: headChecked.uncommitted.sample,
      contentMismatch: headChecked.contentMismatch.sample,
      gitignored: headChecked.gitignored.sample,
      noGit: headChecked.noGit.sample,
    } }),
  };
  const shas = {};
  if (opts_.codeSha) shas.code = opts_.codeSha;
  else warnings.push(diag('missing_code_sha', '未提供 --code-sha（销账回执建议附代码 SHA）', 'shas', 'warning'));
  if (opts_.specSha) shas.spec = opts_.specSha;
  else warnings.push(diag('missing_spec_sha', '未提供 --spec-sha（销账回执建议附图谱 SHA）', 'shas', 'warning'));
  const lessons = sidecar.lessons || [];
  const result = {
    slice: opts_.slice || '*',
    nodes: nodeReports,
    state_changes: stateChanges,
    shas,
    verify: opts_.verify || null,
    lessons: { count: lessons.length, rules: lessons.map((l) => l.rule).filter(Boolean) },
    evidenceHead,
    errors,
    warnings,
  };
  // A3（2026-08-15 清单）：--brief 只留计数摘要 + 全部 error 级诊断——节点数（receipts 计数=state_changes 保留）、
  // 错误数（errors 全文保留）、警告数降为计数、lessons 只留 count、a1 只留计数且 nonClaims 降为条数、
  // shas/verify/节点明细/warning 诊断全文/lessons 规则数组/replays 事件全文略去。exit 码语义不变。
  if (brief) {
    result.nodes = nodeReports.length;
    result.warnings = warnings.length;
    result.lessons = { count: lessons.length };
    delete result.shas;
    delete result.verify;
  }
  // B2（2026-08-15 清单）：--replay 焦点节点时间线摘要（可重复）；未知节点该条目带 error，不整体失败。
  const replayIds = Array.isArray(opts_.replays) ? opts_.replays : [];
  if (replayIds.length > 0) {
    result.replays = replayIds.map((id) => summarizeReplay(sidecar, id, undefined, brief));
  }
  if (a1Active) {
    const coverage = {
      ledgerNodes,
      metaExempted,
      denominator: ledgerNodes - metaExempted,
      matched,
      classExempted,
      unmatchedUnclassified,
      diagramLocalIds,
      nonAccountDeclared,
      ambiguous: ambiguousIds,
      unscopedRefs,
      unscopedCrossDiagram,
      nonAccountUnscoped,
      nonAccountsScope: nonAccountsScoped ? 'by-diagram' : 'unknown-scope-strict',
      note: '分母 = ledgerNodes - metaExempted（meta 不参与 d 项）；matched 已含归一化与 specRefs 认领；'
        + 'classExempted 只表示该节点不参与绑定核对，不代表已核对或应上图；'
        + 'nonAccountsScope=unknown-scope-strict 表示库调用未提供图名（specNames）：声明**不生效**（计入 nonAccountUnscoped），'
        + '不做全图豁免（CLI 调用总是按图名解析）',
    };
    result.a1 = {
      specs: specEntries.length,
      checkedNodes: ids.length,
      specComponentIds: specIdSet.size,
      errors: a1Errors.length,
      warnings: a1Warnings.length,
      metaExempted,
      classExempted,
      diagramLocalIds,
      nonAccountDeclared,
      coverage,
      nonClaims: brief ? A1_NON_CLAIMS.length : A1_NON_CLAIMS.slice(),
    };
  }
  return result;
}

function collectSpecIds(doc) {
  const ids = [];
  for (const comp of (doc && Array.isArray(doc.components) ? doc.components : [])) {
    if (comp && comp.id) ids.push(String(comp.id));
  }
  // 0.6.3：lifecycle 族 states 同样参与图账交叉对账（图账同 id 约定与 compile 一致）。
  for (const state of (doc && Array.isArray(doc.states) ? doc.states : [])) {
    if (state && state.id) ids.push(String(state.id));
  }
  return ids;
}

function brokenEvidenceOf(lint) {
  return lint.results.filter((r) => !r.ok).map((r) => ({ locator: r.locator, diagnostic: r.diagnostic }));
}

function describeBroken(broken) {
  // lintLocators 对每个 !ok 条目必带 diagnostic（单一实现），故不造兜底码（避免把 'unknown' 当错误码字面量）
  const sample = broken.slice(0, 3).map((b) => b.locator + '（' + (b.diagnostic ? b.diagnostic.rule : '') + '）').join('、');
  return sample + (broken.length > 3 ? ' 等 ' + broken.length + ' 条' : '');
}

// A1 声称对齐实相的判定：任一轴到达「已对齐」语义态即视为声称（返回触达轴描述，未触达返回 null）。
function claimedAxes(node) {
  const axes = [];
  if (node.progress === 'verified') axes.push('progress=verified');
  if (node.ledger === 'settled') axes.push('ledger=settled');
  if (node.truth === 'effective' || node.truth === 'closed') axes.push('truth=' + node.truth);
  return axes.length ? axes.join('，') : null;
}

function diag(rule, message, subject, severity) {
  return { rule, severity: severity || 'error', subject, evidence: message, supportedFixes: [] };
}
