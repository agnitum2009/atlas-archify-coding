// ADD-SPEC v1.0.0 §2 — three-axis state machine (pure, zero-dep).

export const AXES = Object.freeze({
  truth: Object.freeze({
    states: Object.freeze(['candidate', 'pending_confirmation', 'effective', 'closed']),
    transitions: Object.freeze({
      candidate: Object.freeze(['pending_confirmation']),
      pending_confirmation: Object.freeze(['effective']),
      effective: Object.freeze(['closed']),
      closed: Object.freeze([]),
    }),
  }),
  progress: Object.freeze({
    states: Object.freeze(['planned', 'in_progress', 'blocked', 'verified', 'cancelled']),
    transitions: Object.freeze({
      planned: Object.freeze(['in_progress', 'cancelled']),
      in_progress: Object.freeze(['verified', 'blocked']),
      blocked: Object.freeze(['in_progress']),
      verified: Object.freeze([]),
      cancelled: Object.freeze([]),
    }),
  }),
  ledger: Object.freeze({
    states: Object.freeze(['clean', 'backlog', 'settled']),
    transitions: Object.freeze({
      clean: Object.freeze(['backlog']),
      backlog: Object.freeze(['settled']),
      settled: Object.freeze([]),
    }),
  }),
});

export function isAxis(name) {
  return Object.prototype.hasOwnProperty.call(AXES, name);
}

export function isValidState(axis, value) {
  return isAxis(axis) && AXES[axis].states.includes(value);
}

// 提案④（2026-08-15 裁定）：set 写路径的 A2 校验——已存在节点的轴值变更同样过迁移表，
// set 不再架空 A2。复用上方 validateTransition（不复制表）。
// 免表情形：init（节点不存在/该轴尚无值=首次写）、from 无值、同值写入（from==to，无变更）。
// correction=true 时违表仍放行（显式纠错通道），admittedCorrection=true 供调用方落 corrected:true 留痕；
// 合法迁移即使带 correction 也不打 admittedCorrection（标记只指真实绕过 A2 的写入）。
export function validateSetWrite(axis, from, to, { correction = false, init = false } = {}) {
  if (init || from === undefined || from === null || from === to) {
    return { ok: true, admittedCorrection: false, diagnostics: [] };
  }
  const verdict = validateTransition(axis, from, to);
  if (verdict.ok) {
    return { ok: true, admittedCorrection: false, diagnostics: [] };
  }
  if (correction) {
    return { ok: true, admittedCorrection: true, diagnostics: [] };
  }
  return verdict;
}

// Returns diagnostics-shaped validation. ok=true means the transition is legal.
export function validateTransition(axis, from, to) {
  if (!isAxis(axis)) {
    return { ok: false, diagnostics: [diag('unknown_axis', 'axis 必须是 truth|progress|ledger', axis + ':' + from + '->' + to)] };
  }
  if (!isValidState(axis, from)) {
    return { ok: false, diagnostics: [diag('invalid_from_state', 'from 不在 ' + axis + ' 状态集：' + AXES[axis].states.join(','), axis + ':' + from)] };
  }
  if (!isValidState(axis, to)) {
    return { ok: false, diagnostics: [diag('invalid_to_state', 'to 不在 ' + axis + ' 状态集：' + AXES[axis].states.join(','), axis + ':' + to)] };
  }
  if (!AXES[axis].transitions[from].includes(to)) {
    return { ok: false, diagnostics: [diag('illegal_transition', axis + ' 轴 ' + from + ' 不可迁移到 ' + to + '（合法目标：' + AXES[axis].transitions[from].join(',') + '）', axis + ':' + from + '->' + to)] };
  }
  return { ok: true, diagnostics: [] };
}

function diag(rule, message, subject) {
  return { rule, severity: 'error', subject, evidence: message, supportedFixes: [] };
}

