// lessons（经验池）：sidecar.lessons 累积经验条目；注入纪律见 SKILL.md（开工先读）。

import crypto from 'node:crypto';

export function addLesson(sidecar, entry) {
  if (!entry.lesson || !String(entry.lesson).trim()) {
    const err = new Error('lesson 不能为空');
    err.code = 'empty_lesson';
    throw err;
  }
  if (!sidecar.lessons) sidecar.lessons = [];
  const item = {
    id: 'lesson-' + crypto.randomUUID(),
    at: entry.at || new Date().toISOString(),
    rule: entry.rule || null,
    lesson: String(entry.lesson).trim(),
    source: entry.source || null,
    hits: 0, // B4 防膨胀：实际拦截命中计数；旧条目无此字段按 0 处理（向后兼容）
    status: 'active', // D3 生命周期：active|retired；旧条目无此字段按 active 处理（向后兼容）
  };
  sidecar.lessons.push(item);
  return item;
}

// hits 计数器（hitLesson）已于 v0.10.1 一并删除：v0.10.0 移除 CLI 写入口后它零调用方，却仍被自身测试
// 养活——「被测试养活的死代码」最具欺骗性（Sculley 死分支处方）；更关键是 v0.10.0 已声明「hits 为存量
// 只读字段」，同时留一个 mutator 会让声明与代码互相打脸。hits 数据本身保留：listLessons 照常读出，
// 旧条目无该字段按 0 补。若将来真需要重新计数，按能力准入五问 + 采用率基线重新提案。

// D3（2026-08-15 清单）：置 retired，幂等（已 retired 再 retire 仍成功返回，不回滚）；未知 id = lesson_not_found。
export function retireLesson(sidecar, id) {
  const item = (sidecar.lessons || []).find((l) => l.id === id);
  if (!item) {
    const err = new Error('经验条目不存在：' + id);
    err.code = 'lesson_not_found';
    throw err;
  }
  item.status = 'retired';
  return item;
}

// list 输出每条带 hits/status 缺省兜底（旧条目 hits→0、status→active）；返回拷贝，不改侧车原对象。
// A1（2026-08-15 清单）+ D3 过滤：缺省只列 active（--all 含 retired）；--rule 精确匹配；--recent 按 at 倒序取最近 N 条；三者可组合。
export function listLessons(sidecar, opts) {
  const o = opts || {};
  let out = (sidecar.lessons || []).map((l) => ({ ...l, hits: l.hits || 0, status: l.status || 'active' }));
  if (!o.includeRetired) out = out.filter((l) => l.status !== 'retired');
  if (o.rule) out = out.filter((l) => l.rule === o.rule);
  if (o.recent !== undefined && o.recent !== null) {
    const n = Number(o.recent);
    if (!Number.isInteger(n) || n < 1) {
      const err = new Error('--recent 需要正整数（示例：--recent 5），实际：' + o.recent);
      err.code = 'bad_args';
      throw err;
    }
    out = out.sort((a, b) => cmpAt(b.at, a.at)).slice(0, n);
  }
  return out;
}

// at 比较：可解析为时间戳时按毫秒比（跨毫秒精度格式安全），否则退回字符串序（确定性）。
function cmpAt(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

