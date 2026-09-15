// O5 牙齿（2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O5）：
// gate 收尾 append 一行逐闸 detail JSONL 到 <atlas>/data/<project>/gate-detail.jsonl（只追加不覆盖；
// fail-fast 未跑闸记 skip 不丢；无 atlas 语境/--no-trace 不落盘）。
import { test } from 'node:test';
import { writeFakeArchify } from './fake-archify.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, env) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout };
}

function specJson() {
  return JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] });
}

function stub(file, exitCode) {
  fs.writeFileSync(file, 'process.exit(' + exitCode + ');\n');
  return file;
}

// 造 atlas：state/{projects.json, atlas-demo.json} + spec/demo/；图件可放在 atlas 内或外部 git 仓。
function mkAtlas(specDir) {
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-detail-'));
  fs.mkdirSync(path.join(atlas, 'state'), { recursive: true });
  fs.mkdirSync(path.join(specDir, 'spec', 'demo'), { recursive: true });
  const spec = path.join(specDir, 'spec', 'demo', 'demo.json');
  fs.writeFileSync(spec, specJson());
  fs.writeFileSync(path.join(atlas, 'state', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sourcePath: null, sidecar: 'atlas-demo.json' }] }, null, 2));
  const sidecar = path.join(atlas, 'state', 'atlas-demo.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: {} }, null, 2) + '\n');
  return { atlas, sidecar };
}

test('O5 pass：逐闸 pass/exit/耗时 + specDirHash + totalExit 入 JSONL（目录自建，append-only）', () => {
  const atlas = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-atlas-'));
  fs.mkdirSync(path.join(atlas, 'state'), { recursive: true });
  fs.mkdirSync(path.join(atlas, 'spec', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(atlas, 'spec', 'demo', 'demo.json'), specJson());
  fs.writeFileSync(path.join(atlas, 'state', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'demo', umbrella: 'demo-add', sidecar: 'atlas-demo.json' }] }, null, 2));
  const sidecar = path.join(atlas, 'state', 'atlas-demo.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: {} }, null, 2) + '\n');
  const okStub = writeFakeArchify(atlas, 'ok.mjs');
  const log = path.join(atlas, 'data', 'demo', 'gate-detail.jsonl');
  assert.ok(!fs.existsSync(log), '前置：data/demo 不存在');

  const r1 = run(['gate', '--diagram', path.join(atlas, 'spec', 'demo', 'demo.json'), '--out', path.join(atlas, 'out.html'), '--sidecar', sidecar], { ARCHIFY_BIN: okStub });
  assert.equal(r1.code, 0, r1.stdout);
  assert.equal(r1.receipt.data.detailLog.path, log, '回执须报逐闸历史落点：' + r1.stdout);
  const lines1 = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines1.length, 1);
  const e = JSON.parse(lines1[0]);
  assert.equal(e.command, 'gate');
  assert.equal(e.project, 'demo');
  assert.equal(e.projectSource, 'sidecar-filename');
  assert.equal(e.final, 'pass');
  assert.equal(e.totalExit, 0);
  assert.equal(e.stage, null);
  assert.equal(e.specDirHash.sha256.length, 64, 'spec 目录内容哈希须落盘');
  assert.equal(e.specDirHash.truncated, false);
  assert.deepEqual(Object.keys(e.gates), ['validate', 'deliver', 'visual_check']);
  for (const g of Object.values(e.gates)) {
    assert.equal(g.status, 'pass');
    assert.equal(g.exit, 0);
    assert.ok(typeof g.ms === 'number' && g.ms >= 0, '逐闸耗时须落盘');
  }
  assert.equal(e.head, null, '非 git 仓的图件 → head=null 不误报');
  assert.equal(e.diagram.sha256.length, 64);

  const r2 = run(['gate', '--diagram', path.join(atlas, 'spec', 'demo', 'demo.json'), '--out', path.join(atlas, 'out.html'), '--sidecar', sidecar], { ARCHIFY_BIN: okStub });
  assert.equal(r2.code, 0, r2.stdout);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2, '只追加不覆盖（历史可回溯「哪次哪个闸红了」）');
  // trace 侧也携带逐闸 detail（kind=command 的 detail.result，纯增字段；JSONL 才是 append-only 主账）。
  const sc = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  const last = sc.trace[sc.trace.length - 1];
  assert.equal(last.detail.result.gateDetail.validate.status, 'pass');
  assert.equal(last.detail.result.gateDetail.visual_check.exit, 0);
  assert.equal(last.detail.result.detailLog, log);
  fs.rmSync(atlas, { recursive: true, force: true });
});

test('O5 fail-fast：已跑闸记 fail、未跑闸记 skip（不丢），totalExit=1', () => {
  const specDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-spec-'));
  const { atlas, sidecar } = mkAtlas(specDir);
  const badStub = stub(path.join(atlas, 'bad.mjs'), 1);
  const r = run(['gate', '--diagram', path.join(specDir, 'spec', 'demo', 'demo.json'), '--out', path.join(atlas, 'out.html'), '--sidecar', sidecar], { ARCHIFY_BIN: badStub });
  assert.equal(r.code, 1, r.stdout);
  assert.ok(r.receipt.data.detailLog, '失败路径同样落盘：' + r.stdout);
  const e = JSON.parse(fs.readFileSync(r.receipt.data.detailLog.path, 'utf8').trim());
  assert.equal(e.final, 'fail');
  assert.equal(e.stage, 'validate');
  assert.equal(e.totalExit, 1);
  assert.equal(e.gates.validate.status, 'fail');
  assert.equal(e.gates.validate.exit, 1);
  assert.equal(e.gates.deliver.status, 'skip', 'fail-fast 未跑闸须记 skip（不静默无记录）');
  assert.equal(e.gates.visual_check.status, 'skip');
  fs.rmSync(specDir, { recursive: true, force: true });
  fs.rmSync(atlas, { recursive: true, force: true });
});

test('O5 --no-trace 关闭落盘；无 --sidecar（或非 atlas 语境）不落盘零副作用', () => {
  const specDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-spec2-'));
  const { atlas, sidecar } = mkAtlas(specDir);
  const okStub = writeFakeArchify(atlas, 'ok.mjs');
  const spec = path.join(specDir, 'spec', 'demo', 'demo.json');

  const noTrace = run(['gate', '--diagram', spec, '--out', path.join(atlas, 'o1.html'), '--sidecar', sidecar, '--no-trace'], { ARCHIFY_BIN: okStub });
  assert.equal(noTrace.code, 0, noTrace.stdout);
  assert.equal(noTrace.receipt.data.detailLog, undefined, '--no-trace 不落盘');
  assert.ok(!fs.existsSync(path.join(atlas, 'data')), '--no-trace 不得建 data/ 目录');

  const noSidecar = run(['gate', '--diagram', spec, '--out', path.join(atlas, 'o2.html'), '--no-trace'], { ARCHIFY_BIN: okStub });
  assert.equal(noSidecar.code, 0, noSidecar.stdout);

  // 自由侧车（非 atlas 版式）→ 不落盘
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-plain-'));
  const plainSc = path.join(plain, 'sc.json');
  fs.writeFileSync(plainSc, JSON.stringify({ schemaVersion: 1, revision: 0, nodes: {} }) + '\n');
  const free = run(['gate', '--diagram', spec, '--out', path.join(plain, 'o.html'), '--sidecar', plainSc], { ARCHIFY_BIN: okStub });
  assert.equal(free.code, 0, free.stdout);
  assert.equal(free.receipt.data.detailLog, undefined, '非 atlas 语境不落盘');
  assert.ok(!fs.existsSync(path.join(plain, 'data')), '不得凭空造 data/');

  fs.rmSync(specDir, { recursive: true, force: true });
  fs.rmSync(atlas, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });
});

test('O5 head：图件在 git 仓内 → 落该仓 HEAD sha（交对账「这份闸跑在哪个码状态」）', () => {
  const specDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-spec3-'));
  const { atlas, sidecar } = mkAtlas(specDir);
  const git = (a) => spawnSync('git', ['-C', specDir].concat(a), { encoding: 'utf8' });
  git(['init', '-q']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'spec']);
  const okStub = writeFakeArchify(atlas, 'ok.mjs');
  const r = run(['gate', '--diagram', path.join(specDir, 'spec', 'demo', 'demo.json'), '--out', path.join(atlas, 'out.html'), '--sidecar', sidecar], { ARCHIFY_BIN: okStub });
  assert.equal(r.code, 0, r.stdout);
  const e = JSON.parse(fs.readFileSync(r.receipt.data.detailLog.path, 'utf8').trim());
  assert.equal(e.head.repo, specDir);
  assert.match(e.head.sha, /^[0-9a-f]{40}$/);
  fs.rmSync(specDir, { recursive: true, force: true });
  fs.rmSync(atlas, { recursive: true, force: true });
});
