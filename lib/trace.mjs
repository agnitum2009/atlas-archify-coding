// trace（轨迹锚定）：TraceEvent 入侧车；anchors 关系 = event.node → Node。
// ADD-SPEC Ontology：TraceEvent 实体 + anchors 关系（TraceEvent→Node）。

import crypto from 'node:crypto';

// 'command'（2026-08-15 清单 B1）：gate/compile/report 运行后自动留痕；state 写命令不自动记（history 已覆盖，重复会污染 replay 三源合并）。
export const TRACE_KINDS = Object.freeze(['tool_call', 'decision', 'diagram_diff', 'evidence', 'ruling', 'command']);

export function addTrace(sidecar, entry) {
  if (!TRACE_KINDS.includes(entry.kind)) {
    const err = new Error('kind 必须是 ' + TRACE_KINDS.join('|'));
    err.code = 'bad_kind';
    throw err;
  }
  if (!sidecar.trace) sidecar.trace = [];
  const event = {
    id: 'trace-' + crypto.randomUUID(),
    at: entry.at || new Date().toISOString(),
    kind: entry.kind,
    actor: entry.actor || 'unknown',
    note: entry.note || '',
    node: entry.node || null,
  };
  // detail（可选）：kind='command' 自动留痕的结构化摘要 { command, params, result }。
  if (entry.detail !== undefined) event.detail = entry.detail;
  sidecar.trace.push(event);
  if (entry.node && sidecar.nodes && sidecar.nodes[entry.node]) {
    sidecar.nodes[entry.node].traceRefs = sidecar.nodes[entry.node].traceRefs || [];
    sidecar.nodes[entry.node].traceRefs.push(event.id);
  }
  return event;
}

// A2（2026-08-15 清单）：--since 参数校验——合法或缺省返回 null，非法返回错误消息（CLI 以 bad_args exit 1 呈现，带示例）。
export function parseSince(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Number.isNaN(Date.parse(value))) {
    return '--since 需要 ISO8601 时间戳（示例：2026-08-15T00:00:00.000Z），实际：' + value;
  }
  return null;
}

export function listTraces(sidecar, nodeId, sinceIso) {
  let all = sidecar.trace || [];
  if (nodeId) all = all.filter((e) => e.node === nodeId);
  return filterSince(all, sinceIso);
}

// replayNode：节点审计时间线 = 状态历史 + 锚定轨迹 + 相关经验，按时间合并。
// A2：--since 作用于三源合并后的时间线过滤（含边界 at>=since）。
export function replayNode(sidecar, nodeId, sinceIso) {
  const node = sidecar.nodes && sidecar.nodes[nodeId];
  if (!node) return null;
  const events = [];
  for (const h of node.history || []) {
    events.push({ at: h.at, source: 'state', kind: h.kind, detail: h });
  }
  for (const t of (sidecar.trace || [])) {
    if (t.node === nodeId) events.push({ at: t.at, source: 'trace', kind: t.kind, detail: t });
  }
  for (const l of sidecar.lessons || []) {
    const tied = l.source === nodeId || ((sidecar.trace || []).some((t) => t.id === l.source && t.node === nodeId));
    if (tied) events.push({ at: l.at, source: 'lesson', kind: 'lesson', detail: l });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    node: nodeId,
    current: { truth: node.truth, progress: node.progress, ledger: node.ledger },
    events: filterSince(events, sinceIso),
  };
}

// 含边界（at >= since）：时间戳可解析时按毫秒比（跨格式安全），否则退回字符串比较（确定性）。
function filterSince(events, sinceIso) {
  if (!sinceIso) return events;
  const sinceMs = Date.parse(sinceIso);
  return events.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) ? String(e.at) >= String(sinceIso) : t >= sinceMs;
  });
}

// B2（2026-08-15 清单，replay 消费闭环）：report --replay 内联的时间线摘要。
// 防 token 膨胀：每节点最多最近 limit 条（缺省 10），超出注 truncated:true 与 total 总数；
// 每条只留 at/kind/source/一行要点 summary。节点不存在返回 { node, error }，由调用方决定不整体失败。
export function summarizeReplay(sidecar, nodeId, limit, brief) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 10;
  const timeline = replayNode(sidecar, nodeId);
  if (!timeline) return { node: nodeId, error: '节点不存在：' + nodeId };
  const total = timeline.events.length;
  // A3（2026-08-15 清单）：--brief 时 replays 只出每节点事件计数，不内联事件摘要。
  if (brief) return { node: nodeId, total };
  const events = timeline.events.slice(-cap).map((e) => ({ at: e.at, kind: e.kind, source: e.source, summary: oneLineSummary(e) }));
  const summary = { node: nodeId, total, events };
  if (total > cap) summary.truncated = true;
  return summary;
}

function oneLineSummary(event) {
  const d = event.detail || {};
  if (event.source === 'state') {
    const move = event.kind === 'evidence-add'
      ? '证据+ ' + d.locator
      : (d.axis ? d.axis + ' ' : '') + fmtVal(d.from) + '→' + fmtVal(d.to);
    return clip(event.kind + ' ' + move + (d.reason ? '（' + d.reason + '）' : '') + (d.by ? ' by ' + d.by : ''));
  }
  if (event.source === 'trace') {
    return clip((d.actor ? '[' + d.actor + '] ' : '') + (d.note || (d.detail && d.detail.command) || ''));
  }
  // lesson 源
  return clip((d.rule ? d.rule + ' ' : '') + (d.lesson || ''));
}

function fmtVal(v) {
  if (v && typeof v === 'object') return Object.entries(v).map(([k, val]) => k + '=' + val).join(',');
  return String(v);
}

function clip(s, max) {
  const cap = max || 120;
  const str = String(s == null ? '' : s);
  return str.length > cap ? str.slice(0, cap - 1) + '…' : str;
}

