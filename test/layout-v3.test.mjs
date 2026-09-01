// v3 布局校验器牙齿（specs/atlas-layout.md §〇-v3，2026-08-16 负责人令：门户伞目录版式）：
// 伞目录合规零 error；伞内混杂物/期目录缺 index.html/期名前缀不符 = error；伞名项目段不在 spec = error；
// 注册表优先对齐伞名→项目；v2 平铺门户 = warning 非 error（存量宽容）；伞内符号链接垫片豁免。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateLayout, ZONES } from '../lib/layout.mjs';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// v3 合规样例：七区 + spec/demo（+可选第二项目）+ 伞 demo-add/ 下两期门户（各含 index.html）
// + state/projects.json 注册表（§〇-v3.3 形状）+ INDEX.md + CSV 全行 文件:行号 证据。
function scaffoldV3(root, opts = {}) {
  opts = opts || {};
  for (const z of ZONES) fs.mkdirSync(path.join(root, z), { recursive: true });
  fs.writeFileSync(path.join(root, 'INDEX.md'), '# 项目注册表\n\n| demo | demo-add | 260815 | 260816 | 1 | state/demo.json |\n');
  fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'artifacts', 'demo', 'loops-260815'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'demo', 'loops-260815', 'demo.html'), '<html></html>\n');
  fs.mkdirSync(path.join(root, 'evidence', 'demo', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence', 'demo', 'demo', 'demo.visual-check.1440x900.dark.png'), 'x');
  fs.mkdirSync(path.join(root, 'data', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'demo', 'progress.csv'), 'item,evidence\na,lib/x.mjs:1\n');
  if (opts.registry !== false) {
    fs.writeFileSync(path.join(root, 'state', 'projects.json'), JSON.stringify({
      schemaVersion: 1,
      projects: [{
        project: 'demo', umbrella: 'demo-add', sourcePath: null,
        firstSeen: '2026-08-15', portals: opts.periods || ['260815', '260816'],
      }],
    }, null, 2));
  }
  if (opts.portal !== false) {
    for (const p of opts.periods || ['260815', '260816']) {
      fs.mkdirSync(path.join(root, 'demo-add', 'demo-add-' + p), { recursive: true });
      if (opts.portalOk !== false) {
        fs.writeFileSync(path.join(root, 'demo-add', 'demo-add-' + p, 'index.html'), '<html></html>\n');
      }
    }
  }
}

test('validateLayout v3：伞目录合规样例零 error（注册表对齐 + 两期门户）', () => {
  const dir = tmpdir('layout-v3-ok-');
  try {
    scaffoldV3(dir);
    const r = validateLayout(dir);
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), [], JSON.stringify(r.diagnostics));
    assert.ok(!r.diagnostics.some((d) => d.rule === 'layout.portal'), '合规伞不应有门户诊断；' + JSON.stringify(r.diagnostics));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v3：伞内混杂物 = error；伞内符号链接垫片跳过', () => {
  const dir = tmpdir('layout-v3-junk-');
  try {
    scaffoldV3(dir);
    fs.writeFileSync(path.join(dir, 'demo-add', 'stray.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'demo-add', 'bad-dir'));
    fs.symlinkSync(path.join(dir, 'spec'), path.join(dir, 'demo-add', 'shim-link'));
    const r = validateLayout(dir);
    const junk = r.diagnostics.filter((d) => d.rule === 'layout.portal' && d.severity === 'error');
    assert.ok(junk.some((d) => d.subject === 'demo-add/stray.txt'), '伞内散文件报 error；' + JSON.stringify(junk));
    assert.ok(junk.some((d) => d.subject === 'demo-add/bad-dir'), '伞内非期目录名目录报 error；' + JSON.stringify(junk));
    assert.ok(!junk.some((d) => d.subject.includes('shim-link')), '伞内符号链接垫片不报');
    assert.ok(junk.every((d) => d.subject !== 'demo-add/demo-add-260815' && d.subject !== 'demo-add/demo-add-260816'), '正常期目录不受牵连');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v3：期目录缺 index.html = error', () => {
  const dir = tmpdir('layout-v3-period-');
  try {
    scaffoldV3(dir, { periods: ['260815'] });
    fs.mkdirSync(path.join(dir, 'demo-add', 'demo-add-260817'));
    const r = validateLayout(dir);
    assert.ok(
      r.diagnostics.some((d) => d.rule === 'layout.portal' && d.severity === 'error' && d.subject === 'demo-add/demo-add-260817/index.html'),
      '期目录缺 index.html 须报 layout.portal error；' + JSON.stringify(r.diagnostics),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v3：期目录名前缀与伞名不符 = error', () => {
  const dir = tmpdir('layout-v3-prefix-');
  try {
    scaffoldV3(dir);
    fs.mkdirSync(path.join(dir, 'demo-add', 'demo-bad-260818'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'demo-add', 'demo-bad-260818', 'index.html'), '<html></html>\n');
    const r = validateLayout(dir);
    assert.ok(
      r.diagnostics.some((d) => d.rule === 'layout.portal' && d.severity === 'error' && d.subject === 'demo-add/demo-bad-260818/' && d.evidence.includes('前缀')),
      '期名前缀不符须报 layout.portal error；' + JSON.stringify(r.diagnostics),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v3：伞名项目段不在 spec/ 项目集合 = error（注册表未登记回退首段/边界前缀匹配）', () => {
  const dir = tmpdir('layout-v3-ghost-');
  try {
    scaffoldV3(dir);
    fs.mkdirSync(path.join(dir, 'ghost-add', 'ghost-add-260815'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ghost-add', 'ghost-add-260815', 'index.html'), '<html></html>\n');
    const r = validateLayout(dir);
    assert.ok(
      r.diagnostics.some((d) => d.rule === 'layout.portal' && d.severity === 'error' && d.subject === 'ghost-add/'),
      '未知伞名项目段须报 error；' + JSON.stringify(r.diagnostics),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v3：注册表优先对齐——伞名注册给项目即使首段不匹配也零 error', () => {
  const dir = tmpdir('layout-v3-regalign-');
  try {
    // 伞 alphan-add 注册给项目 demo：回退首段 'alphan' 不在 spec/（会误报），注册表对齐优先 → 零 error。
    scaffoldV3(dir, { portal: false, registry: false });
    fs.writeFileSync(path.join(dir, 'state', 'projects.json'), JSON.stringify({
      schemaVersion: 1,
      projects: [{ project: 'demo', umbrella: 'alphan-add', sourcePath: '/srv/alphan/demo', firstSeen: '2026-08-15', portals: ['260815'] }],
    }, null, 2));
    fs.mkdirSync(path.join(dir, 'alphan-add', 'alphan-add-260815'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'alphan-add', 'alphan-add-260815', 'index.html'), '<html></html>\n');
    const r = validateLayout(dir);
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), [], '注册表 umbrella 对齐优先于首段匹配；' + JSON.stringify(r.diagnostics));
    // 对照：删掉注册表（回退首段匹配）→ 同一伞报 error，证明对齐来源确是注册表。
    fs.rmSync(path.join(dir, 'state', 'projects.json'));
    const r2 = validateLayout(dir);
    assert.ok(r2.diagnostics.some((d) => d.rule === 'layout.portal' && d.severity === 'error' && d.subject === 'alphan-add/'), '无注册表时回退首段匹配报 error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v3：根下 v2 平铺门户 = warning 非 error（存量宽容）；结构校验照跑', () => {
  const dir = tmpdir('layout-v3-v2flat-');
  try {
    scaffoldV3(dir);
    // 合规 v2 平铺门户（含 index.html、项目在册）：仅出迁移 warning，不判 error。
    fs.mkdirSync(path.join(dir, 'demo-add-260814'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'demo-add-260814', 'index.html'), '<html></html>\n');
    const r = validateLayout(dir);
    const v2w = r.diagnostics.filter((d) => d.rule === 'layout.portal-v2');
    assert.equal(v2w.length, 1, '恰一条 v2 平铺门户 warning');
    assert.equal(v2w[0].severity, 'warning', 'v2 平铺门户 = warning 非 error');
    assert.equal(v2w[0].subject, 'demo-add-260814');
    assert.ok(v2w[0].evidence.includes('v2 平铺门户已过时，建议迁入伞目录'), 'warning 消息按 §〇-v3.5 措辞；' + v2w[0].evidence);
    assert.ok(!r.diagnostics.some((d) => d.severity === 'error'), '合规 v2 平铺门户不产生 error（存量宽容，与 v1 legacy 同精神）');
    // 结构校验照跑（与 v1 legacy「原校验照跑」同法）：v2 平铺门户缺 index.html 仍 error。
    fs.rmSync(path.join(dir, 'demo-add-260814', 'index.html'));
    fs.mkdirSync(path.join(dir, 'demo-add-260813'));
    const r2 = validateLayout(dir);
    assert.ok(
      r2.diagnostics.some((d) => d.rule === 'layout.portal' && d.severity === 'error' && d.subject === 'demo-add-260813/index.html'),
      'v2 平铺门户缺 index.html 仍报 error（结构校验照跑）；' + JSON.stringify(r2.diagnostics),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
