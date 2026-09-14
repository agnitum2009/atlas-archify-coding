// report（command-contract.md §6）：销账回执汇总（一刀的机器证据）。
// A3 硬门禁：progress=verified 且无证据 = error；缺 SHA = warning（不阻断）。
// A1 图码对账（specs/ADD-SPEC.md §四 A1；仅当显式提供 --spec 时启用，不改变既有调用方语义）：
//   a) 声称对齐实相（verified / settled / truth∈{effective,closed}）而证据数为 0 → error a1-missing-evidence；
//   b) in_progress/blocked 无证据（未声称对齐）→ warning a1-weak-assertion；
//   c) 声称对齐节点携带失效 locator = 图与码矛盾 → error a1-evidence-broken；
//   c-drift) 声称对齐节点携带漂移锚（行在界但内容哈希不匹配，缺口② 2026-08-16）→ warning a1-evidence-drifted
//      （图码矛盾未证实但复核义务成立；无哈希锚=unhashed 不发声，存量容忍）；
//   d) 侧车节点 id 不在聚合 spec 集合 → warning a1-unmatched-account（node.kind='meta' 的账务/元节点跳过，2026-08-15 裁定②；
//      a/b/c 证据规则对 meta 节点照查不豁免，豁免数计入 a1.metaExempted）；spec 组件 id 不在侧车 → warning a1-unaccounted-node。

import fs from 'node:fs';
import path from 'node:path';
import { lintLocators, anchorState } from './evidence.mjs';
import { CLASS_STATES } from './state-machine.mjs';

/**
 * 不参与图绑定核对的 class 集（口径收窄，2026-09-10）：图=架构/流程**投影**，非台账镜像。
 * 当前 7 类 class（声明/注册/容器/任务/债/阶段门控/触发门控）皆非“应上图的结构件”，
 * 故均入本集；未分类节点（结构性件）仍照报 a1-unmatched-account。
 */
const NON_DIAGRAM_CLASSES = new Set(CLASS_STATES);

/**
 * 图组件 id ↔ 账本节点 id 的**归一化**（A3，2026-09-10）：实测常见差异只在
 * 「前缀 `demo-b-`」与大小写（如图件 `contract-center` ↔ 节点 `demo-b-contract-center`）。
 * 归一化只用于**匹配**，不改任何 id 本体 ✓。
 */
const normalizeSpecId = (id) => String(id).trim().toLowerCase().replace(/^demo-b-/, "");
import { summarizeReplay } from './trace.mjs';

const A1_NON_CLAIMS = [
  'truth 轴业务生效性（effective/closed 是否属实）需负责人回执，机器不可判',
  '证据校验仅静态 lint（文件存在+行号在界），不验证证据内容与代码语义一致',
  '锚行哈希只证行内容未变（ok/drifted 三态判定），不证行内容对节点声称的语义支撑；且同内容重复行之间的锚位移不可测（哈希相同则判 ok，2026-08-16 督导 F2）',
  '图账交叉按 component/node id 精确匹配，不判语义等价或别名',
  'A1 图账交叉仅在「图节点 id 即账节点 id」约定成立时有信号——图=结构实体、账=工作切片的项目（如治理型项目）不满足该约定，d 项 unmatched/unaccounted 与 compile 注入将全为噪声；处置建议：不传 --spec 停用 A1，或建立 id 映射纪律后启用（2026-08-17 demo-b holdout 对抗实验实证；适用边界，非缺陷）',
  'boundary/connection 拓扑正确性不在 A1 对账范围（未提供语义基准）',
  'meta 节点豁免图账交叉（负责人裁定② 2026-08-15），豁免数见 metaExempted（仅豁免 d 项，a/b/c 照查）',
];

/**
 * 销账链的图绑定状态（P1 余项，2026-09-11）：settle 回执直接携带「该节点落在哪些图上」，
 * 让图账绑定从**审计动作**变**销账副产物**（《N14 图面绑定呈件》§四.1）。
 *
 * 判据与 A1 反向面同源：节点 id（含前缀/大小写归一化）或 specRefs 命中任一 spec 组件 id ⇒ bound；
 * 否则按是否已分类区分 class-exempt（口径收窄，不参与绑定核对）与 unbound（结构性节点该上图而未上）。
 * 目录派生：<侧车目录>/../spec/<项目>/<图>.json（扫全部项目子目录，兼容项目侧车与聚合侧车）。
 * 只读、失败降级 no-specs —— **绝不阻断销账**。
 */
export function bindingStatusFor(nodeId, specRefs, sidecarPath) {
  const res = { verdict: 'no-specs', diagrams: [], checked: 0 };
  if (!sidecarPath) return res;
  const specRoot = path.resolve(path.dirname(sidecarPath), '..', 'spec');
  let projects;
  try { projects = fs.readdirSync(specRoot, { withFileTypes: true }); } catch { return res; }
  const targets = new Set([String(nodeId), normalizeSpecId(nodeId)]);
  if (Array.isArray(specRefs)) {
    for (const r of specRefs) { targets.add(String(r)); targets.add(normalizeSpecId(r)); }
  }
  const diagrams = new Set();
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
      // 与 A1 同源：图件 id 同时取 components[] 与 states[]（lifecycle/状态机图的状态无 components）。
      const parts = [];
      if (sp && Array.isArray(sp.components)) parts.push(...sp.components);
      if (sp && Array.isArray(sp.states)) parts.push(...sp.states);
      for (const c of parts) {
        const cid = c && c.id ? String(c.id) : '';
        if (cid.length === 0) continue;
        if (targets.has(cid) || targets.has(normalizeSpecId(cid))) diagrams.add(f.replace(/\.json$/, ''));
      }
    }
  }
  res.checked = checked;
  if (checked === 0) return res;
  res.diagrams = [...diagrams].sort();
  res.verdict = res.diagrams.length > 0 ? 'bound' : 'unbound';
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
  const specs = Array.isArray(opts_.specs) ? opts_.specs : [];
  const a1Active = specs.length > 0;
  const a1Errors = [];
  const a1Warnings = [];
  const specIds = new Set();
  if (a1Active) {
    for (const spec of specs) {
      for (const comp of (spec && Array.isArray(spec.components) ? spec.components : [])) {
        if (comp && comp.id) specIds.add(String(comp.id));
      }
      // 0.6.3：lifecycle 族 states 同样参与图账交叉对账（图账同 id 约定与 compile 一致）。
      for (const state of (spec && Array.isArray(spec.states) ? spec.states : [])) {
        if (state && state.id) specIds.add(String(state.id));
      }
    }
  }
  let stateChanges = 0;
  const nodeReports = [];
  for (const id of ids) {
    const node = nodes[id];
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
    const claimed = a1Active ? claimedAxes(node) : null;
    if (claimed) {
      if (evidence.length === 0) {
        a1Errors.push(diag('a1-missing-evidence', 'A1：' + id + ' 声称对齐实相（' + claimed + '）但证据数为 0', id, 'error'));
      }
      if (lint.invalid > 0) {
        a1Errors.push(diag('a1-evidence-broken', 'A1：' + id + ' 声称对齐实相（' + claimed + '）但携带 ' + lint.invalid + ' 条失效证据 locator（图与码矛盾）', id, 'error'));
      }
      // 锁口②（2026-08-16）：漂移锚（行在界但内容哈希不匹配）→ warning——图码矛盾未证实（行还在，内容已变），
      // 但复核义务成立；无哈希锚=unhashed 不发声（存量容忍，不算 drifted）。
      const meta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
      const driftedCount = evidence.filter((loc) => anchorState(loc, meta[loc], root) === 'drifted').length;
      if (driftedCount > 0) {
        a1Warnings.push(diag('a1-evidence-drifted', 'A1：' + id + ' 声称对齐实相（' + claimed + '）但携带 ' + driftedCount + ' 条漂移锚（图码矛盾未证实但复核义务成立：目标行内容已漂移，复核后重新 evidence-add 钉新哈希）', id, 'warning'));
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
  let metaExempted = 0;
  let classExempted = 0;
  let diagramLocalIds = 0;
  let nonAccountDeclared = 0;
  const specIdsNormalized = new Set([...specIds].map(normalizeSpecId));
  const ledgerIdsNormalized = new Set(Object.keys(nodes).map(normalizeSpecId));
  // A3：节点可用 specRefs[] 显式**认领**图件 id（含图内局部 id）——认领后不再报"图件未入账" ✓
  const declaredSpecRefs = new Set();
  for (const node of Object.values(nodes)) {
    if (node && Array.isArray(node.specRefs)) {
      for (const ref of node.specRefs) declaredSpecRefs.add(String(ref));
    }
  }
  // 非账本实体声明（P4，2026-09-11）：<侧车同目录>/diagram-nonaccounts.json 声明哪些图组件 id 是
  // 架构构件或图内局部标签，**不要求账本记账**（图=投影，非台账镜像）。与 specRefs 分工：
  // specRefs="这个图件 id 由某节点认领"；本声明="这个图件 id 不是账本实体"。无文件=空集（零破坏）。
  const declaredNonAccounts = new Set();
  if (opts_.nonAccountsPath) {
    const parsed = (() => { try { return JSON.parse(fs.readFileSync(opts_.nonAccountsPath, 'utf8')); } catch { return null; } })();
    const groups = parsed && parsed.nonAccounts && typeof parsed.nonAccounts === 'object' ? parsed.nonAccounts : {};
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      const gids = g && Array.isArray(g.ids) ? g.ids : [];
      for (const gid of gids) declaredNonAccounts.add(String(gid));
    }
  }
  if (a1Active) {
    for (const id of Object.keys(nodes)) {
      if (nodes[id] && nodes[id].kind === 'meta') {
        // 裁定②：账务/元节点（记图本身与命令本身的账）自声明 kind=meta，不参与图账交叉对账（仅 d 项）。
        metaExempted += 1;
        continue;
      }
      // 口径收窄（2026-09-10，triage 实证）：class 已声明的节点**不参与图绑定核对**——
      // 图是**架构/流程投影**，不是台账镜像；声明/注册/容器/工作项类节点本就不应有架构图页
      // （实证：346 节点里 297 条无图绑定，其中绝大多数是声明/注册/债/批次类）。
      // 真缺口 = 未分类的“结构性节点”该上图而未上（那批仍报）。详见 demo-b 图面绑定呈件 §二-B。
      if (typeof nodes[id].class === 'string' && NON_DIAGRAM_CLASSES.has(nodes[id].class)) {
        classExempted += 1;
        continue;
      }
      if (!specIds.has(id) && !specIdsNormalized.has(normalizeSpecId(id))) {
        a1Warnings.push(diag('a1-unmatched-account', 'A1：侧车节点 ' + id + ' 不在任何已提供 spec 中（覆盖缺口，非已证实矛盾）', id, 'warning'));
      }
    }
    for (const sid of specIds) {
      if (Object.prototype.hasOwnProperty.call(nodes, sid)) continue;
      if (ledgerIdsNormalized.has(normalizeSpecId(sid))) continue; // 前缀/大小写差异 ⇒ 视为已入账 ✓
      if (declaredSpecRefs.has(sid)) continue; // 节点 specRefs 显式认领 ✓
      // A3（2026-09-10）：其余多为**图内局部标签**（实测如 hooks/enroll/roles/r26/vl…）——
      // 单列一类并计数，不并入"账本缺节点"（原口径把 265 条一并报，噪音掩盖真缺口 ✗）。
      if (declaredNonAccounts.has(sid)) { nonAccountDeclared += 1; continue; }
      diagramLocalIds += 1;
      a1Warnings.push(diag('a1-diagram-local-id', 'A1：spec 组件 ' + sid + ' 无对应账本节点（归一化与 specRefs 均未命中）——若为图内局部标签可忽略；若确为实体请补节点或用 state spec-ref 认领', sid, 'warning'));
    }
  }
  errors.push(...a1Errors);
  warnings.push(...a1Warnings);
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
    if (brief) {
      // A3：a1 小节仅计数，nonClaims 只出条数（全文略去）。
      result.a1 = {
        specs: specs.length,
        checkedNodes: ids.length,
        specComponentIds: specIds.size,
        errors: a1Errors.length,
        warnings: a1Warnings.length,
        metaExempted,
        classExempted,
        diagramLocalIds,
        nonAccountDeclared,
        nonClaims: A1_NON_CLAIMS.length,
      };
    } else {
      result.a1 = {
        specs: specs.length,
        checkedNodes: ids.length,
        specComponentIds: specIds.size,
        errors: a1Errors.length,
        warnings: a1Warnings.length,
        metaExempted,
        classExempted,
        diagramLocalIds,
        nonAccountDeclared,
        nonClaims: A1_NON_CLAIMS.slice(),
      };
    }
  }
  return result;
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
