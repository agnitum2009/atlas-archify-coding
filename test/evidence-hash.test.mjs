// 锚行哈希三态牙齿（缺口② 语义绑定增强，2026-08-16；先例=pi-readseek 的 LINE:HASH 模式）。
// 覆盖：evidence-add 落哈希；改行 → drifted（doctor 与 report 双路）→ 复原回 ok；
// 旧侧车 unhashed 容忍不误报 drifted；broken 语义回归不变；回填脚本 填/幂等/跳过 broken/备份存在；
// report a1-evidence-drifted 为 warning 不 error。
// 红线：全部用临时目录，绝不触碰 <home>/demo-ledger。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lineHash, computeLocatorHash, anchorState } from '../lib/evidence.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { buildReport } from '../lib/report.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
const BACKFILL = new URL('../scripts/backfill-evidence-hashes.mjs', import.meta.url).pathname;

const h12 = (s) => crypto.createHash('sha256').update(String(s).trim(), 'utf8').digest('hex').slice(0, 12);

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-hash-'));
}

function seedSidecar(dir, nodes) {
  const p = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, atlas: null, nodes, trace: [], lessons: [], notices: [] }) + '\n');
  return p;
}

function nodeOf(over) {
  return Object.assign({ owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, over || {});
}

function specOf(ids) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'hash-test', quality_profile: 'showcase' },
    components: ids.map((id) => ({ id, type: 'backend', label: id, pos: [0, 0], size: [100, 60] })),
    boundaries: [],
    connections: [],
  };
}

test('lineHash/computeLocatorHash/anchorState 单元：trim 后 sha256 前 12 hex；读取失败 null；三态判定边界', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'a.ts');
  fs.writeFileSync(f, '  padded line  \nsecond\n');
  assert.equal(lineHash('  padded line  '), h12('padded line'), 'trim 后内容计算');
  assert.equal(lineHash('padded line').length, 12);
  assert.equal(computeLocatorHash(f + ':1', dir), h12('padded line'));
  assert.equal(computeLocatorHash(f + ':2', dir), h12('second'));
  assert.equal(computeLocatorHash(path.join(dir, 'ghost.ts') + ':1', dir), null, '文件缺 → null');
  assert.equal(computeLocatorHash(f + ':99', dir), null, '行越界 → null');
  assert.equal(anchorState(f + ':1', { h: h12('padded line') }, dir), 'ok');
  assert.equal(anchorState(f + ':1', { h: h12('篡改') }, dir), 'drifted');
  assert.equal(anchorState(f + ':1', null, dir), 'unhashed', '无哈希锚不算 drifted');
  assert.equal(anchorState(f + ':1', {}, dir), 'unhashed');
  assert.equal(anchorState(path.join(dir, 'ghost.ts') + ':1', { h: h12('x') }, dir), 'broken', '文件缺优先判 broken 不判 drifted');
  assert.equal(anchorState(f + ':99', { h: h12('x') }, dir), 'broken', '行越界优先判 broken');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-add 落哈希：evidenceMeta 值精确（trim 后 sha256 前 12）；evidence 数组保持纯字符串', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'one\ntwo  \nthree\n');
  const sidecar = path.join(dir, 'atlas-state.json');
  const set = run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);
  assert.equal(set.code, 0, set.stdout);
  const add = run(['state', 'evidence-add', '--node', 'n1', '--locator', f + ':2', '--sidecar', sidecar]);
  assert.equal(add.code, 0, add.stdout);
  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual(side.nodes.n1.evidence, [f + ':2'], 'evidence 数组纯字符串不动');
  const meta = side.nodes.n1.evidenceMeta[f + ':2'];
  assert.ok(meta, 'evidenceMeta 以锚字符串为键');
  assert.equal(meta.h, h12('two'), '哈希=目标行 trim 后内容 sha256 前 12 hex');
  assert.ok(!Number.isNaN(Date.parse(meta.at)), 'at 为可解析时间戳');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evidence-add 行读取失败不阻断落锚：文件缺仍成功写入锚，无 evidenceMeta 条目（=unhashed）', () => {
  const dir = tmpDir();
  const sidecar = path.join(dir, 'atlas-state.json');
  run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);
  const add = run(['state', 'evidence-add', '--node', 'n1', '--locator', path.join(dir, 'ghost.ts') + ':1', '--sidecar', sidecar]);
  assert.equal(add.code, 0, '锚已过格式校验，读取失败不阻断落锚：' + add.stdout);
  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual(side.nodes.n1.evidence, [path.join(dir, 'ghost.ts') + ':1']);
  assert.ok(!side.nodes.n1.evidenceMeta || !side.nodes.n1.evidenceMeta[path.join(dir, 'ghost.ts') + ':1'], '哈希缺失=unhashed，不落空条目');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doctor 三态：ok → 改行 drifted → 复原回 ok；detail 文案含复核提示；drifted 同 broken 使检查 ok:false', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'original\nsecond\n');
  const anchor = f + ':1';
  const sidecar = seedSidecar(dir, { n1: nodeOf({ evidence: [anchor], evidenceMeta: { [anchor]: { h: h12('original'), at: '2026-08-16T00:00:00.000Z' } } }) });

  // ok：哈希匹配。
  let d = runDoctor({ sidecar });
  let ev = d.evidenceResolvability;
  assert.deepEqual({ total: ev.total, ok: ev.ok, broken: ev.broken, drifted: ev.drifted, unhashed: ev.unhashed, brokenNodes: ev.brokenNodes, driftedNodes: ev.driftedNodes },
    { total: 1, ok: 1, broken: 0, drifted: 0, unhashed: 0, brokenNodes: [], driftedNodes: [] });
  assert.equal(d.checks.find((c) => c.name === 'evidence-resolvability').ok, true);

  // 改行 → drifted。
  fs.writeFileSync(f, 'CHANGED\nsecond\n');
  d = runDoctor({ sidecar });
  ev = d.evidenceResolvability;
  assert.deepEqual({ total: ev.total, ok: ev.ok, broken: ev.broken, drifted: ev.drifted, unhashed: ev.unhashed }, { total: 1, ok: 0, broken: 0, drifted: 1, unhashed: 0 });
  assert.deepEqual(ev.driftedNodes, ['n1'], 'driftedNodes 与 brokenNodes 同式（前 5 去重）');
  const check = d.checks.find((c) => c.name === 'evidence-resolvability');
  assert.equal(check.ok, false, 'drifted 与 broken 一样使该检查 ok:false');
  assert.ok(check.detail.includes('锚内容已漂移'), check.detail);
  assert.ok(check.detail.includes('重新 evidence-add'), check.detail);

  // 复原 → 回 ok。
  fs.writeFileSync(f, 'original\nsecond\n');
  d = runDoctor({ sidecar });
  ev = d.evidenceResolvability;
  assert.deepEqual({ ok: ev.ok, broken: ev.broken, drifted: ev.drifted }, { ok: 1, broken: 0, drifted: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doctor：旧侧车无 evidenceMeta → unhashed 容忍，不误报 drifted，检查 ok:true；CLI exit 0', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'a\nb\n');
  const sidecar = seedSidecar(dir, { legacy: nodeOf({ evidence: [f + ':1', f + ':2'] }) });
  const d = runDoctor({ sidecar });
  const ev = d.evidenceResolvability;
  assert.deepEqual({ total: ev.total, ok: ev.ok, broken: ev.broken, drifted: ev.drifted, unhashed: ev.unhashed, driftedNodes: ev.driftedNodes },
    { total: 2, ok: 0, broken: 0, drifted: 0, unhashed: 2, driftedNodes: [] });
  assert.equal(d.checks.find((c) => c.name === 'evidence-resolvability').ok, true, '存量无哈希锚不算数据债失败');
  assert.ok(d.checks.find((c) => c.name === 'evidence-resolvability').detail.includes('unhashed 2'), d.checks.find((c) => c.name === 'evidence-resolvability').detail);

  const ARCHIFY_STUB = path.join(os.tmpdir(), 'atlas-hash-archify-stub.mjs');
  fs.writeFileSync(ARCHIFY_STUB, 'process.exit(0);\n');
  const cli = spawnSync(process.execPath, [BIN, 'doctor', '--sidecar', sidecar], { encoding: 'utf8', env: { ...process.env, ARCHIFY_BIN: ARCHIFY_STUB } });
  assert.equal(cli.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doctor broken 语义回归不变：文件缺/行越界仍计 broken（有哈希也判 broken 不判 drifted）；混合三态合计精确', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'one\ntwo\nthree\n');
  const ghost = path.join(dir, 'ghost.ts') + ':1';
  const oob = f + ':99';
  const drifted = f + ':2';
  const plain = f + ':3';
  const sidecar = seedSidecar(dir, {
    a: nodeOf({ evidence: [ghost, oob], evidenceMeta: { [ghost]: { h: h12('x'), at: 't' }, [oob]: { h: h12('y'), at: 't' } } }),
    b: nodeOf({ evidence: [drifted, plain], evidenceMeta: { [drifted]: { h: h12('篡改'), at: 't' }, [plain]: { h: h12('three'), at: 't' } } }),
  });
  const d = runDoctor({ sidecar });
  const ev = d.evidenceResolvability;
  assert.deepEqual({ total: ev.total, ok: ev.ok, broken: ev.broken, drifted: ev.drifted, unhashed: ev.unhashed },
    { total: 4, ok: 1, broken: 2, drifted: 1, unhashed: 0 });
  assert.deepEqual(ev.brokenNodes, ['a']);
  assert.deepEqual(ev.driftedNodes, ['b']);
  assert.equal(d.checks.find((c) => c.name === 'evidence-resolvability').ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doctor --stats：evidence 小节增 hashed 计数（有哈希锚数；与哈希是否匹配无关）', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'one\ntwo\n');
  const sidecar = seedSidecar(dir, {
    n: nodeOf({ evidence: [f + ':1', f + ':2', path.join(dir, 'ghost.ts') + ':1'], evidenceMeta: { [f + ':1']: { h: h12('one'), at: 't' }, [f + ':2']: { h: h12('篡改'), at: 't' } } }),
  });
  const d = runDoctor({ sidecar, stats: true });
  assert.deepEqual(d.stats.evidence, { total: 3, absolute: 3, relative: 0, hashed: 2 }, 'hashed=携带哈希的锚数（drifted 也算 hashed）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report A1：声称对齐节点改行 → warning a1-evidence-drifted（非 error，exit 0）；复原后消音；nonClaims 增哈希句', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'claim line\nb\n');
  const anchor = f + ':1';
  const sidecar = { schemaVersion: 1, nodes: { n: nodeOf({ progress: 'verified', evidence: [anchor], evidenceMeta: { [anchor]: { h: h12('claim line'), at: 't' } } }) } };

  // ok 基线：无 a1 诊断（除缺 sha 警告外无 a1-evidence-drifted）。
  const okRun = buildReport(sidecar, { root: dir, specs: [specOf(['n'])] });
  assert.ok(!okRun.warnings.some((w) => w.rule === 'a1-evidence-drifted'));

  // 改行 → drifted warning，不升 error。
  fs.writeFileSync(f, 'drifted line\nb\n');
  const r = buildReport(sidecar, { root: dir, specs: [specOf(['n'])] });
  const drift = r.warnings.filter((w) => w.rule === 'a1-evidence-drifted');
  assert.equal(drift.length, 1);
  assert.equal(drift[0].severity, 'warning');
  assert.equal(drift[0].subject, 'n');
  assert.ok(drift[0].evidence.includes('复核'), drift[0].evidence);
  assert.equal(r.errors.filter((e) => e.rule === 'a1-evidence-broken').length, 0, '行在界不算 broken');
  assert.equal(r.a1.warnings, 1);
  assert.ok(r.a1.nonClaims.some((c) => c.includes('哈希') && c.includes('语义支撑')), 'nonClaims 声明哈希只证行内容未变');

  // CLI 全链路：drifted 仅 warning → status=ok exit 0。
  const sidecarPath = seedSidecar(dir, sidecar.nodes);
  const cli = run(['report', '--sidecar', sidecarPath, '--spec', seedSpec(dir)]);
  assert.equal(cli.code, 0, 'a1-evidence-drifted 为 warning 不 error，不触发 exit 1：' + cli.stdout);
  assert.equal(cli.receipt.status, 'ok');
  assert.ok(cli.receipt.data.warnings.some((w) => w.rule === 'a1-evidence-drifted'));

  // 复原 → 回 ok，drifted 消音。
  fs.writeFileSync(f, 'claim line\nb\n');
  const healed = buildReport(sidecar, { root: dir, specs: [specOf(['n'])] });
  assert.ok(!healed.warnings.some((w) => w.rule === 'a1-evidence-drifted'));
  fs.rmSync(dir, { recursive: true, force: true });

  function seedSpec(d) {
    const p = path.join(d, 'spec.json');
    fs.writeFileSync(p, JSON.stringify(specOf(['n'])));
    return p;
  }
});

test('report A1：旧侧车无哈希 → unhashed 不发声（不误报 drifted）；broken 仍 error a1-evidence-broken', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.ts');
  fs.writeFileSync(f, 'one\n');
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      legacy: nodeOf({ progress: 'verified', evidence: [f + ':1'] }), // 无 evidenceMeta：存量容忍
      broken: nodeOf({ progress: 'verified', evidence: [path.join(dir, 'ghost.ts') + ':1', f + ':77'] }),
    },
  };
  const r = buildReport(sidecar, { root: dir, specs: [specOf(['legacy', 'broken'])] });
  assert.ok(!r.warnings.some((w) => w.rule === 'a1-evidence-drifted'), '存量锚不判 drifted');
  const brokenErr = r.errors.filter((e) => e.rule === 'a1-evidence-broken');
  assert.equal(brokenErr.length, 1);
  assert.equal(brokenErr[0].subject, 'broken', 'broken 语义回归不变');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('回填脚本：填/幂等/跳过 broken/备份存在（history 区优先，缺失退侧车同目录 fail-loud）', () => {
  // 七区制形态：tmp/state/atlas-state.json + tmp/history/。
  const root = tmpDir();
  const stateDir = path.join(root, 'state');
  const historyDir = path.join(root, 'history');
  fs.mkdirSync(stateDir);
  fs.mkdirSync(historyDir);
  const f = path.join(root, 'code.ts');
  fs.writeFileSync(f, 'alpha\nbeta\n');
  const ghost = path.join(root, 'ghost.ts') + ':1';
  const sidecarPath = path.join(stateDir, 'atlas-state.json');
  fs.writeFileSync(sidecarPath, JSON.stringify({
    schemaVersion: 1, revision: 3, atlas: null,
    nodes: {
      n1: nodeOf({ evidence: [f + ':1', f + ':99', ghost, 'rel/legacy.ts:2'] }),
      n2: nodeOf({ evidence: [f + ':2'], evidenceMeta: { [f + ':2']: { h: h12('beta'), at: 't' } } }),
    },
    trace: [], lessons: [], notices: [],
  }) + '\n');

  const runBackfill = () => {
    const res = spawnSync(process.execPath, [BACKFILL, '--sidecar', sidecarPath], { encoding: 'utf8' });
    let summary = null;
    try { summary = JSON.parse(res.stdout); } catch { /* 留空 */ }
    return { code: res.status, summary, stdout: res.stdout, stderr: res.stderr };
  };

  // 第一跑：填 1（f:1）；跳过已有 1（f:2）；broken 2（f:99 越界 + ghost 缺文件）；相对 1 不回填。
  const first = runBackfill();
  assert.equal(first.code, 0, 'broken 仅报告不阻断：' + first.stdout + first.stderr);
  assert.equal(first.summary.filled, 1);
  assert.equal(first.summary.skippedExisting, 1);
  assert.equal(first.summary.broken, 2);
  assert.equal(first.summary.relativeSkipped, 1);
  assert.equal(first.summary.brokenLocators.length, 2);
  assert.ok(first.summary.brokenLocators.some((l) => l.includes(f + ':99')));
  assert.ok(first.summary.brokenLocators.some((l) => l.includes(ghost)));

  // 备份落在七区 history/，内容=回填前整份。
  const backupPath = first.summary.backup;
  assert.ok(backupPath.startsWith(historyDir), 'history 目录存在时备份进 history 区：' + backupPath);
  assert.ok(fs.existsSync(backupPath));
  assert.equal(first.summary.backupFallback, false);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.revision, 3, '备份是回填前原样（revision 未推）');
  assert.ok(!backup.nodes.n1.evidenceMeta, '备份无回填痕迹');

  // 侧车被回填：值精确 + CAS revision 推进。
  const side = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.equal(side.nodes.n1.evidenceMeta[f + ':1'].h, h12('alpha'));
  assert.equal(side.revision, 4, 'saveSidecar CAS 推进 revision');
  assert.ok(!side.nodes.n1.evidenceMeta[f + ':99'], 'broken 不落条目');
  assert.ok(!side.nodes.n1.evidenceMeta[ghost], 'broken 不落条目');
  assert.ok(!side.nodes.n1.evidenceMeta['rel/legacy.ts:2'], '相对锚不回填');

  // 第二跑：全幂等——零填写、零新备份、revision 不动。
  const second = runBackfill();
  assert.equal(second.code, 0);
  assert.equal(second.summary.filled, 0);
  assert.equal(second.summary.skippedExisting, 2);
  assert.equal(second.summary.broken, 2);
  assert.equal(second.summary.backup, null, '零写入不备份');
  assert.equal(JSON.parse(fs.readFileSync(sidecarPath, 'utf8')).revision, 4, '幂等重跑零 revision 推进');

  // history 缺失形态：退侧车同目录 + stderr fail-loud 说明。
  const plain = tmpDir();
  const f2 = path.join(plain, 'x.ts');
  fs.writeFileSync(f2, 'one\n');
  const plainSidecar = path.join(plain, 'atlas-state.json');
  fs.writeFileSync(plainSidecar, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: { n: nodeOf({ evidence: [f2 + ':1'] }) }, trace: [], lessons: [], notices: [] }) + '\n');
  const third = spawnSync(process.execPath, [BACKFILL, '--sidecar', plainSidecar], { encoding: 'utf8' });
  assert.equal(third.status, 0);
  const thirdSummary = JSON.parse(third.stdout);
  assert.equal(thirdSummary.filled, 1);
  assert.equal(thirdSummary.backupFallback, true);
  assert.ok(thirdSummary.backup.startsWith(plain), '退到侧车同目录：' + thirdSummary.backup);
  assert.ok(fs.existsSync(thirdSummary.backup));
  assert.ok(third.stderr.includes('history') && third.stderr.includes('退'), 'fail-loud 说明：' + third.stderr);

  // 用法错误：缺 --sidecar = exit 1。
  const noArg = spawnSync(process.execPath, [BACKFILL], { encoding: 'utf8' });
  assert.equal(noArg.status, 1);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });
});
