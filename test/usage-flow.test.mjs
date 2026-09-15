import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('USAGE marked raw bash closes a task from an empty temporary directory', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const usage = fs.readFileSync(path.join(ROOT, 'docs/USAGE.md'), 'utf8');
  const region = usage.match(/<!-- atlas-example:start -->([\s\S]*?)<!-- atlas-example:end -->/);
  assert.ok(region, 'unique workflow marker');
  assert.equal((usage.match(/<!-- atlas-example:start -->/g) || []).length, 1);
  const blocks = [...region[1].matchAll(/```bash\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1);
  assert.match(blocks[0][1], /^set -eu\n/);
  const result = spawnSync('bash', ['-c', blocks[0][1]], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ATLAS_ENGINE_BIN: path.join(ROOT, 'bin/atlas-engine.mjs') },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const node = JSON.parse(fs.readFileSync(path.join(dir, 'demo-atlas/state/atlas-state.json'))).nodes['demo-task'];
  assert.equal(node.class, 'task');
  assert.equal(node.progress, 'verified');
  assert.equal(node.ledger, 'settled');
  assert.equal(node.history.at(-1).kind, 'settle');
});
