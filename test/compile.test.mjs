// compile 牙齿：状态注入 tag + 焦点章节 + 不碰无关节点。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAtlas, PROGRESS_TAGS } from '../lib/compile.mjs';

function diagram() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'T', quality_profile: 'showcase' },
    components: [
      { id: 'a', type: 'backend', label: 'A' },
      { id: 'b', type: 'backend', label: 'B' },
      { id: 'untracked', type: 'backend', label: 'U' },
    ],
    boundaries: [],
    connections: [],
    cards: [],
  };
}

test('compileAtlas：在途节点注入 tag 并入焦点章节；已销账节点打勾；无关节点不动', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      a: { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [], history: [] },
      b: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [] },
    },
  };
  const { out, tagged, focus } = compileAtlas(diagram(), sidecar);
  assert.equal(tagged, 2);
  const a = out.components.find((c) => c.id === 'a');
  const b = out.components.find((c) => c.id === 'b');
  const u = out.components.find((c) => c.id === 'untracked');
  assert.equal(a.tag, PROGRESS_TAGS.in_progress);
  assert.equal(b.tag, '✅ 已销账');
  assert.equal(u.tag, undefined);
  assert.deepEqual(focus, ['a']);
  assert.equal(out.meta.views[0].id, 'current-focus');
  assert.deepEqual(out.meta.views[0].focus, ['a']);
  assert.ok(out.meta.views[0].label.includes('1'));
});

test('compileAtlas：无在途节点时不发声焦点章节（schema focus minItems=1，不造假焦点）', () => {
  const sidecar = { schemaVersion: 1, nodes: { b: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [] } } };
  const { out, focus } = compileAtlas(diagram(), sidecar);
  assert.equal(focus.length, 0);
  assert.equal(out.meta.views.length, 0);
});

test('compileAtlas：保留既有视图章节（去重 current-focus）', () => {
  const d = diagram();
  d.meta.views = [{ id: 'main', label: '主视图', focus: ['a'], note: 'x' }, { id: 'current-focus', label: '旧', focus: [], note: 'y' }];
  const sidecar = { schemaVersion: 1, nodes: {} };
  const { out } = compileAtlas(d, sidecar);
  assert.equal(out.meta.views.length, 1);
  assert.equal(out.meta.views[0].id, 'main');
});

function lifecycleDiagram() {
  return {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'T', quality_profile: 'showcase' },
    lanes: [{ id: 'main', label: '主轨' }],
    states: [
      { id: 'pile-p1', type: 'neutral', label: 'P1', lane: 'main', col: 0, tag: '未打桩' },
      { id: 'pile-p2', type: 'neutral', label: 'P2', lane: 'main', col: 1 },
      { id: 'untracked-state', type: 'neutral', label: 'U', lane: 'main', col: 2, tag: '盘点 v1' },
    ],
    transitions: [],
  };
}

test('compileAtlas：lifecycle states 同 id 节点注入 tag（图账同 id 约定），未入账 state 保留作者 tag', () => {
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      'pile-p1': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] },
      'pile-p2': { owner: 'o', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [], history: [] },
    },
  };
  const { out, tagged, focus } = compileAtlas(lifecycleDiagram(), sidecar);
  assert.equal(tagged, 2);
  const p1 = out.states.find((s) => s.id === 'pile-p1');
  const p2 = out.states.find((s) => s.id === 'pile-p2');
  const u = out.states.find((s) => s.id === 'untracked-state');
  assert.equal(p1.tag, PROGRESS_TAGS.planned);
  assert.equal(p2.tag, PROGRESS_TAGS.in_progress);
  assert.equal(u.tag, '盘点 v1');
  assert.deepEqual(focus, ['pile-p2']);
  assert.equal(out.meta.views[0].id, 'current-focus');
  assert.deepEqual(out.meta.views[0].focus, ['pile-p2']);
});

test('compileAtlas：无 states 的 diagram 不受影响（states 循环空转零注入）', () => {
  const sidecar = { schemaVersion: 1, nodes: {} };
  const { tagged, focus } = compileAtlas(diagram(), sidecar);
  assert.equal(tagged, 0);
  assert.equal(focus.length, 0);
});

test('compileAtlas：verified 独立验证与销账使用不同标签', () => {
  for (const [ledger, tag] of [['clean', '✅ 已验证'], ['backlog', '✅ 已验证'], ['settled', '✅ 已销账']]) {
    const { out } = compileAtlas({ components: [{ id: 'n', tag: '作者标签' }] }, { nodes: { n: { progress: 'verified', ledger } } });
    assert.equal(out.components[0].tag, tag);
  }
});

for (const original of [undefined, '', '作者', PROGRESS_TAGS.verified]) {
  test(`owned tags restore original ${JSON.stringify(original)} across idempotence and removal`, () => {
    const source = { components: [{ id: 'x', ...(original === undefined ? {} : { tag: original }) }], states: [{ id: 'x', tag: '状态作者' }] };
    const snapshot = structuredClone(source);
    const ledger = { nodes: { x: { progress: 'verified', ledger: 'clean' } } };
    const first = compileAtlas(source, ledger);
    const firstSnapshot = structuredClone(first.out);
    const repeated = compileAtlas(first.out, ledger, { previousOwnedTags: first.ownedTags });
    assert.deepEqual(repeated.ownedTags, first.ownedTags);
    const second = compileAtlas(repeated.out, { nodes: {} }, { previousOwnedTags: repeated.ownedTags });
    assert.deepEqual(second.out.components, source.components);
    assert.deepEqual(second.out.states, source.states);
    assert.deepEqual(second.ownedTags, []);
    assert.deepEqual(source, snapshot);
    assert.deepEqual(first.out, firstSnapshot);
  });
}

test('owned tags restore before ambiguous binding and preserve later author edits', () => {
  const first = compileAtlas({ components: [{ id: 'x', tag: '作者' }] }, { nodes: { x: { progress: 'verified' } } });
  const ambiguous = { nodes: { a: { specRefs: ['x'], progress: 'verified' }, b: { specRefs: ['x'], progress: 'verified' } } };
  const second = compileAtlas(first.out, ambiguous, { previousOwnedTags: first.ownedTags });
  assert.equal(second.out.components[0].tag, '作者');
  first.out.components[0].tag = '作者后改';
  assert.equal(compileAtlas(first.out, { nodes: {} }, { previousOwnedTags: first.ownedTags }).out.components[0].tag, '作者后改');
});

test('unknown ownership preserves and discloses legacy status tags', () => {
  for (const tag of [...Object.values(PROGRESS_TAGS), '✅ 已销账']) {
    const result = compileAtlas({ states: [{ id: 'x', tag }] }, { nodes: {} });
    assert.equal(result.out.states[0].tag, tag);
    assert.deepEqual(result.unknownOwnership, [{ collection: 'states', id: 'x', tag }]);
  }
});

test('explicit old tag wording is restored; malformed and duplicate ownership rejected', () => {
  const entry = { collection: 'components', id: 'x', written: '旧引擎文字', original: { present: false } };
  assert.equal(Object.hasOwn(compileAtlas({ components: [{ id: 'x', tag: entry.written }] }, {}, { previousOwnedTags: [entry] }).out.components[0], 'tag'), false);
  for (const previousOwnedTags of [null, {}, [entry, entry], [{ ...entry, collection: 'other' }], [{ ...entry, id: '' }], [{ ...entry, written: 3 }], [{ ...entry, extra: true }], [{ ...entry, original: { present: true } }], [{ ...entry, original: { present: false, value: '' } }]]) {
    assert.throws(() => compileAtlas({ components: [{ id: 'x' }] }, {}, { previousOwnedTags }), { code: 'bad_input' });
  }
});

test('duplicate diagram identities cannot produce ambiguous ownership receipts', () => {
  assert.throws(() => compileAtlas({ components: [{ id: 'x' }, { id: 'x' }] }, { nodes: { x: { progress: 'verified' } } }), { code: 'bad_input' });
});
