// compile（command-contract.md §3）：sidecar 状态注入 archify spec。
// 完整+焦点双呈现：默认全图可见（gate 的 visual-check 收容=完整机器证明）；
// 在途节点注入 tag + meta.views 首章「当前焦点」——局部聚焦不丢全局。
// 0.6.1：lifecycle 族 states 同样注入（此前只认 components，生命周期图账不动图）。
// 2026-09-15（缺陷4）：图件 id ↔ 账本节点 id 改用 lib/spec-id.mjs 的**单一映射**（此前 compile 只做精确匹配，
// 与 report 的 demo-b-/大小写归一化双口径——同一份图账 report 说已入账、compile 却不注入）。歧义不注入并如实计数。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadSidecar } from './store.mjs';
import { buildLedgerIndex, resolveSpecBinding } from './spec-id.mjs';

export const PROGRESS_TAGS = Object.freeze({
  planned: '◐ 计划中',
  in_progress: '▶ 进行中',
  blocked: '⛔ 阻塞',
  verified: '✅ 已验证',
  cancelled: '✕ 已取消',
});

function badInput(message) {
  return Object.assign(new Error(message), { code: 'bad_input' });
}

function ownershipIndex(ownedTags) {
  if (!Array.isArray(ownedTags)) throw badInput('ownedTags 必须为数组');
  const index = new Map();
  for (const item of ownedTags) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['collection', 'id', 'written', 'original'].includes(key))
      || !['components', 'states'].includes(item.collection)
      || typeof item.id !== 'string' || !item.id.trim()
      || typeof item.written !== 'string') throw badInput('ownedTags 条目不合法');
    const original = item.original;
    if (!original || typeof original !== 'object' || Array.isArray(original)
      || Object.keys(original).some((key) => !['present', 'value'].includes(key))
      || typeof original.present !== 'boolean'
      || (original.present ? typeof original.value !== 'string' : Object.hasOwn(original, 'value'))) {
      throw badInput('ownedTags.original 不合法');
    }
    const key = JSON.stringify([item.collection, item.id]);
    if (index.has(key)) throw badInput('ownedTags 存在重复 collection/id');
    index.set(key, item);
  }
  return index;
}

export function compileAtlas(diagram, sidecar, { diagramName = null, previousOwnedTags = [] } = {}) {
  const previous = ownershipIndex(previousOwnedTags);
  // 结构拷贝（不 JSON 往返：避免每次编译整图序列化/反序列化）；只复制注入会改写的层，输入对象不被改。
  const out = { ...diagram };
  out.meta = { ...(diagram && diagram.meta ? diagram.meta : {}) };
  if (Array.isArray(diagram && diagram.components)) out.components = diagram.components.map((c) => ({ ...c }));
  if (Array.isArray(diagram && diagram.states)) out.states = diagram.states.map((s) => ({ ...s }));
  const nodes = (sidecar && sidecar.nodes) || {};
  const index = buildLedgerIndex(nodes);
  const focusIds = [];
  const ambiguous = [];
  const bindings = [];
  const ownedTags = [];
  const unknownOwnership = [];
  const knownTags = new Set([...Object.values(PROGRESS_TAGS), '✅ 已销账']);
  let tagged = 0;
  const injectInto = (entry, collection) => {
    if (!entry || typeof entry.id !== 'string' || entry.id === '') return;
    const saved = previous.get(JSON.stringify([collection, entry.id]));
    const restored = saved && entry.tag === saved.written;
    if (restored) {
      if (saved.original.present) entry.tag = saved.original.value;
      else delete entry.tag;
    }
    const discloseUnknown = () => {
      if (!restored && knownTags.has(entry.tag)) unknownOwnership.push({ collection, id: entry.id, tag: entry.tag });
    };
    // 与 report / settle 绑定共用同一解析入口（缺陷4）：精确同名 → 归一化唯一命中 → specRefs 认领
    // （图限定 ref 只在 diagramName 匹配时生效；图名未知时不消解，不跨图泄漏）。
    const resolved = resolveSpecBinding({ nodes, index, specId: entry.id, specName: diagramName });
    if (resolved.ambiguous.length > 1) {
      ambiguous.push({ id: entry.id, candidates: resolved.ambiguous });
      discloseUnknown();
      return; // 歧义不注入：宁可少注入一个 tag，不静默绑错节点
    }
    if (resolved.nodeId === null) { discloseUnknown(); return; }
    const node = nodes[resolved.nodeId];
    if (resolved.via !== 'exact') bindings.push({ id: entry.id, node: resolved.nodeId, via: resolved.via, ref: resolved.matchedRef });
    if (PROGRESS_TAGS[node.progress]) {
      const original = Object.hasOwn(entry, 'tag') ? { present: true, value: entry.tag } : { present: false };
      if (original.present && typeof original.value !== 'string') throw badInput('作者 tag 必须为字符串');
      entry.tag = node.progress === 'verified' && node.ledger === 'settled'
        ? '✅ 已销账' : PROGRESS_TAGS[node.progress];
      ownedTags.push({ collection, id: entry.id, written: entry.tag, original });
      tagged += 1;
    }
    if (node.progress === 'in_progress') focusIds.push(entry.id);
  };
  // architecture 族 = components；lifecycle 族 = states。图账同 id 约定经上面的单一解析；
  // 非精确命中（demo-b- 前缀/大小写/specRefs 认领）逐个入 bindings 供审。
  for (const comp of out.components || []) injectInto(comp, 'components');
  for (const state of out.states || []) injectInto(state, 'states');
  // 重复图件身份不能产出下一轮无法安全恢复的所有权回执。
  ownershipIndex(ownedTags);
  const rest = Array.isArray(out.meta.views) ? out.meta.views.filter((v) => v && v.id !== 'current-focus') : [];
  if (focusIds.length > 0) {
    // schema：focus minItems 1、views maxItems 5、label maxLength 48——空焦点不发声章节（不造假焦点）。
    out.meta.views = [
      {
        id: 'current-focus',
        label: '当前焦点（在途 ' + focusIds.length + '）',
        focus: focusIds,
        note: '开发正在推进的节点；完整图保持默认全览',
      },
      ...rest,
    ].slice(0, 5);
  } else {
    out.meta.views = rest.slice(0, 5);
  }
  return { out, tagged, focus: focusIds, bindings, ambiguous, ownedTags, unknownOwnership };
}

export function compileFiles(diagramPath, sidecarPath, outPath, { previousReceiptPath = null } = {}) {
  let diagram, sidecar;
  try {
    diagram = JSON.parse(fs.readFileSync(diagramPath, 'utf8'));
    sidecar = loadSidecar(sidecarPath); // 与全部命令同一读入口：规范化真实路径 + 形状校验
  } catch (e) {
    const err = new Error('输入读取或解析失败：' + e.message);
    err.code = 'bad_input';
    throw err;
  }
  // 图名 = 文件名去扩展名：与 diagram-nonaccounts.json 的分组键、specRefs 的图限定语义一致
  // （report 用同一约定解析 specNames）。
  let diagramName = path.basename(String(diagramPath)).replace(/\.json$/, '');
  let previousOwnedTags = [];
  if (previousReceiptPath !== null) {
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(previousReceiptPath, 'utf8')); }
    catch (e) { throw badInput('上轮回执读取或解析失败：' + e.message); }
    const data = receipt?.data;
    const injected = data?.injected;
    if (receipt?.schemaVersion !== 1 || receipt?.command !== 'compile' || receipt?.status !== 'ok'
      || typeof data?.out !== 'string' || typeof data?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)
      || typeof injected?.outputPath !== 'string' || !path.isAbsolute(injected.outputPath)
      || typeof injected?.diagramName !== 'string' || !injected.diagramName.trim()) {
      throw badInput('上轮 compile 回执身份不合法或缺失');
    }
    ownershipIndex(injected.ownedTags);
    if (path.resolve(injected.outputPath) !== path.resolve(diagramPath)) throw badInput('上轮输出路径与本次输入不一致');
    const inputDigest = crypto.createHash('sha256').update(JSON.stringify(diagram)).digest('hex');
    if (data.sha256 !== inputDigest) throw badInput('上次输出与本次输入不一致');
    previousOwnedTags = injected.ownedTags;
    diagramName = injected.diagramName;
  }
  const { out, tagged, focus, bindings, ambiguous, ownedTags, unknownOwnership } = compileAtlas(diagram, sidecar, { diagramName, previousOwnedTags });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex');
  return {
    out: outPath,
    sha256,
    injected: {
      tags: tagged,
      ownedTags,
      outputPath: path.resolve(outPath),
      diagramName,
      unknownOwnership,
      focus,
      bindings,
      ambiguous,
      note: (unknownOwnership.length ? 'unknownOwnership = 无法确认当前状态，回原 spec 重编；' : '') + 'bindings = 非精确命中的注入（demo-b- 前缀/大小写归一 或 specRefs 认领，含 ref 原文）；ambiguous = 解析到多个账本节点（不注入，需人工消歧）',
    },
  };
}
