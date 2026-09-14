// ledger-size 阈值参数化（2026-09-11）的牙齿：无配置=默认（零破坏）；配置可覆盖；坏配置降级默认。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSizeLimits, LEDGER_SIZE_BYTES, LEDGER_SIZE_TRACES } from '../lib/doctor.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ledger-size-'));
  return { dir, sc: path.join(dir, 'atlas-x.json') };
}

test('ledgerSizeLimits：无配置文件 = 默认阈值（零破坏）', () => {
  const { sc } = mk();
  const r = ledgerSizeLimits(sc);
  assert.equal(r.maxBytes, LEDGER_SIZE_BYTES);
  assert.equal(r.maxTraces, LEDGER_SIZE_TRACES);
  assert.equal(r.source, 'default');
});

test('ledgerSizeLimits：配置文件可覆盖并透传 rationale', () => {
  const { dir, sc } = mk();
  fs.writeFileSync(path.join(dir, 'ledger-size.json'), JSON.stringify({ schemaVersion: 1, maxBytes: 4194304, maxTraces: 2000, rationale: 'measured' }));
  const r = ledgerSizeLimits(sc);
  assert.equal(r.maxBytes, 4194304);
  assert.equal(r.maxTraces, 2000);
  assert.equal(r.source, 'config');
  assert.equal(r.rationale, 'measured');
});

test('ledgerSizeLimits：坏文件或非法值一律降级默认（不抛错）', () => {
  const { dir, sc } = mk();
  const p = path.join(dir, 'ledger-size.json');
  fs.writeFileSync(p, '{ not json');
  assert.equal(ledgerSizeLimits(sc).source, 'default');
  fs.writeFileSync(p, JSON.stringify({ maxBytes: -1, maxTraces: 'x' }));
  const r = ledgerSizeLimits(sc);
  assert.equal(r.source, 'default');
  assert.equal(r.maxBytes, LEDGER_SIZE_BYTES);
  fs.writeFileSync(p, JSON.stringify({ maxBytes: 2048 }));
  const r2 = ledgerSizeLimits(sc);
  assert.equal(r2.source, 'config');
  assert.equal(r2.maxBytes, 2048);
  assert.equal(r2.maxTraces, LEDGER_SIZE_TRACES);
});
