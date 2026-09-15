// 图件 id ↔ 账本节点 id 的**单一解析入口**（2026-09-15）。
// 立法动机（上轮审计缺陷4）：report 走 normalizeSpecId（demo-b- 前缀 + 大小写归一 + specRefs 认领），
// compile 只做精确匹配，settle 绑定又抄了一份——同一份图与账在三处得出不同绑定（report 说已入账、
// compile 却不注入）。本模块是这三处共用的唯一实现，且**认领来源（id 形状 / specRefs）在同一处解析**。
//
// 边界（明载，不承诺覆盖）：归一化只处理实测的两类差异（demo-b- 前缀、大小写）；不做别名、不做语义等价
// （与 A1 nonClaims 一致）。图=投影、账=工作台账，解析只回答「这个图件 id 对应哪个账本节点」。

/** 归一化：只用于**匹配**，绝不改任何 id 本体。 */
export function normalizeSpecId(id) {
  return String(id).trim().toLowerCase().replace(/^demo-b-/, '');
}

/**
 * specRefs 条目的图作用域。
 * 约定：`<图名>/<图内id>` = 只在该图内认领；不含 '/'（或 '/' 位于首尾）的旧条目 = **未限图**（全图认领，兼容存量）。
 * 未限图条目会在多图间重复生效，调用方须如实计数披露（report 的 a1.coverage.unscopedRefs）。
 */
export function parseSpecRef(ref) {
  const s = String(ref);
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) return { diagram: null, id: s };
  return { diagram: s.slice(0, i), id: s.slice(i + 1) };
}

export function formatSpecRef(diagram, id) {
  const d = diagram === null || diagram === undefined ? '' : String(diagram).trim();
  return d === '' ? String(id) : d + '/' + String(id);
}

/**
 * 该 specRef 是否认领「specName 图中的 specId」。
 * 作用域安全：图限定 ref 在**图名未知**（specName=null）时一律不消解——未知图名不得让一个图内的
 * 认领泄漏到别图（这正是跨图同局部 id 误绑的来源）。
 */
export function specRefMatches(ref, specId, specName) {
  const parsed = parseSpecRef(ref);
  if (parsed.diagram !== null) {
    if (specName === null || specName === undefined) return false;
    if (parsed.diagram !== String(specName)) return false;
  }
  return normalizeSpecId(parsed.id) === normalizeSpecId(specId);
}

/** 账本索引：归一化 key → 节点 id 数组（长度 >1 = 归一化歧义，如同时存在 `x` 与 `demo-b-X`）。 */
export function buildLedgerIndex(nodes) {
  const byKey = new Map();
  for (const id of Object.keys(nodes || {})) {
    const key = normalizeSpecId(id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
  }
  return { byKey };
}

/**
 * 图件 id → 账本节点，**唯一入口**（report / compile / settle 绑定共用）。
 * 候选来源（同一处解析、同一套优先级，勿在别处再写一遍）：
 *   ① 精确同名（`Object.hasOwn`，原型键不算命中）
 *   ② 归一化后唯一命中（demo-b- 前缀 / 大小写差异）
 *   ③ specRefs 认领（仅当该 ref 在 specName 图内有效；图名未知时图限定 ref 不消解）
 * 判定：恰好 1 个不同节点 ⇒ 绑定（via 报来源）；多于 1 个不同节点 ⇒ **不绑定**，返回全部候选供披露
 * （宁可报歧义，绝不静默误绑——旧实现的两种口径都会在这里分叉）。
 * @returns {{ nodeId: string|null, via: 'exact'|'normalized'|'spec-ref'|null, matchedRef: string|null,
 *             ambiguous: Array<{ nodeId: string, via: string, ref: string|null }> }}
 */
export function resolveSpecBinding({ nodes, index, specId, specName = null }) {
  const raw = String(specId);
  const candidates = [];
  const push = (nodeId, via, ref) => {
    if (!candidates.some((c) => c.nodeId === nodeId)) candidates.push({ nodeId, via, ref: ref || null });
  };
  if (Object.hasOwn(nodes || {}, raw)) push(raw, 'exact', null);
  const key = normalizeSpecId(raw);
  const normalized = index && index.byKey ? (index.byKey.get(key) || []) : [];
  if (normalized.length === 1) push(normalized[0], 'normalized', null);
  for (const [nodeId, node] of Object.entries(nodes || {})) {
    const refs = node && Array.isArray(node.specRefs) ? node.specRefs : null;
    if (!refs) continue;
    for (const ref of refs) {
      if (specRefMatches(ref, raw, specName)) push(nodeId, 'spec-ref', String(ref));
    }
  }
  if (candidates.length === 1) {
    const won = candidates[0];
    return { nodeId: won.nodeId, via: won.via, matchedRef: won.ref, ambiguous: [] };
  }
  if (candidates.length > 1) return { nodeId: null, via: null, matchedRef: null, ambiguous: candidates };
  if (normalized.length > 1) {
    return { nodeId: null, via: null, matchedRef: null, ambiguous: normalized.map((n) => ({ nodeId: n, via: 'normalized', ref: null })) };
  }
  return { nodeId: null, via: null, matchedRef: null, ambiguous: [] };
}
