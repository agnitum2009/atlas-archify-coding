// 写入规则引擎（ADD-SPEC §2.4.2 规则四族与纠错公理，0.22.0）。操作前置条件与持久化留在 commands。
// 四族：P 路径（怎么到达）/ S 状态（账本内部现状是否自洽）/ A 权限（调用方传入）/ X 外部事实（证据锚可解析）。
// 纠错公理：--correction 只豁免 P 族，且只由 state set 接受（其余子命令在 commands 入口即 bad_args）。
// 全部违规一并收集（P、A、S、X 序），不提前返回——0.21.2 的提前 return 曾吞掉证据守卫。
import { lintLocator } from './evidence.mjs';
import { crossAxisViolations, validateTransition } from './state-machine.mjs';
import { SET_A2_SUGGEST } from './cli-util.mjs';
import { diag } from './error-codes.mjs';


export function unresolvableEvidenceDiag(bad, subject) {
  const sample = bad.slice(0, 3).map((b) => b.locator + '（' + b.diagnostic.rule + '）').join('、');
  const more = bad.length > 3 ? ' 等 ' + bad.length + ' 条' : '';
  return diag(
    'evidence_unresolvable',
    'A3：完成声称要求证据锚可解析，实际 ' + bad.length + ' 条不可解析：' + sample + more +
      '——' + bad[0].diagnostic.evidence +
      '；补救 = 修正路径/行号后重新 state evidence-add，或 state evidence-reanchor --from <旧锚> --to <可解析锚>',
    subject
  );
}

// 声称分项（§2.4.2 S 族成员：该声称字段 + evidence）。cancelled 只要求非空，不进 X 族可解析判定。
const CLAIMS = [
  { field: 'progress', holds: (n) => n.progress === 'verified', resolvable: true },
  { field: 'progress', holds: (n) => n.progress === 'cancelled', resolvable: false },
  { field: 'ledger', holds: (n) => n.ledger === 'settled', resolvable: true },
  { field: 'truth', holds: (n) => n.truth === 'effective' || n.truth === 'closed', resolvable: true },
];

const COMBO_TEXT = {
  settled_requires_verified: 'A2 §2.4.1：ledger=settled 要求 progress=verified（settle/import 双写不变量）',
  cancelled_requires_clean: 'A2 §2.4.1：cancelled × ledger≠clean 是孤儿欠账组合（cancelled 无出边，欠账此后无事件可销）',
};
const COMBO_FIX = {
  settled_requires_verified: '补救 = 执行闭环用 state settle、历史导入用 state import；纠错须先使 progress=verified（带证据）',
  cancelled_requires_clean: '补救 = 先 state set --axis ledger --value clean --correction 核销欠账，再取消',
};

/**
 * 按 §2.4.2 判定一次写入。返回 { diagnostics, admittedRules }：
 * diagnostics = 未获豁免的全部违规（P、A、S、X 序）；admittedRules = 被 --correction 实际豁免的 P 族规则码。
 * authority = 调用方已判定的 A 族诊断（如 truth 回执门），按序插在 P 之后。
 * init = set 的初始化/该轴首写（免 A2 表）。
 */
export function checkStateWritePolicy({ before, after, operation, axis, correction = false, init = false, authority = [], nodeId, cwd = process.cwd() }) {
  const prev = before || {};
  // settle/import 是声称事件本身：同事件重新断言 progress=verified 与 ledger=settled，两成员一律视为改动。
  const claimEvent = operation === 'settle' || operation === 'import';
  const changed = (field) => claimEvent && (field === 'progress' || field === 'ledger') ? true : field === 'evidence'
    ? JSON.stringify(prev.evidence || []) !== JSON.stringify(after.evidence || [])
    : prev[field] !== after[field];
  const evidence = after.evidence || [];

  // —— P 路径（仅 set/transition 的单轴写；settle/import/block 的路径前置在 commands 内） ——
  const pathDiags = [];
  if ((operation === 'set' || operation === 'transition') && changed(axis)) {
    const from = prev[axis];
    if (!(operation === 'set' && (init || from === undefined || from === null))) {
      const verdict = validateTransition(axis, from, after[axis]);
      if (!verdict.ok) {
        const d = verdict.diagnostics[0];
        pathDiags.push(diag(d.rule, d.evidence + (operation === 'set' ? SET_A2_SUGGEST : ''), nodeId));
      }
    }
    if (axis === 'ledger' && after.ledger === 'settled') {
      pathDiags.push(diag('settled_requires_event', 'A2 §2.4：ledger→settled 只能经 state settle（执行闭环）或 state import（历史导入）事件写入——' + operation + ' 直达会破坏跨轴双写不变量', nodeId));
    }
  }
  const waivable = operation === 'set' && correction;
  const admittedRules = waivable ? pathDiags.map((d) => d.rule) : [];

  // —— S 状态：改动了成员字段的规则，写后必须满足（未改动成员 = 存量不冻结） ——
  const stateDiags = [];
  if (changed('progress') || changed('ledger')) {
    for (const rule of crossAxisViolations(after.progress, after.ledger)) {
      stateDiags.push(diag(rule, COMBO_TEXT[rule] + '：写后 progress=' + after.progress + ' × ledger=' + after.ledger + '（§2.4.2 S 族，--correction 不豁免）；' + COMBO_FIX[rule], nodeId));
    }
  }
  if (evidence.length === 0 && CLAIMS.some((c) => c.holds(after) && (changed(c.field) || changed('evidence')))) {
    const cancelling = after.progress === 'cancelled' && changed('progress');
    stateDiags.push(cancelling
      ? diag('cancelled_requires_evidence', 'A3：progress 迁到 cancelled 必须至少 1 条 Evidence（先 state evidence-add——取消是终态声明，须锚定被取代/退役依据；--correction 不豁免）', nodeId)
      : diag('verified_requires_evidence', operation === 'evidence-remove'
        ? 'A3：移除会使声称对齐节点失去全部证据（A3）；请先 evidence-add 新锚再移除，或用 evidence-reanchor 原子替换'
        : 'A3：完成声称必须至少 1 条 Evidence（先 state evidence-add；历史/迁移导入用 state import；--correction 不豁免）', nodeId));
  }

  // —— X 外部事实：写入使某轴进入声称值时，证据锚须可解析（读边另行持续判定） ——
  const factDiags = [];
  if (evidence.length > 0 && CLAIMS.some((c) => c.resolvable && c.holds(after) && changed(c.field))) {
    const bad = evidence.flatMap((locator) => {
      const linted = lintLocator(locator, cwd);
      return linted.ok ? [] : [{ locator, diagnostic: linted.diagnostic }];
    });
    if (bad.length > 0) factDiags.push(unresolvableEvidenceDiag(bad, nodeId));
  }

  const diagnostics = [...(waivable ? [] : pathDiags), ...authority, ...stateDiags, ...factDiags];
  return { diagnostics, admittedRules: diagnostics.length > 0 ? [] : admittedRules };
}
