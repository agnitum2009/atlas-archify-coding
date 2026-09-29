// 0.22.0 写入规则四族与纠错公理（ADD-SPEC §2.4.2，2026-09-26 负责人确认）的穷举门禁。
// 背景：0.16.0→0.21.2 同族守卫反复补洞——每版只修复核单复现的那条路径，单测又刻意隔离规则交互
// （0.21.2 的提前 return 吞掉证据守卫即由此漏网）。本文件不再逐例钉守卫，而是：
//   ① 对 set/transition × progress/ledger × 全部前态 × 证据{无,可解析,不可解析} × 是否纠错 全空间逐一实跑 CLI，
//      与**按 §2.4.2 独立推导的预言**比对（退出码、全部诊断码、零写入、豁免留痕）；
//   ② 以纯模型断言公理下的可达性（收紧纠错不造死路）。
// 新增写入规则须先在 §2.4.2 归族并使本文件通过。红线：全部 mkdtemp 临时目录，不触碰真实侧车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin/atlas-engine.mjs');

const PROGRESS = ['planned', 'in_progress', 'blocked', 'verified', 'cancelled'];
const LEDGER = ['clean', 'backlog', 'settled'];
const TABLE = {
  progress: { planned: ['in_progress', 'cancelled'], in_progress: ['verified', 'blocked'], blocked: ['in_progress'], verified: [], cancelled: [] },
  ledger: { clean: ['backlog'], backlog: ['settled'], settled: [] },
};

// —— 预言：只依据 ADD-SPEC §2.4.2 推导，不引用 lib ——
function comboViolations(p, l) {
  const out = [];
  if (l === 'settled' && p !== 'verified') out.push('settled_requires_verified');
  if (p === 'cancelled' && l !== 'clean') out.push('cancelled_requires_clean');
  return out;
}

function oracle({ op, before, ev, axis, to, correction, fresh }) {
  if (correction && op !== 'set') return { ok: false, rules: ['bad_args'] };
  const from = before[axis];
  const after = { ...before, [axis]: to };
  const P = [];
  if (!fresh && !TABLE[axis][from].includes(to)) P.push('illegal_transition');
  if (axis === 'ledger' && to === 'settled') P.push('settled_requires_event');
  const S = comboViolations(after.progress, after.ledger); // 成员 progress/ledger 必被改动
  if (ev === 'none') {
    if (axis === 'progress' && to === 'cancelled') S.push('cancelled_requires_evidence');
    else if ((axis === 'progress' && to === 'verified') || (axis === 'ledger' && to === 'settled')) S.push('verified_requires_evidence');
  }
  const X = [];
  if (ev === 'bad' && ((axis === 'progress' && to === 'verified') || (axis === 'ledger' && to === 'settled'))) X.push('evidence_unresolvable');
  const waivable = op === 'set' && correction;
  const blocking = [...(waivable ? [] : P), ...S, ...X];
  if (blocking.length > 0) return { ok: false, rules: blocking };
  return { ok: true, waived: waivable ? P : [] };
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: ROOT });
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.on('close', (code) => {
      let receipt = null;
      try { receipt = JSON.parse(stdout); } catch { /* 坏回执 = null，断言会暴露 */ }
      resolve({ code, stdout, receipt });
    });
  });
}

async function pool(items, width, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

function buildCases(dir) {
  const good = path.join(dir, 'proof.txt');
  fs.writeFileSync(good, 'reason\n');
  const locators = { none: [], good: [good + ':1'], bad: [path.join(dir, 'missing.txt') + ':1'] };
  const cases = [];
  for (const p of PROGRESS) for (const l of LEDGER) for (const ev of ['none', 'good', 'bad'])
    for (const op of ['set', 'transition']) for (const axis of ['progress', 'ledger'])
      for (const to of (axis === 'progress' ? PROGRESS : LEDGER)) for (const correction of [false, true]) {
        const before = { progress: p, ledger: l };
        if (before[axis] === to) continue; // 同值写入不改动成员字段，另由既有测试覆盖
        cases.push({ op, before, ev, axis, to, correction, fresh: false, evidence: locators[ev] });
      }
  // 新建节点（set 首写免 A2 表；ensureNode 缺省 planned×clean、零证据）
  for (const axis of ['progress', 'ledger']) for (const to of (axis === 'progress' ? PROGRESS : LEDGER)) for (const correction of [false, true]) {
    const before = { progress: 'planned', ledger: 'clean' };
    if (before[axis] === to) continue;
    cases.push({ op: 'set', before, ev: 'none', axis, to, correction, fresh: true, evidence: [] });
  }
  return cases;
}

test('§2.4.2 穷举：set/transition 全空间与公理预言一致（退出码、全部诊断码、零写入、豁免留痕）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-invariant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases = buildCases(dir);
  const mismatches = [];
  await pool(cases, Math.max(2, Math.min(8, os.cpus().length)), async (c, i) => {
    const sidecar = path.join(dir, 's' + i + '.json');
    const nodes = c.fresh ? {} : { n1: { owner: 'o', class: 'task', truth: 'candidate', ...c.before, evidence: c.evidence, history: [] } };
    fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: null, revision: 0, nodes }));
    const seeded = fs.readFileSync(sidecar, 'utf8');
    const args = ['state', c.op, '--node', 'n1', '--axis', c.axis, '--reason', 'r', '--owner', 'o', '--sidecar', sidecar];
    if (c.op === 'set') args.push('--value', c.to); else args.push('--from', c.before[c.axis], '--to', c.to);
    if (c.fresh) args.push('--class', 'task');
    if (c.correction) args.push('--correction');
    const r = await runCli(args);
    const want = oracle(c);
    const tag = `${c.op}${c.fresh ? '(新建)' : ''} ${c.before.progress}×${c.before.ledger} ev=${c.ev} ${c.axis}→${c.to}${c.correction ? ' --correction' : ''}`;
    if (!want.ok) {
      const got = (r.receipt?.diagnostics || []).map((d) => d.rule);
      if (r.code !== 1) mismatches.push(`${tag}：预期拒绝 [${want.rules}]，实际 exit ${r.code}`);
      else if (JSON.stringify(got) !== JSON.stringify(want.rules)) mismatches.push(`${tag}：诊断码预期 [${want.rules}]，实际 [${got}]`);
      else if (fs.readFileSync(sidecar, 'utf8') !== seeded) mismatches.push(`${tag}：拒绝但侧车被改写`);
      return;
    }
    if (r.code !== 0) { mismatches.push(`${tag}：预期放行，实际 exit ${r.code} ${(r.receipt?.diagnostics || []).map((d) => d.rule)}`); return; }
    const node = JSON.parse(fs.readFileSync(sidecar, 'utf8')).nodes.n1;
    const event = node.history.at(-1) || {};
    if (node[c.axis] !== c.to) mismatches.push(`${tag}：放行但轴值未落 ${node[c.axis]}`);
    const waived = event.waivedRules || [];
    if (JSON.stringify(waived) !== JSON.stringify(want.waived)) mismatches.push(`${tag}：waivedRules 预期 [${want.waived}]，实际 [${waived}]`);
    if (!!event.corrected !== want.waived.length > 0) mismatches.push(`${tag}：corrected 标记与实际豁免不符`);
  });
  assert.ok(cases.length >= 1000, '穷举规模意外缩水：' + cases.length);
  assert.deepEqual(mismatches, [], `${mismatches.length}/${cases.length} 例偏离 §2.4.2：\n` + mismatches.slice(0, 40).join('\n'));
});

test('§2.4.2 唯一入口：--correction 只被 state set 接受，其他子命令 bad_args 且零写入', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-invariant-flag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const proof = path.join(dir, 'proof.txt');
  fs.writeFileSync(proof, 'reason\n');
  const sidecar = path.join(dir, 'atlas-state.json');
  fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: null, revision: 0, nodes: {
    n1: { owner: 'o', class: 'task', truth: 'candidate', progress: 'in_progress', ledger: 'clean', evidence: [proof + ':1', proof + ':1'], history: [] },
  } }));
  const seeded = fs.readFileSync(sidecar, 'utf8');
  const common = ['--node', 'n1', '--reason', 'r', '--owner', 'o', '--sidecar', sidecar, '--correction'];
  for (const sub of [
    ['transition', '--axis', 'progress', '--from', 'in_progress', '--to', 'verified'],
    ['settle'],
    ['block'],
    ['evidence-remove', '--locator', proof + ':1'],
  ]) {
    const r = await runCli(['state', ...sub, ...common]);
    assert.equal(r.code, 1, sub[0] + ' ' + r.stdout);
    assert.equal(r.receipt.diagnostics[0].rule, 'bad_args', sub[0]);
    assert.match(r.receipt.diagnostics[0].evidence, /state set --correction/, sub[0] + ' 须指引唯一入口');
    assert.equal(fs.readFileSync(sidecar, 'utf8'), seeded, sub[0] + ' 拒绝须零写入');
  }
});

test('§2.4.2 可达性模型：公理下 16 个表内状态两两可达、14 个表外/违例存量均可修复（收紧纠错不造死路）', () => {
  // 状态 = progress × ledger × 有无证据；可用操作 = set --correction（豁免 P 族）+ evidence-add/remove。
  const claim = (p, l) => p === 'verified' || p === 'cancelled' || l === 'settled';
  const legal = (p, l, e) => comboViolations(p, l).length === 0 && (!claim(p, l) || e === 1);
  const key = (s) => s.join('|');
  const next = ([p, l, e]) => {
    const out = [];
    if (e === 0) out.push([p, l, 1]);
    if (e === 1 && !claim(p, l)) out.push([p, l, 0]);
    for (const q of PROGRESS) if (q !== p && legal(q, l, e)) out.push([q, l, e]);
    for (const m of LEDGER) if (m !== l && legal(p, m, e)) out.push([p, m, e]);
    return out;
  };
  const reach = (s) => {
    const seen = new Set([key(s)]);
    const queue = [s];
    while (queue.length) for (const n of next(queue.shift())) if (!seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
    return seen;
  };
  const all = PROGRESS.flatMap((p) => LEDGER.flatMap((l) => [[p, l, 0], [p, l, 1]]));
  const inTable = all.filter((s) => legal(...s));
  const outTable = all.filter((s) => !legal(...s));
  assert.equal(inTable.length, 16);
  assert.equal(outTable.length, 14);
  for (const s of inTable) {
    const r = reach(s);
    for (const t of inTable) assert.ok(r.has(key(t)), key(s) + ' 不可达 ' + key(t));
  }
  for (const s of outTable) {
    assert.ok([...reach(s)].some((k) => { const [p, l, e] = k.split('|'); return legal(p, l, Number(e)); }), key(s) + ' 无法修复回表内');
  }
});
