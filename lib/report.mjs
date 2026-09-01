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

import { lintLocators, anchorState } from './evidence.mjs';
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
  if (a1Active) {
    for (const id of Object.keys(nodes)) {
      if (nodes[id] && nodes[id].kind === 'meta') {
        // 裁定②：账务/元节点（记图本身与命令本身的账）自声明 kind=meta，不参与图账交叉对账（仅 d 项）。
        metaExempted += 1;
        continue;
      }
      if (!specIds.has(id)) {
        a1Warnings.push(diag('a1-unmatched-account', 'A1：侧车节点 ' + id + ' 不在任何已提供 spec 中（覆盖缺口，非已证实矛盾）', id, 'warning'));
      }
    }
    for (const sid of specIds) {
      if (!Object.prototype.hasOwnProperty.call(nodes, sid)) {
        a1Warnings.push(diag('a1-unaccounted-node', 'A1：spec 节点 ' + sid + ' 不在侧车账中（覆盖缺口，非已证实矛盾）', sid, 'warning'));
      }
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
