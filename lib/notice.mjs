// notice（席位间主动通知，2026-08-15 清单 B3，demo-harness 启示：通知是进 inbox 的一等数据，非侧信道）：
// sidecar.notices 累积通知条目；settle/block 成功自动投递，notice add 手动跨席位喊话。
// 向后兼容：旧侧车无 notices 字段按空数组处理（loadSidecar 补缺省 []，schemaVersion 保持 1）。

import crypto from 'node:crypto';

// settled|blocked 由 settle/block 成功自动投递专属；notice add 手动只接受 note（防伪造自动语义）。
export const NOTICE_KINDS = Object.freeze(['settled', 'blocked', 'note']);

export function addNotice(sidecar, entry) {
  if (!NOTICE_KINDS.includes(entry.kind)) {
    const err = new Error('kind 必须是 ' + NOTICE_KINDS.join('|'));
    err.code = 'bad_kind';
    throw err;
  }
  if (!entry.summary || !String(entry.summary).trim()) {
    const err = new Error('summary 不能为空');
    err.code = 'empty_summary';
    throw err;
  }
  if (!sidecar.notices) sidecar.notices = [];
  const notice = {
    id: 'notice-' + crypto.randomUUID(),
    at: entry.at || new Date().toISOString(),
    from: entry.from || 'unknown',
    kind: entry.kind,
    node: entry.node || null,
    summary: String(entry.summary).trim(),
    readBy: [],
  };
  sidecar.notices.push(notice);
  return notice;
}

// list：缺省全量；带 seat 只列 readBy 不含该席位的未读。返回拷贝，不改侧车原对象（旧条目 readBy 缺省兜底空数组）。
export function listNotices(sidecar, seat) {
  const all = (sidecar.notices || []).map((n) => ({ ...n, readBy: n.readBy || [] }));
  if (!seat) return all;
  return all.filter((n) => !n.readBy.includes(seat));
}

// ack：把 seat 记入 readBy（幂等——已确认不重复计，confirmed 只算本次新确认数）；无 id=全部未读确认。
export function ackNotices(sidecar, seat, id) {
  if (!seat || !String(seat).trim()) {
    const err = new Error('notice ack 必须带 --seat <席位名>');
    err.code = 'bad_seat';
    throw err;
  }
  const name = String(seat).trim();
  const notices = sidecar.notices || [];
  const targets = id ? notices.filter((n) => n.id === id) : notices;
  if (id && targets.length === 0) {
    const err = new Error('通知不存在：' + id);
    err.code = 'notice_not_found';
    throw err;
  }
  let confirmed = 0;
  const ids = [];
  for (const n of targets) {
    n.readBy = n.readBy || [];
    if (!n.readBy.includes(name)) {
      n.readBy.push(name);
      confirmed += 1;
      ids.push(n.id);
    }
  }
  return { confirmed, ids };
}
