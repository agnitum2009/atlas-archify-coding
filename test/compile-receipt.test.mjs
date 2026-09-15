import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileFiles } from '../lib/compile.mjs';
const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-receipt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const source = path.join(a, 'source.json'), ledger = path.join(dir, 'state.json'), first = path.join(a, 'first.json'), receiptPath = path.join(dir, 'receipt.json');
  fs.writeFileSync(source, JSON.stringify({ components: [{ id: 'x', tag: '作者' }] }));
  fs.writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: { owner: { progress: 'verified', truth: 'candidate', ledger: 'clean', owner: 'o', evidence: [], history: [], specRefs: ['source/x'] } } }));
  return { dir, a, b, source, ledger, first, receiptPath };
}
function run(cwd, args) {
  const result = spawnSync(process.execPath, [BIN, 'compile', ...args, '--no-trace'], { cwd, encoding: 'utf8' });
  return { code: result.status, receipt: JSON.parse(result.stdout) };
}
test('CLI receipts bind output across cwd and renamed outputs, preserve graph scope, revoke ambiguous tags', (t) => {
  const f = setup(t);
  const first = run(f.a, ['--diagram', 'source.json', '--sidecar', f.ledger, '--out', 'first.json']);
  assert.equal(first.code, 0);
  fs.writeFileSync(f.receiptPath, JSON.stringify(first.receipt));
  // Formatting is deliberately changed; digest binds parsed JSON, not disk bytes.
  fs.writeFileSync(f.first, JSON.stringify(JSON.parse(fs.readFileSync(f.first)), null, 4));
  const second = run(f.b, ['--diagram', f.first, '--sidecar', f.ledger, '--out', 'renamed.json', '--previous-receipt', f.receiptPath]);
  assert.equal(second.code, 0);
  assert.equal(second.receipt.data.out, 'renamed.json');
  assert.equal(second.receipt.data.injected.outputPath, path.join(f.b, 'renamed.json'));
  assert.equal(second.receipt.data.injected.diagramName, 'source');
  assert.equal(second.receipt.data.injected.tags, 1);
  fs.writeFileSync(f.receiptPath, JSON.stringify(second.receipt));
  const ledger = JSON.parse(fs.readFileSync(f.ledger));
  ledger.nodes.other = { ...ledger.nodes.owner };
  fs.writeFileSync(f.ledger, JSON.stringify(ledger));
  const third = run(f.b, ['--diagram', 'renamed.json', '--sidecar', f.ledger, '--out', 'third.json', '--previous-receipt', f.receiptPath]);
  assert.equal(third.code, 0);
  assert.equal(third.receipt.data.injected.tags, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.b, 'third.json'))).components[0].tag, '作者');
  assert.equal(JSON.parse(fs.readFileSync(f.ledger)).trace, undefined);
});

test('receipt validation fails before overwriting output for wrong identity, digest and malformed ownership', (t) => {
  const f = setup(t);
  const data = compileFiles(f.source, f.ledger, f.first);
  const valid = { schemaVersion: 1, command: 'compile', status: 'ok', data };
  const output = path.join(f.b, 'existing.json');
  const mutations = [
    r => { r.schemaVersion = 2; }, r => { r.command = 'report'; }, r => { r.status = 'failed'; },
    r => { r.data.out = 3; }, r => { r.data.sha256 = '0'.repeat(64); },
    r => { r.data.injected.outputPath = f.source; }, r => { delete r.data.injected.outputPath; },
    r => { r.data.injected.outputPath = 'first.json'; }, r => { delete r.data.injected.diagramName; },
    r => { r.data.injected.diagramName = ''; }, r => { delete r.data.injected.ownedTags; },
    r => { r.data.injected.ownedTags = [{ collection: 'unknown' }]; },
    r => { r.data.injected.ownedTags = [r.data.injected.ownedTags[0], r.data.injected.ownedTags[0]]; },
  ];
  for (const mutate of mutations) {
    const receipt = structuredClone(valid); mutate(receipt);
    fs.writeFileSync(f.receiptPath, JSON.stringify(receipt)); fs.writeFileSync(output, 'unchanged');
    assert.throws(() => compileFiles(f.first, f.ledger, output, { previousReceiptPath: f.receiptPath }), { code: 'bad_input' });
    assert.equal(fs.readFileSync(output, 'utf8'), 'unchanged');
  }
  fs.writeFileSync(f.receiptPath, JSON.stringify(valid));
  const edited = JSON.parse(fs.readFileSync(f.first)); edited.components[0].tag = '作者后改';
  fs.writeFileSync(f.first, JSON.stringify(edited));
  assert.throws(() => compileFiles(f.first, f.ledger, output, { previousReceiptPath: f.receiptPath }), { code: 'bad_input' });
  assert.equal(fs.readFileSync(output, 'utf8'), 'unchanged');
});
