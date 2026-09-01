// 实战反馈档-2026-08-23 缺陷批（0.12.0）回归钉。
// 来源：一线席位 demo-a 战役实战反馈，经 reviewer-A + kimi-reviewer-B 双席交叉验证后裁定。
// P0-1 缺省侧车静默空账（曾是契约成文行为——附录 A 原文「不报此码」，实战证明该设计错了）；
// P1-4 之畸形 id 静默建号；P3-8 近邻重复提示；P3-9 空行警告附建议行；P0-2 reanchor-moved 脚本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorQuality } from '../lib/evidence.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
const SCRIPT = new URL('../scripts/reanchor-moved.mjs', import.meta.url).pathname;

function run(args, cwd) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

test('P0-1：trace/lessons/notice 裸跑缺侧车 = fail-loud（不再静默造空账）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p01-'));
  for (const args of [['lessons', 'list'], ['notice', 'list'], ['trace', 'list']]) {
    const r = run(args, dir);
    assert.equal(r.code, 1, args.join(' ') + ' 应 exit 1（修复前 exit 0 count:0）');
    assert.equal(r.receipt.status, 'failed');
    assert.equal(r.receipt.diagnostics[0].rule, 'sidecar_missing');
    assert.ok(r.receipt.diagnostics[0].supportedFixes.length >= 1, '须给出 --sidecar/init 出路');
  }
  // 带侧车照常工作（回归）
  fs.writeFileSync(path.join(dir, 'sc.json'), '{"schemaVersion":1,"nodes":{},"revision":0}');
  const ok = run(['lessons', 'list', '--sidecar', path.join(dir, 'sc.json')], dir);
  assert.equal(ok.code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P1-4 建号校验：畸形 id 拒绝、合法 id 通过、既存畸形节点仍可改（只拦新建）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'id-'));
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  for (const bad of ['bad|id', 'bad\nid', '中文id', ' lead', '-lead', 'a'.repeat(129)]) {
    const r = run(['state', 'set', '--node', bad, '--axis', 'ledger', '--value', 'clean', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
    assert.equal(r.code, 1, JSON.stringify(bad) + ' 应被拒');
    assert.equal(r.receipt.diagnostics[0].rule, 'invalid_node_id');
  }
  const good = run(['state', 'set', '--node', 'demo-a-a.b_c-1', '--axis', 'ledger', '--value', 'clean', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
  assert.equal(good.code, 0, '点/下划线/连字符合法');
  // 既存畸形 id（历史遗留）仍可被改——只拦新建，否则存量清理都做不了
  const legacy = { schemaVersion: 1, nodes: { 'bad|legacy': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } }, revision: 1 };
  fs.writeFileSync(sc, JSON.stringify(legacy));
  const mut = run(['state', 'set', '--node', 'bad|legacy', '--axis', 'progress', '--value', 'cancelled', '--reason', '清理', '--owner', 'o', '--sidecar', sc], dir);
  assert.equal(mut.code, 0, '既存畸形节点须可改（此处作废清理）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P3-8：同文件近邻（±3）加锚附 evidence_near_duplicate warning；>3 行与跨节点不报', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'near-'));
  const f = path.join(dir, 'f.ts');
  fs.writeFileSync(f, Array.from({ length: 30 }, (_, i) => 'line-' + (i + 1) + '-content').join('\n'));
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
  run(['state', 'evidence-add', '--node', 'n1', '--locator', f + ':10', '--sidecar', sc], dir);
  const near = run(['state', 'evidence-add', '--node', 'n1', '--locator', f + ':12', '--sidecar', sc], dir);
  assert.equal(near.code, 0, '不拦截');
  assert.equal(near.receipt.diagnostics[0].rule, 'evidence_near_duplicate');
  assert.ok(near.receipt.diagnostics[0].supportedFixes[0].includes('evidence-reanchor'));
  const far = run(['state', 'evidence-add', '--node', 'n1', '--locator', f + ':20', '--sidecar', sc], dir);
  assert.equal(far.receipt.diagnostics, undefined, '>3 行不报');
  run(['state', 'set', '--node', 'n2', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
  const cross = run(['state', 'evidence-add', '--node', 'n2', '--locator', f + ':11', '--sidecar', sc], dir);
  assert.equal(cross.receipt.diagnostics, undefined, '跨节点不报（报告原文限定本节点）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P3-9：anchor-empty-line 附最近内容行建议（supportedFixes，不新增 schema 键）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'el-'));
  const f = path.join(dir, 'g.ts');
  fs.writeFileSync(f, 'top-content\n\n\nbottom-content\n');
  const w = anchorQuality(f + ':2', dir);
  assert.equal(w[0].rule, 'anchor-empty-line');
  assert.ok(w[0].supportedFixes[0].includes(':1'), '最近内容行是 :1（向上 1 行 < 向下 2 行）；' + w[0].supportedFixes[0]);
  assert.ok(w[0].supportedFixes[0].includes('evidence-reanchor'), '给出可执行处置命令');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0-2 脚本：纯移位自动识别+apply 镜像 reanchor 语义；弱行与真变不自动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'));
  const f = path.join(dir, 'm.ts');
  fs.writeFileSync(f, 'alpha-content-1\nbeta-content-2\ngamma-content-3\n');
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', 'o', '--sidecar', sc], dir);
  run(['state', 'evidence-add', '--node', 'n1', '--locator', f + ':2', '--sidecar', sc], dir);
  // 移位：行前插两行
  fs.writeFileSync(f, 'NEW-A\nNEW-B\nalpha-content-1\nbeta-content-2\ngamma-content-3\n');
  const dry = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--sidecar', sc], { encoding: 'utf8' }).stdout);
  assert.equal(dry.data.mode, 'dry-run');
  assert.equal(dry.data.movedCount, 1);
  assert.equal(dry.data.moved[0].to, f + ':4');
  // 侧车未被 dry-run 改动
  assert.ok(JSON.parse(fs.readFileSync(sc, 'utf8')).nodes.n1.evidence.includes(f + ':2'));
  const ap = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--sidecar', sc, '--apply'], { encoding: 'utf8' }).stdout);
  assert.equal(ap.data.mode, 'apply');
  const after = JSON.parse(fs.readFileSync(sc, 'utf8')).nodes.n1;
  assert.deepEqual(after.evidence, [f + ':4']);
  assert.equal(after.history.at(-1).kind, 'evidence-reanchor');
  assert.equal(after.history.at(-1).via, 'reanchor-moved', '脚本处置须可审计区分');
  // 内容真变 → 人工清单不自动
  fs.writeFileSync(f, 'NEW-A\nNEW-B\nalpha-content-1\nCHANGED-ENTIRELY\ngamma-content-3\n');
  const manual = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--sidecar', sc], { encoding: 'utf8' }).stdout);
  assert.equal(manual.data.movedCount, 0);
  assert.equal(manual.data.manualCount, 1, '真变不自动');
  fs.rmSync(dir, { recursive: true, force: true });
});
