// v2 布局校验器牙齿（specs/atlas-layout.md §〇，2026-08-15 负责人令）：
// v2 合规零 error；缺 INDEX/坏模块命名/门户缺 index.html = error；P6 节点前缀 warning + meta 豁免；
// v1 平铺 = 已废弃（0.9.0 塌缩：只发一条迁移 warning 直接返回，不再跑校验链）；符号链接不计平铺违规；doctor --atlas 与 --sidecar 联动。
// 2026-08-15 语义对齐（v1 接受语义）：.vN 版本化规格名 v2 下 = warning 非 error；符号链接含 .vN 名不报；
// visual-check 与主 .html 同目录（画廊摆位）接受不报、孤儿 = warning；evidence 目录名与 spec id 不同名 = warning 降级。

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

// v2 合规样例：两项目（demo/add），spec/evidence/data 项目名隔离，artifacts 两级 项目/模块-日期，
// 门户 demo-add-260815/ 含 index.html，INDEX.md 项目注册表，CSV 全行 文件:行号 证据。
function scaffoldV2(root, opts = {}) {
  for (const z of ZONES) fs.mkdirSync(path.join(root, z), { recursive: true });
  if (opts.indexOk !== false) {
    fs.writeFileSync(
      path.join(root, 'INDEX.md'),
      '# 项目注册表\n\n| 项目 | 门户目录 | 初始化 | 重扫 | 图数 | 侧车 |\n| demo | demo-add-260815 | 260815 | 260815 | 1 | state/demo.json |\n| add | add-add-260815 | 260815 | 260815 | 1 | state/add.json |\n',
    );
  }
  for (const p of ['demo', 'add']) {
    fs.mkdirSync(path.join(root, 'spec', p), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', p, p === 'demo' ? 'demo.json' : 'main.json'), '{}\n');
    fs.mkdirSync(path.join(root, 'artifacts', p, opts.moduleName || (p === 'demo' ? 'loops-260815' : 'batch-260815')), { recursive: true });
    fs.writeFileSync(path.join(root, 'artifacts', p, opts.moduleName || (p === 'demo' ? 'loops-260815' : 'batch-260815'), p === 'demo' ? 'demo.html' : 'main.html'), '<html></html>\n');
    fs.mkdirSync(path.join(root, 'evidence', p, p === 'demo' ? 'demo' : 'main'), { recursive: true });
    fs.writeFileSync(path.join(root, 'evidence', p, p === 'demo' ? 'demo' : 'main', p + '.visual-check.1440x900.dark.png'), 'x');
    fs.mkdirSync(path.join(root, 'data', p), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', p, 'progress.csv'), 'item,evidence\na,lib/x.mjs:1\n');
  }
  if (opts.portal !== false) {
    fs.mkdirSync(path.join(root, 'demo-add-260815'), { recursive: true });
    if (opts.portalOk !== false) {
      fs.writeFileSync(path.join(root, 'demo-add-260815', 'index.html'), '<html></html>\n');
    }
  }
}

// 合规侧车：节点全部带项目名前缀（demo-/add-），diagram-* 元节点与 kind=meta 豁免样本。
function scaffoldSidecar(dir, nodes) {
  const p = path.join(dir, 'state', 'atlas-state.json');
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, nodes, trace: [], lessons: [], notices: [] }));
  return p;
}

test('validateLayout v2：合规样例零 error；带合规侧车零 P6 warning', () => {
  const dir = tmpdir('layout-v2-ok-');
  try {
    scaffoldV2(dir);
    const sidecar = scaffoldSidecar(dir, {
      'demo-demo-a': { kind: 'node' },
      'add-cmd-b': { kind: 'node' },
      'diagram-demo': { kind: 'meta' }, // diagram-* 元节点豁免
      'demo-meta-x': { kind: 'meta' }, // kind=meta 豁免
    });
    const r = validateLayout(dir, { sidecarPath: sidecar });
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), [], JSON.stringify(r.diagnostics));
    assert.ok(!r.diagnostics.some((d) => d.rule === 'P6'), '合规节点前缀不应有 P6 warning');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：缺 INDEX.md = error', () => {
  const dir = tmpdir('layout-v2-index-');
  try {
    scaffoldV2(dir, { indexOk: false });
    const r = validateLayout(dir);
    assert.ok(r.diagnostics.some((d) => d.rule === 'layout.index' && d.severity === 'error'), '缺 INDEX.md 须报 layout.index error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：artifacts 坏模块命名 = error（模块-YYMMDD 正则）', () => {
  const dir = tmpdir('layout-v2-module-');
  try {
    scaffoldV2(dir, { moduleName: 'badname' });
    const r = validateLayout(dir);
    assert.ok(
      r.diagnostics.some((d) => d.rule === 'layout.naming' && d.severity === 'error' && d.subject === 'artifacts/demo/badname'),
      '坏模块名须报 layout.naming error；' + JSON.stringify(r.diagnostics),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：门户目录缺 index.html = error', () => {
  const dir = tmpdir('layout-v2-portal-');
  try {
    scaffoldV2(dir, { portalOk: false });
    const r = validateLayout(dir);
    assert.ok(
      r.diagnostics.some((d) => d.rule === 'layout.portal' && d.severity === 'error' && d.subject === 'demo-add-260815/index.html'),
      '门户缺 index.html 须报 layout.portal error；' + JSON.stringify(r.diagnostics),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：P6 未前缀节点 = warning；diagram-*/kind=meta 豁免', () => {
  const dir = tmpdir('layout-v2-p6-');
  try {
    scaffoldV2(dir);
    const sidecar = scaffoldSidecar(dir, {
      'unprefixed-node': { kind: 'node' }, // 无项目名前缀 → P6
      'demo-ok': { kind: 'node' }, // 合规
      'diagram-add': { kind: 'meta' }, // diagram-* 豁免
      'add-meta': { kind: 'meta' }, // kind=meta 豁免
    });
    const r = validateLayout(dir, { sidecarPath: sidecar });
    const p6 = r.diagnostics.filter((d) => d.rule === 'P6');
    assert.deepEqual(p6.map((d) => d.subject), ['unprefixed-node'], '仅未前缀节点报 P6');
    assert.ok(p6.every((d) => d.severity === 'warning'), 'P6 按规范原文 = warning');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v1 平铺（0.9.0 塌缩）：只发一条废弃 warning 直接返回，整条 v1 校验链不再跑', () => {
  const dir = tmpdir('layout-v1-deprecated-');
  try {
    // v1 平铺 + 多项旧链必报的违规（缺两区、根散文件、坏 CSV、.vN 双份、孤儿交付物）——
    // 同一 fixture 塌缩前实测 11 条诊断（0.9.0 前基线），塌缩后只发一条。
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state']) fs.mkdirSync(path.join(dir, z), { recursive: true });
    fs.writeFileSync(path.join(dir, 'INDEX.md'), '# x\n');
    fs.writeFileSync(path.join(dir, 'spec', 'demo.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'spec', 'demo-architecture.v2.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'loose.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'loose.png'), 'x');
    fs.writeFileSync(path.join(dir, 'data', 'progress.csv'), 'item,status\na,done\n');
    fs.writeFileSync(path.join(dir, 'artifacts', 'orphan.html'), '<html></html>\n');
    const r = validateLayout(dir);
    assert.equal(r.diagnostics.length, 1, 'v1 平铺只得一条诊断（同 fixture 塌缩前 11 条，显著少于塌缩前）；' + JSON.stringify(r.diagnostics));
    const legacy = r.diagnostics[0];
    assert.equal(legacy.rule, 'layout.legacy');
    assert.equal(legacy.severity, 'warning', '保持 warning 级不判死（exit 0 语义不变）');
    // 0.10.1：不再钉未来式版本承诺（原本钉 'v0.10.0' 使文案成为时间炸弹），改钉迁移目标与已发生的停校验事实
    assert.ok(legacy.evidence.includes('v1 平铺版式已废弃') && legacy.evidence.includes('v3') && legacy.evidence.includes('v0.9.0'), '消息含废弃标记、迁移目标与停校验事实；' + legacy.evidence);
    assert.ok(r.unchecked.length >= 5, 'unchecked 具名披露不丢');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout：符号链接不计为平铺违规（v2 兼容垫片）', () => {
  const dir = tmpdir('layout-v2-symlink-');
  try {
    scaffoldV2(dir);
    fs.symlinkSync(path.join(dir, 'spec'), path.join(dir, 'demo-legacy-spec-link'));
    fs.symlinkSync(path.join(dir, 'spec', 'demo', 'demo.json'), path.join(dir, 'spec', 'demo-link.json'));
    const r = validateLayout(dir);
    assert.ok(!r.diagnostics.some((d) => d.rule === 'P1' && d.subject === 'demo-legacy-spec-link'), '根下符号链接不计平铺违规');
    assert.ok(!r.diagnostics.some((d) => d.rule === 'P2' && d.subject === 'spec/demo-link.json'), 'spec/ 内符号链接垫片不报混放');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：.vN 版本化规格名 = warning 非 error；v1 平铺塌缩后不再判 P3', () => {
  const dir = tmpdir('layout-v2-vn-');
  try {
    scaffoldV2(dir);
    fs.writeFileSync(path.join(dir, 'spec', 'demo', 'demo-architecture.v2.json'), '{}\n');
    const r = validateLayout(dir);
    const p3 = r.diagnostics.filter((d) => d.rule === 'P3');
    assert.deepEqual(p3.map((d) => d.subject), ['spec/demo/demo-architecture.v2.json'], '仅真实 .vN 文件报 P3');
    assert.ok(p3.every((d) => d.severity === 'warning'), '.vN 在 v2 下须为 warning 非 error；' + JSON.stringify(p3));
    assert.ok(!r.diagnostics.some((d) => d.severity === 'error'), 'v2 下 .vN 不产生 error');
    // v1 平铺（0.9.0 塌缩）：.vN 不再跑 P3——只发一条废弃 warning 直接返回。
    const dir2 = tmpdir('layout-v1-vn-');
    try {
      for (const z of ZONES) fs.mkdirSync(path.join(dir2, z), { recursive: true });
      fs.writeFileSync(path.join(dir2, 'INDEX.md'), '# x\n');
      fs.writeFileSync(path.join(dir2, 'spec', 'demo-architecture.v2.json'), '{}\n');
      const r2 = validateLayout(dir2);
      assert.equal(r2.diagnostics.length, 1, 'v1 塌缩后不再跑 P3 校验链');
      assert.equal(r2.diagnostics[0].rule, 'layout.legacy');
      assert.equal(r2.diagnostics[0].severity, 'warning');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：符号链接含 .vN 名不报（垫片一律跳过，P3 与 P1/P2 同原则）', () => {
  const dir = tmpdir('layout-v2-symlink-vn-');
  try {
    scaffoldV2(dir);
    fs.writeFileSync(path.join(dir, 'spec', 'demo', 'demo-architecture.v2.json'), '{}\n');
    fs.symlinkSync(path.join(dir, 'spec', 'demo', 'demo-architecture.v2.json'), path.join(dir, 'spec', 'demo-legacy-link.v2.json'));
    const r = validateLayout(dir);
    assert.ok(!r.diagnostics.some((d) => d.rule === 'P3' && d.subject === 'spec/demo-legacy-link.v2.json'), 'symlink 垫片含 .vN 名不报 P3');
    const p3 = r.diagnostics.filter((d) => d.rule === 'P3');
    assert.deepEqual(p3.map((d) => d.subject), ['spec/demo/demo-architecture.v2.json'], '仅真实文件报 P3（warning）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：visual-check 与主 .html 同目录（画廊摆位）接受不报', () => {
  const dir = tmpdir('layout-v2-gallery-');
  try {
    scaffoldV2(dir);
    const mod = path.join(dir, 'artifacts', 'demo', 'loops-260815');
    fs.writeFileSync(path.join(mod, 'demo.visual-check.html'), '<html></html>\n');
    fs.writeFileSync(path.join(mod, 'demo.visual-check.1440x900.dark.png'), 'x');
    fs.writeFileSync(path.join(mod, 'demo.visual-check.json'), '{}');
    const r = validateLayout(dir);
    assert.ok(!r.diagnostics.some((d) => d.rule === 'layout.evidence-placement'), '伴随主 html 的 visual-check 画廊摆位零诊断；' + JSON.stringify(r.diagnostics));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：孤儿 visual-check（同目录无对应主 html）= warning 非 error', () => {
  const dir = tmpdir('layout-v2-orphan-');
  try {
    scaffoldV2(dir);
    fs.writeFileSync(path.join(dir, 'artifacts', 'demo', 'loops-260815', 'orphan.visual-check.html'), '<html></html>\n');
    const r = validateLayout(dir);
    const ev = r.diagnostics.filter((d) => d.rule === 'layout.evidence-placement');
    assert.deepEqual(ev.map((d) => d.subject), ['artifacts/demo/loops-260815/orphan.visual-check.html']);
    assert.ok(ev.every((d) => d.severity === 'warning'), '孤儿 visual-check = warning 非 error');
    assert.ok(!r.diagnostics.some((d) => d.severity === 'error'), '无 error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：evidence 目录名与 spec id 不同名 = warning 非 error（史实目录不强改）', () => {
  const dir = tmpdir('layout-v2-naming-');
  try {
    scaffoldV2(dir);
    fs.mkdirSync(path.join(dir, 'evidence', 'demo', 'demo-legacy'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'demo', 'demo-legacy', 'demo-legacy.visual-check.json'), '{}');
    const r = validateLayout(dir);
    const nm = r.diagnostics.filter((d) => d.rule === 'layout.naming');
    assert.deepEqual(nm.map((d) => d.subject), ['evidence/demo/demo-legacy/']);
    assert.ok(nm.every((d) => d.severity === 'warning'), 'naming 降级 warning 非 error；' + JSON.stringify(nm));
    assert.ok(nm[0].evidence.includes('建议改名'), '消息附建议改名；' + nm[0].evidence);
    assert.ok(!r.diagnostics.some((d) => d.severity === 'error'), '无 error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：P6 洪峰聚合封顶（0.10.0，holdout #2 P1）——20+ 无前缀节点只逐条列前 5 + 一条计数汇总', () => {
  const dir = tmpdir('layout-v2-p6flood-');
  try {
    scaffoldV2(dir);
    // 23 个无前缀节点（holdout #2 实测 306 个 → doctor 逐条打印 306 条相同 warning 的洪峰场景）。
    const nodes = {};
    for (let i = 0; i < 23; i += 1) nodes['np-' + String(i).padStart(2, '0')] = { kind: 'node' };
    const sidecar = scaffoldSidecar(dir, nodes);
    const r = validateLayout(dir, { sidecarPath: sidecar });
    const p6 = r.diagnostics.filter((d) => d.rule === 'P6');
    assert.equal(p6.length, 6, '前 5 个逐条 + 1 条汇总 = 6 条（修复前此处 23 条）；' + p6.length);
    const individual = p6.filter((d) => d.subject !== '（其余同类汇总）');
    assert.deepEqual(individual.map((d) => d.subject), ['np-00', 'np-01', 'np-02', 'np-03', 'np-04'], '逐条只列前 5 个节点 id（按遍历序）');
    const summary = p6.find((d) => d.subject === '（其余同类汇总）');
    assert.ok(summary, '须有计数汇总条');
    assert.equal(summary.severity, 'warning', 'P6 按规范原文仍 = warning');
    assert.ok(summary.evidence.includes('另有 18 个节点同类') && summary.evidence.includes('共 23 个'), '汇总条形如「另有 N 个节点同类，共 M 个」；' + summary.evidence);
    // 零回归：<=5 个无前缀节点时不发汇总条（既有逐条语义不变）。
    const dir2 = tmpdir('layout-v2-p6few-');
    try {
      scaffoldV2(dir2);
      const sc2 = scaffoldSidecar(dir2, { 'np-a': { kind: 'node' }, 'np-b': { kind: 'node' } });
      const r2 = validateLayout(dir2, { sidecarPath: sc2 });
      const p62 = r2.diagnostics.filter((d) => d.rule === 'P6');
      assert.equal(p62.length, 2, '2 个无前缀节点 = 2 条逐条，无汇总条');
      assert.ok(!p62.some((d) => d.subject === '（其余同类汇总）'));
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：坏 spec JSON = error layout.spec-unparsable（0.10.0，holdout #2 P2c）——doctor 图谱自检须验可解析性', () => {
  const dir = tmpdir('layout-v2-badspec-');
  try {
    scaffoldV2(dir);
    fs.writeFileSync(path.join(dir, 'spec', 'demo', 'bad.json'), '{bad json');
    const r = validateLayout(dir);
    const bad = r.diagnostics.filter((d) => d.rule === 'layout.spec-unparsable');
    assert.equal(bad.length, 1, '一个坏 spec 恰一条诊断；' + JSON.stringify(r.diagnostics));
    assert.equal(bad[0].severity, 'error', '坏 spec JSON = error 级（不再活到 compile 才炸）');
    assert.equal(bad[0].subject, 'spec/demo/bad.json', '指明文件');
    assert.ok(bad[0].evidence.includes('spec JSON 不可解析'), '消息带解析错误首行；' + bad[0].evidence);
    // 合规 spec 不误报：demo.json/main.json 均为合法 JSON，只有 bad.json 一条。
    // runDoctor 联动：atlas-layout 检查因 error 级诊断不通过（exit 1 语义由 CLI 层承担）。
    const d = runDoctor({ atlas: dir });
    const c = d.checks.find((x) => x.name === 'atlas-layout');
    assert.ok(c && c.ok === false, 'atlas-layout 检查须因 spec-unparsable 不通过');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runDoctor --atlas --sidecar：v2 合规 ok；P6 warning 在 layout.diagnostics 呈现', () => {
  const dir = tmpdir('layout-v2-doctor-');
  try {
    scaffoldV2(dir);
    const sidecar = scaffoldSidecar(dir, { 'unprefixed-node': { kind: 'node' } });
    const d = runDoctor({ atlas: dir, sidecar });
    const c = d.checks.find((x) => x.name === 'atlas-layout');
    assert.ok(c && c.ok, 'v2 合规样例 atlas-layout 检查应 ok');
    assert.ok(d.layout.diagnostics.some((x) => x.rule === 'P6' && x.severity === 'warning'), 'P6 warning 须随布局诊断呈现');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateLayout v2：根缺 index.html = warning 非 error（提示 --root）；有 index.html 不报且不计 P1', () => {
  const dir = tmpdir('layout-v2-rootindex-');
  try {
    scaffoldV2(dir); // 合规样例：无根 index.html
    const r = validateLayout(dir);
    const ri = r.diagnostics.filter((d) => d.rule === 'layout.root-index');
    assert.equal(ri.length, 1, '缺根索引须恰报一条 root-index；' + JSON.stringify(r.diagnostics));
    assert.equal(ri[0].severity, 'warning', '根 index.html 缺失 = warning 非 error');
    assert.ok(ri[0].evidence.includes('build-portal'), '消息须提示生成命令；' + ri[0].evidence);
    assert.ok(ri[0].supportedFixes.some((f) => f.includes('--root')), 'supportedFixes 须含 --root 命令；' + JSON.stringify(ri[0].supportedFixes));
    assert.ok(!r.diagnostics.some((d) => d.severity === 'error'), '缺根索引不产生 error（INDEX.md 才是 error 级要求）');

    // 有根 index.html：不报 root-index，也不计 P1 平铺。
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>\n');
    const r2 = validateLayout(dir);
    assert.ok(!r2.diagnostics.some((d) => d.rule === 'layout.root-index'), '有 index.html 不再报 root-index');
    assert.ok(!r2.diagnostics.some((d) => d.rule === 'P1' && d.subject === 'index.html'), '生成式根 index.html 不计 P1 平铺');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

