// 图件 id ↔ 账本节点 id 解析入口的单元牙齿（0.37.0：归一化只剩大小写，项目前缀差异由 specRefs 显式认领）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedgerIndex, resolveSpecBinding } from '../lib/spec-id.mjs';

const node = (over) => ({ owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [], ...over });

test('resolveSpecBinding：仅差大小写 ⇒ via=normalized；仅差前缀 ⇒ 不绑定；前缀 + spec-ref 认领 ⇒ via=spec-ref', () => {
  const nodes = { foo: node({}), 'demo-b-bar': node({}), 'demo-b-baz': node({ specRefs: ['d/baz'] }) };
  const index = buildLedgerIndex(nodes);
  assert.deepEqual(resolveSpecBinding({ nodes, index, specId: 'Foo', specName: 'd' }).via, 'normalized');
  const bar = resolveSpecBinding({ nodes, index, specId: 'bar', specName: 'd' });
  assert.equal(bar.nodeId, null);
  assert.deepEqual(bar.ambiguous, []);
  const baz = resolveSpecBinding({ nodes, index, specId: 'baz', specName: 'd' });
  assert.equal(baz.nodeId, 'demo-b-baz');
  assert.equal(baz.via, 'spec-ref');
});

test('buildLedgerIndex：归一化键只折叠大小写——`x` 与 `X` 歧义，`x` 与 `demo-b-x` 不歧义（前缀不再特判）', () => {
  const index = buildLedgerIndex({ x: node({}), X: node({}), 'demo-b-x': node({}) });
  assert.deepEqual(index.byKey.get('x'), ['x', 'X']);
  assert.deepEqual(index.byKey.get('demo-b-x'), ['demo-b-x']);
  const r = resolveSpecBinding({ nodes: { x: node({}), X: node({}) }, index: buildLedgerIndex({ x: node({}), X: node({}) }), specId: 'x' });
  assert.equal(r.nodeId, 'x', '精确命中优先于歧义');
});
