// 两段式废弃牙齿：0.9.0 = 第一阶段（标记不删）+ v1 平铺校验链塌缩（Lehman 法则2 复杂度做功）；
// 0.10.0 = 第二阶段（物理移除）——evidence 顶层命令与 lessons hit 子命令删除，调用落入未知命令/子命令码。
// ② v1 平铺：只发一条迁移 warning 直接返回，不再跑整条校验链（同一违规 fixture 塌缩前实测 11 条诊断），
//    仍 warning 级——atlas-layout 检查 ok，不贡献 exit 1（doctor 整体退出码还受 archify/经验池等环境检查影响，正交既有行为）。
// 红线：全部用临时目录，绝不触碰 <home>/demo-ledger 与 <repo>。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../lib/doctor.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function run(args, env) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout };
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('evidence 顶层命令已移除（0.10.0 第二阶段）：调用 → exit 1 unknown_subcommand，消息列出当前支持命令', () => {
  const dir = tmpDir('removed-evidence-');
  try {
    const file = path.join(dir, 'real.ts');
    fs.writeFileSync(file, 'one\ntwo\n');
    const r = run(['evidence', 'lint', '--locator', file + ':2']);
    assert.equal(r.code, 1, '移除后调用 = 用户输入校验失败 exit 1（0.9.0 为 exit 0 + deprecated_command warning）');
    assert.equal(r.receipt.status, 'failed');
    assert.equal(r.receipt.diagnostics[0].rule, 'unknown_subcommand', '未知顶层命令复用 unknown_subcommand 码');
    assert.equal(r.receipt.diagnostics[0].subject, 'evidence');
    assert.ok(r.receipt.diagnostics[0].evidence.includes('未知命令'), r.receipt.diagnostics[0].evidence);
    // 替代路径仍存活（写时 evidence-add 内嵌校验）：state evidence-add 照常 exit 0。
    const sidecar = path.join(dir, 'atlas-state.json');
    run(['state', 'set', '--node', 'n1', '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar]);
    const add = run(['state', 'evidence-add', '--node', 'n1', '--locator', file + ':2', '--sidecar', sidecar]);
    assert.equal(add.code, 0, '替代路径 state evidence-add 不受移除影响；' + add.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lessons hit 子命令已移除（0.10.0 第二阶段）：调用 → exit 1 unknown_subcommand；hits 字段与既有数据保留只读', () => {
  const dir = tmpDir('removed-hit-');
  try {
    const sidecar = path.join(dir, 'atlas-state.json');
    // 存量数据：含 hits 字段的既有条目（0.9.0 及更早写入）。
    fs.writeFileSync(sidecar, JSON.stringify({
      schemaVersion: 1, atlas: null, nodes: {},
      lessons: [{ id: 'lesson-legacy', at: '2026-08-15T00:00:00.000Z', rule: 'old', lesson: '存量条目', source: null, hits: 3, status: 'active' }],
    }) + '\n');
    const hit = run(['lessons', 'hit', '--id', 'lesson-legacy', '--sidecar', sidecar]);
    assert.equal(hit.code, 1, '写入口已删：lessons hit = 未知子命令 exit 1');
    assert.equal(hit.receipt.diagnostics[0].rule, 'unknown_subcommand');
    assert.equal(hit.receipt.diagnostics[0].subject, 'hit');
    // hits 字段与既有数据保留：list 照带 hits=3，未被移除动作改写。
    const list = run(['lessons', 'list', '--sidecar', sidecar]);
    assert.equal(list.code, 0);
    assert.equal(list.receipt.data.lessons[0].hits, 3, 'hits 字段保留为存量只读计数');
    const persisted = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    assert.equal(persisted.lessons[0].hits, 3, 'hit 调用被拒后落账数据原样（不 +1 不清零）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v1 平铺塌缩：一条废弃 warning 且 atlas-layout 检查 ok（CLI doctor 仍 exit 0）', () => {
  const dir = tmpDir('deprecated-v1-');
  try {
    // v1 平铺 + 旧链必报违规（缺两区、根散文件、坏 CSV）——塌缩前同形 fixture 实测 11 条诊断。
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state']) fs.mkdirSync(path.join(dir, z), { recursive: true });
    fs.writeFileSync(path.join(dir, 'INDEX.md'), '# x\n');
    fs.writeFileSync(path.join(dir, 'spec', 'demo.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'loose.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'data', 'progress.csv'), 'item,status\na,done\n');
    // lib 级：只发一条 warning（显著少于塌缩前），unchecked 具名披露不丢。
    const d = runDoctor({ atlas: dir });
    const diags = d.layout.diagnostics;
    assert.equal(diags.length, 1, '只发一条诊断（塌缩前同形 fixture 11 条）；' + JSON.stringify(diags));
    assert.equal(diags[0].rule, 'layout.legacy');
    assert.equal(diags[0].severity, 'warning');
    // 0.10.1：改钉事实陈述（迁移目标 v3 + 已于 v0.9.0 停校验），不再钉会过期的未来版本号
    assert.ok(diags[0].evidence.includes('v1 平铺版式已废弃') && diags[0].evidence.includes('v3') && diags[0].evidence.includes('v0.9.0'), '消息含废弃标记、迁移目标与停校验事实');
    const check = d.checks.find((c) => c.name === 'atlas-layout');
    assert.ok(check && check.ok, 'warning 级不判死：atlas-layout 检查 ok，不贡献 exit 1');
    // CLI 级 exit 0：钉死环境正交面（ARCHIFY_BIN 指 stub 使 archify-kernel 可解析、给可读侧车使经验池可检），
    // 断言「v1 平铺不再使 doctor 失败」这一塌缩语义本身。
    const stub = path.join(dir, 'archify-stub.mjs');
    fs.writeFileSync(stub, 'process.exit(0);\n');
    const sidecar = path.join(dir, 'state', 'atlas-state.json');
    fs.writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1, atlas: null, nodes: {} }) + '\n');
    const cli = run(['doctor', '--atlas', dir, '--sidecar', sidecar], { ARCHIFY_BIN: stub });
    assert.equal(cli.code, 0, 'v1 平铺仍 exit 0（不制造破坏性变更）；' + cli.stdout);
    assert.equal(cli.receipt.status, 'ok');
    assert.equal(cli.receipt.data.layout.diagnostics.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v3 正常路径零回归：v3 伞目录版式校验照跑（塌缩不误伤存活路径）', () => {
  const dir = tmpDir('deprecated-v3-');
  try {
    // v3 最小合规：七区 + spec/demo/ + INDEX 注册 + 伞目录 demo-add/demo-add-260817/index.html。
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history']) fs.mkdirSync(path.join(dir, z), { recursive: true });
    fs.writeFileSync(path.join(dir, 'INDEX.md'), '# 项目注册表\n\n| demo | demo-add | 260817 | 260817 | 1 | state/demo.json |\n');
    fs.mkdirSync(path.join(dir, 'spec', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec', 'demo', 'demo.json'), '{}\n');
    fs.mkdirSync(path.join(dir, 'demo-add', 'demo-add-260817'), { recursive: true });
    const d = runDoctor({ atlas: dir });
    const layoutCheck = d.checks.find((c) => c.name === 'atlas-layout');
    // 伞内期目录缺 index.html = error layout.portal（v3 结构校验照跑）。
    assert.equal(layoutCheck.ok, false, '期目录缺 index.html 仍判 error（v3 校验链存活）');
    assert.ok(d.layout.diagnostics.some((x) => x.rule === 'layout.portal' && x.severity === 'error'));
    fs.writeFileSync(path.join(dir, 'demo-add', 'demo-add-260817', 'index.html'), '<html></html>\n');
    const d2 = runDoctor({ atlas: dir });
    assert.ok(!d2.layout.diagnostics.some((x) => x.severity === 'error'), '补齐后零 error；' + JSON.stringify(d2.layout.diagnostics));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
