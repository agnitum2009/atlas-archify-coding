// 提案③（2026-08-15 负责人裁定「必须就做」）：真相轴回执推进协议。
// 开发规范依据：Owner 真相需目标本地回执，机器不自证（ADD-SPEC §2.5 启用协议 = 公理 A5 的机器化落地）。
// 机器只校验回执文件存在性，不校验语义（生效与否属负责人）；bin 的 set/transition 两入口共用，勿复制两份。

import fs from 'node:fs';
import path from 'node:path';
import { AXES } from './state-machine.mjs';

const TRUTH_CHAIN = AXES.truth.states; // candidate → pending_confirmation → effective → closed

// truth 前进写入判定：to 在真相链上严格位于 from 之后（含 state set 快捷路径跳级前进；
// 回退与原地写入不属于前进，不触发本门禁——回退仍按既有 A2 规则处理，不变）。
export function isTruthAdvance(from, to) {
  const fromIndex = TRUTH_CHAIN.indexOf(from);
  const toIndex = TRUTH_CHAIN.indexOf(to);
  return fromIndex !== -1 && toIndex > fromIndex;
}

// 门禁：truth 前进写入必须携带存在的负责人本地回执文件。
// 返回 { ok, diagnostics, receipt }：ok 且触发门禁时 receipt = 解析后的绝对路径（供落账）；
// 未触发门禁（非 truth 轴 / 非前进写入）时 receipt = null，传入的 --receipt 一律忽略。
export function checkTruthReceipt({ axis, from, to, receipt }) {
  if (axis !== 'truth' || !isTruthAdvance(from, to)) {
    return { ok: true, diagnostics: [], receipt: null };
  }
  const given = Array.isArray(receipt) ? receipt[0] : receipt; // parseArgs 重复参数聚合为数组，防 path.resolve 形变
  if (!given) {
    return { ok: false, diagnostics: [diag('receipt_required', '真相轴推进需负责人本地回执文件（开发规范：Owner 真相需目标本地回执，机器不自证）：--receipt <文件路径>', 'truth:' + from + '->' + to)] };
  }
  const abs = path.resolve(given);
  if (!fs.existsSync(abs)) {
    return { ok: false, diagnostics: [diag('receipt_not_found', '回执文件不存在：' + abs + '（机器只校验存在性，语义属负责人；回执建议归位 <图谱目录>/rulings/receipts/）', abs)] };
  }
  return { ok: true, diagnostics: [], receipt: abs };
}

// 放行后落账：节点追加 truthReceipts 条目 {to, receipt, at}（history 事件的 receipt 字段由调用方写入）。
export function recordTruthReceipt(node, to, absReceipt, at) {
  node.truthReceipts = node.truthReceipts || [];
  node.truthReceipts.push({ to, receipt: absReceipt, at });
  return node;
}

function diag(rule, message, subject) {
  return { rule, severity: 'error', subject, evidence: message, supportedFixes: [] };
}
