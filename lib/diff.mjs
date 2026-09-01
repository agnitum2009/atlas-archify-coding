// diff（command-contract.md §4）：spec 结构差异 + 状态时间线。

// 把 JSON 拍平成 点路径→规范化值 的映射（确定性：键排序、值 canonical JSON 串）。
export function flatten(value, prefix = '', out = {}) {
  const entries = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => entries.push([String(index), item]));
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) entries.push([key, value[key]]);
  } else {
    out[prefix || '#'] = JSON.stringify(value);
    return out;
  }
  if (entries.length === 0) {
    out[prefix || '#'] = Array.isArray(value) ? '[]' : '{}';
    return out;
  }
  for (const [key, item] of entries) {
    const next = prefix ? prefix + '.' + key : key;
    flatten(item, next, out);
  }
  return out;
}

// 双 spec 规范化差异：rows = { subject(点路径), kind: added|removed|changed, before, after }。
export function diffSpecs(base, head) {
  const b = flatten(base);
  const h = flatten(head);
  const rows = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(h)]);
  for (const key of [...keys].sort()) {
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    const inH = Object.prototype.hasOwnProperty.call(h, key);
    if (inB && !inH) rows.push({ subject: key, kind: 'removed', before: JSON.parse(b[key]), after: null });
    else if (!inB && inH) rows.push({ subject: key, kind: 'added', before: null, after: JSON.parse(h[key]) });
    else if (b[key] !== h[key]) rows.push({ subject: key, kind: 'changed', before: JSON.parse(b[key]), after: JSON.parse(h[key]) });
  }
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

