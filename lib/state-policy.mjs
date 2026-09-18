// Evidence policy for a proposed write. Operation preconditions and persistence stay in commands.
import { lintLocator } from './evidence.mjs';

function diag(rule, evidence, subject) {
  return { rule, severity: 'error', subject, evidence, supportedFixes: [] };
}

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

/** Return failed diagnostics and only the rules actually waived by correction. */
export function checkStateWritePolicy({ before, after, operation, axis, correction = false, nodeId, cwd = process.cwd() }) {
  const diagnostics = [];
  const admittedRules = [];
  const result = { diagnostics, admittedRules };
  const evidence = after.evidence || [];
  const requireRule = (rule, message, canCorrect = false) => {
    if (correction && canCorrect) admittedRules.push(rule);
    else diagnostics.push(diag(rule, message, nodeId));
  };
  if (operation === 'evidence-remove') {
    const claims = after.progress === 'verified' || after.progress === 'cancelled' || after.ledger === 'settled' || ['effective', 'closed'].includes(after.truth);
    if (claims && evidence.length === 0) {
      requireRule('verified_requires_evidence', 'A3：移除会使声称对齐节点失去全部证据（A3）；请先 evidence-add 新锚再移除，或用 evidence-reanchor 原子替换');
    }
    return result; // Removing an anchor must not require repair of every remaining anchor.
  }
  const crossAxis = operation === 'settle' || operation === 'import';
  if (!crossAxis && before?.[axis] === after[axis]) return result;
  // Preserve the explicit ledger correction channel: it waives the event requirement,
  // without introducing a new count/resolvability precondition on this operation.
  if (!crossAxis && axis === 'ledger' && after.ledger === 'settled') {
    requireRule('settled_requires_event', 'A2 §2.4：ledger→settled 只能经 state settle（执行闭环）或 state import（历史导入）事件写入——' + operation + ' 直达会破坏跨轴双写不变量', true);
  }
  // 写边不再允许「先挂 backlog 再 cancelled」的孤儿欠账（取消后无任何事件可销，成永久孤儿）。
  // 真实账本统计：该半边存量为 0（零误伤收口）；--correction 显式核销通道保留（与 settled_requires_event 同款）。
  if (!crossAxis && axis === 'progress' && after.progress === 'cancelled' && after.ledger !== 'clean') {
    requireRule('cancelled_requires_clean',
      'A2 §2.4.1：progress→cancelled 时 ledger 必须为 clean（当前为 ' + after.ledger + '）——取消的工欠账成永久孤儿（settle 要求 in_progress/verified，import 要求 planned×clean，此后无事件可销）。'
        + '先 state settle 核销欠账再取消，或 state set --correction 显式核销（corrected:true 留痕）',
      true);
    return result;
  }
  const cancelled = !crossAxis && axis === 'progress' && after.progress === 'cancelled';
  const verified = crossAxis || (axis === 'progress' && after.progress === 'verified');
  const truthClaim = axis === 'truth' && ['effective', 'closed'].includes(after.truth);
  if (!cancelled && !verified && !truthClaim) return result;
  const canCorrect = operation === 'set' && axis === 'progress';
  if (evidence.length === 0) {
    requireRule(cancelled ? 'cancelled_requires_evidence' : 'verified_requires_evidence',
      cancelled ? 'A3：progress 迁到 cancelled 必须至少 1 条 Evidence（先 state evidence-add——取消是终态声明，须锚定被取代/退役依据）' : 'A3：完成声称必须至少 1 条 Evidence（先 state evidence-add；历史/迁移导入用 state import）', canCorrect);
    return result;
  }
  if (!cancelled) {
    const bad = evidence.flatMap(locator => {
      const linted = lintLocator(locator, cwd);
      return linted.ok ? [] : [{ locator, diagnostic: linted.diagnostic }];
    });
    if (bad.length > 0) {
      if (correction && canCorrect) admittedRules.push('evidence_unresolvable');
      else diagnostics.push(unresolvableEvidenceDiag(bad, nodeId));
    }
  }
  return result;
}
