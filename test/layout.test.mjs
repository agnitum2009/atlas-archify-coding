// 布局校验器牙齿：合规样例零 error；缺区/混放/缺证据列样例报 error；unchecked 具名披露。
// 0.9.0：脚手架迁 v2 版式（spec/<项目>/ 一级子目录）——v1 平铺已废弃塌缩（只发一条 warning，见 layout-v2/deprecated 测试）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateLayout, ZONES } from '../lib/layout.mjs';
import { runDoctor } from '../lib/doctor.mjs';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 合规样例（v2）：七区 + INDEX 项目注册 + spec/demo/demo.json + artifacts 两级 项目/模块-日期 + evidence 两级 + CSV 全行 文件:行号 证据。
function scaffoldCompliant(root) {
  for (const z of ZONES) fs.mkdirSync(path.join(root, z), { recursive: true });
  fs.writeFileSync(path.join(root, 'INDEX.md'), '# 项目注册表\n\n| demo | - | 260817 | 260817 | 1 | state/demo.json |\n');
  fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'artifacts', 'demo', 'loops-260817'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'demo', 'loops-260817', 'demo.html'), '<html></html>\n');
  fs.mkdirSync(path.join(root, 'evidence', 'demo', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence', 'demo', 'demo', 'demo.visual-check.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'evidence', 'demo', 'demo', 'demo.visual-check.1440x900.dark.png'), 'x');
  fs.mkdirSync(path.join(root, 'data', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'demo', 'progress.csv'), 'item,evidence\na,lib/x.mjs:1\n');
}

test('validateLayout：合规样例零 error；unchecked 逐条具名（诚实披露）', () => {
  const dir = tmpdir('layout-ok-');
  try {
    scaffoldCompliant(dir);
    const r = validateLayout(dir);
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
    assert.ok(Array.isArray(r.unchecked) && r.unchecked.length >= 5, '机器不可判定规则须具名列出');
    for (const u of r.unchecked) assert.equal(typeof u, 'string');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout：缺区样例报 error（七区齐全 + P1 平铺 + 证据归位 warning）', () => {
  const dir = tmpdir('layout-bad-');
  try {
    // v2 版式缺两区：只建五区（spec/demo/ 一级子目录使版式识别为 v2），缺 rulings/ 与 history/；根目录平铺散文件 + PNG 不归位。
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state']) fs.mkdirSync(path.join(dir, z), { recursive: true });
    fs.mkdirSync(path.join(dir, 'spec', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'INDEX.md'), '# x\n');
    fs.writeFileSync(path.join(dir, 'loose.png'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const r = validateLayout(dir);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    const zones = errors.filter((d) => d.rule === 'layout.zones').map((d) => d.subject);
    assert.ok(zones.includes('rulings/') && zones.includes('history/'), '缺区须逐区报 error');
    assert.ok(errors.some((d) => d.rule === 'P1' && d.subject === 'notes.txt'), '根目录散文件 = P1 error');
    // 2026-08-15 语义对齐：evidence-placement error 级取消，根散 PNG = warning。
    const warns = r.diagnostics.filter((d) => d.severity === 'warning');
    assert.ok(warns.some((d) => d.rule === 'layout.evidence-placement' && d.subject === 'loose.png'), 'PNG 不进 evidence/ = warning（error 级已取消）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout：data CSV 缺证据列 = P5 error；目录不存在 = fail-loud', () => {
  const dir = tmpdir('layout-p5-');
  try {
    scaffoldCompliant(dir);
    fs.writeFileSync(path.join(dir, 'data', 'demo', 'progress.csv'), 'item,status\na,done\n');
    const r = validateLayout(dir);
    assert.ok(r.diagnostics.some((d) => d.rule === 'P5' && d.severity === 'error'), '缺证据列须报 P5 error');
    const missing = validateLayout(path.join(dir, 'nope'));
    assert.equal(missing.diagnostics[0].rule, 'layout.root');
    assert.equal(missing.diagnostics[0].severity, 'error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runDoctor --atlas：布局校验入 checks，data.unchecked 显式列出；有 error 时 overall failed', () => {
  const dir = tmpdir('layout-doctor-');
  try {
    scaffoldCompliant(dir);
    const d = runDoctor({ atlas: dir });
    assert.equal(d.checks.length, 7); // 6 常规 + atlas-layout（批二新增两项 warning 级后）
    const c = d.checks.find((x) => x.name === 'atlas-layout');
    assert.ok(c && c.ok, '合规样例 atlas-layout 检查应 ok');
    assert.ok(Array.isArray(d.unchecked) && d.unchecked.length >= 5, 'data.unchecked 须具名披露');
    assert.ok(d.layout && Array.isArray(d.layout.diagnostics));

    fs.rmSync(path.join(dir, 'history'), { recursive: true });
    const d2 = runDoctor({ atlas: dir });
    assert.equal(d2.ok, false, '缺区须使 doctor overall failed');
    assert.equal(d2.checks.find((x) => x.name === 'atlas-layout').ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
