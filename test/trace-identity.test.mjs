import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addTrace, replayNode, listTraces } from '../lib/trace.mjs';

for (const id of ['constructor', '__proto__', 'toString', 'missing']) {
  test(`trace rejects absent own node ${id} without mutation`, () => {
    const sc = { nodes: {}, unknown: { retained: true } };
    const before = structuredClone(sc);
    assert.equal(replayNode(sc, id), null);
    assert.throws(() => addTrace(sc, { kind: 'decision', node: id }), { code: 'node_not_found' });
    assert.deepEqual(sc, before);
  });
  test(`CLI replay rejects absent own node ${id}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-identity-'));
    try {
      const file = path.join(dir, 'state.json');
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, nodes: {} }));
      const res = spawnSync(process.execPath, [new URL('../bin/atlas-engine.mjs', import.meta.url).pathname, 'trace', 'replay', '--sidecar', file, '--node', id], { encoding: 'utf8' });
      assert.equal(res.status, 1);
      assert.match(res.stdout, /node_not_found/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test(`CLI trace add rejects absent own node ${id} without writing`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-add-identity-'));
    t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
    const file = path.join(dir, 'state.json');
    const before = JSON.stringify({schemaVersion:1, nodes:{}});
    fs.writeFileSync(file, before);
    const res = spawnSync(process.execPath, [new URL('../bin/atlas-engine.mjs', import.meta.url).pathname,
      'trace', 'add', '--kind', 'decision', '--node', id, '--sidecar', file], {encoding:'utf8'});
    assert.equal(res.status, 1, res.stdout);
    assert.equal(JSON.parse(res.stdout).diagnostics[0].rule, 'node_not_found');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}
test('own constructor node accepts anchors; unanchored and old dangling traces remain available', () => {
  const sc = { nodes: { constructor: { history: [], traceRefs: null } }, trace: [{ id: 'old', node: 'gone', at: 'unknown' }] };
  const event = addTrace(sc, { kind: 'decision', node: 'constructor' });
  assert.deepEqual(sc.nodes.constructor.traceRefs, [event.id]);
  assert.ok(replayNode(sc, 'constructor'));
  addTrace(sc, { kind: 'decision' });
  assert.equal(listTraces(sc, 'gone').length, 1);
});
