// diff（command-contract.md §4）：spec 结构差异 + 状态时间线。

// 路径按段编码，避免字面点号、空键和根标记互相碰撞。
function encodeSegment(key) {
  if (key === '') return '\\e';
  return key.replace(/\\/g, '\\\\').replace(/\./g, '\\.').replace(/#/g, '\\#');
}
const subjectOf = (parts) => parts.length ? parts.map(encodeSegment).join('.') : '#';
const containerType = (value) => value !== null && typeof value === 'object'
  ? (Array.isArray(value) ? 'array' : 'object') : null;

function flattenInto(value, parts, out, paths) {
  const type = containerType(value);
  const keys = type === 'array' ? Object.keys(value) : type === 'object' ? Object.keys(value).sort() : [];
  if (!type || keys.length === 0) {
    const subject = subjectOf(parts);
    out[subject] = JSON.stringify(value);
    if (paths) paths.set(subject, parts);
    return out;
  }
  for (const key of keys) flattenInto(value[key], [...parts, key], out, paths);
  return out;
}

// 公开返回值仍为 点路径→JSON值 映射，使用无原型字典保留 __proto__ 键。
export function flatten(value, prefix = '', out = Object.create(null)) {
  return flattenInto(value, prefix ? [prefix] : [], out);
}

// 双 spec 规范化差异：rows = { subject(点路径), kind: added|removed|changed, before, after }。
export function diffSpecs(base, head) {
  const rows = [];
  const replacements = [];
  function findReplacements(before, after, parts) {
    const beforeType = containerType(before);
    const afterType = containerType(after);
    if (!beforeType || !afterType) return;
    if (beforeType !== afterType) {
      rows.push({ subject: subjectOf(parts), kind: 'changed', before, after });
      replacements.push(parts);
      return;
    }
    for (const key of Object.keys(before).sort()) {
      if (Object.prototype.hasOwnProperty.call(after, key)) findReplacements(before[key], after[key], [...parts, key]);
    }
  }
  findReplacements(base, head, []);
  const paths = new Map();
  const b = flattenInto(base, [], Object.create(null), paths);
  const h = flattenInto(head, [], Object.create(null), paths);
  const keys = new Set([...Object.keys(b), ...Object.keys(h)]);
  for (const key of keys) {
    const parts = paths.get(key);
    if (replacements.some((prefix) => prefix.length <= parts.length && prefix.every((part, index) => part === parts[index]))) continue;
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    const inH = Object.prototype.hasOwnProperty.call(h, key);
    if (inB && !inH) rows.push({ subject: key, kind: 'removed', before: JSON.parse(b[key]), after: null });
    else if (!inB && inH) rows.push({ subject: key, kind: 'added', before: null, after: JSON.parse(h[key]) });
    else if (b[key] !== h[key]) rows.push({ subject: key, kind: 'changed', before: JSON.parse(b[key]), after: JSON.parse(h[key]) });
  }
  rows.sort((a, b) => a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);
  return { rows, summary: { added: rows.filter((r) => r.kind === 'added').length, removed: rows.filter((r) => r.kind === 'removed').length, changed: rows.filter((r) => r.kind === 'changed').length } };
}

// 状态时间线：所有节点 history 中 at >= since 的迁移行（确定性排序：at,node,axis）。
export function stateTimeline(sidecar, sinceIso) {
  const rows = [];
  for (const nodeId of Object.keys(sidecar.nodes || {}).sort()) {
    const node = sidecar.nodes[nodeId];
    for (const entry of node.history || []) {
      if (sinceIso && String(entry.at) < sinceIso) continue;
      rows.push({ node: nodeId, at: entry.at, kind: entry.kind, from: entry.from ?? null, to: entry.to ?? null, reason: entry.reason ?? null, by: entry.by ?? null });
    }
  }
  rows.sort((x, y) => (x.at === y.at ? (x.node < y.node ? -1 : 1) : (x.at < y.at ? -1 : 1)));
  return rows;
}

