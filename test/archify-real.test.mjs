// 真内核集成（选跑）：设 ATLAS_REAL_ARCHIFY_V2 / ATLAS_REAL_ARCHIFY_V3 指向真 archify bin 时执行，否则 skip——CI 不依赖真内核。
// 需要 Chrome/Chromium。snap 版 Chromium 读不了 /tmp：设 ATLAS_REAL_ARCHIFY_WORKDIR 为 $HOME 下非隐藏目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
function cli(args, env, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, cwd, timeout: 900000 });
  let receipt = null;
  try { receipt = JSON.parse(r.stdout); } catch { /* 留空 */ }
  return { code: r.status, receipt, stdout: r.stdout };
}

for (const [profile, bin] of [['v2', process.env.ATLAS_REAL_ARCHIFY_V2], ['v3', process.env.ATLAS_REAL_ARCHIFY_V3]]) {
  test('真内核 ' + profile + '：init → compile → gate 全链与能力清单', { skip: bin ? false : '未设 ATLAS_REAL_ARCHIFY_' + profile.toUpperCase(), timeout: 3600000 }, (t) => {
    const base = fs.mkdtempSync(path.join(process.env.ATLAS_REAL_ARCHIFY_WORKDIR || os.tmpdir(), 'atlas-real-' + profile + '-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    fs.mkdirSync(path.join(base, 'out'));
    const env = { ...process.env, ARCHIFY_BIN: bin, TMPDIR: base };
    const atlas = path.join(base, 'demo');
    assert.equal(cli(['init', '--dir', atlas, '--title', '演示', '--template', 'demo'], env).code, 0);
    const sidecar = path.join(atlas, 'state', 'atlas-state.json');
    for (const n of ['demo-b', 'building']) {
      assert.equal(cli(['state', 'set', '--node', n, '--axis', 'progress', '--value', 'in_progress', '--reason', 'r', '--owner', 'o', '--class', 'task', '--sidecar', sidecar], env).code, 0);
    }

    // ① architecture 演示图：compile → gate
    const compiled = path.join(base, 'compiled.json');
    const comp = cli(['compile', '--diagram', path.join(atlas, 'spec', 'demo', 'demo-map.json'), '--sidecar', sidecar, '--out', compiled, '--no-trace'], env);
    assert.equal(comp.code, 0, comp.stdout);
    assert.equal(comp.receipt.data.injected.kernel.profile, profile);
    assert.equal(comp.receipt.data.injected.focusCard, profile === 'v3');
    const spec = JSON.parse(fs.readFileSync(compiled, 'utf8'));
    assert.equal(spec.meta.output, 'demo-map.html');
    const out = path.join(base, 'out', 'demo.html');
    const gate = cli(['gate', '--diagram', compiled, '--out', out], env, base);
    assert.equal(gate.code, 0, gate.stdout);
    const d = gate.receipt.data;
    assert.equal(d.final, 'pass');
    assert.equal(d.kernel.profile, profile);
    assert.deepEqual(Object.keys(d.results), profile === 'v3' ? ['validate', 'deliver', 'check', 'visual_check'] : ['validate', 'deliver', 'visual_check']);
    assert.equal(d.visualReview, 'pending');
    const html = fs.readFileSync(out, 'utf8');
    assert.ok(html.includes('▶ 进行中'), '节点进度 tag 可见');
    if (profile === 'v2') assert.ok(html.includes('archify-guided-views-data'), '2.x 焦点章节渲染');
    else assert.ok(html.includes('当前焦点（在途 1）'), 'v3 焦点卡渲染');

    // ② lifecycle：自写三状态小图，state 'building' 在途 → tag 注入。
    // 2.16 visual-check 不允许纵向溢出：本机 v2.16.0 标签下内核自带 lifecycle 示例与这张最小图原样都溢出（与 atlas 无关、0.31 同样），
    // 但某真实项目的 8 状态 lifecycle 在 2.16.0-dev.0 下全过——是否溢出取决于图的尺寸。故 2.x 只允许停在 visual-check，v3 断言全闸通过。
    const lcSrc = path.join(base, 'lc-src.json');
    fs.writeFileSync(lcSrc, JSON.stringify({ schema_version: 1, diagram_type: 'lifecycle', meta: { title: '发布流程', quality_profile: 'showcase' },
      lanes: [{ id: 'main', label: '主流程' }],
      states: [{ id: 'queued', type: 'start', label: '排队', lane: 'main', col: 0 }, { id: 'building', type: 'active', label: '构建', lane: 'main', col: 1 }, { id: 'done', type: 'success', label: '完成', lane: 'main', col: 2 }],
      transitions: [{ from: 'queued', to: 'building', label: '开始' }, { from: 'building', to: 'done', label: '通过' }] }));
    const lcOut = path.join(base, 'lc.json');
    const lc = cli(['compile', '--diagram', lcSrc, '--sidecar', sidecar, '--out', lcOut, '--no-trace'], env);
    assert.equal(lc.code, 0, lc.stdout);
    assert.equal(lc.receipt.data.injected.tags, 1, 'lifecycle state tag 注入');
    const lcGate = cli(['gate', '--diagram', lcOut, '--out', path.join(base, 'out', 'lc.html')], env, base);
    if (profile === 'v3') assert.equal(lcGate.code, 0, lcGate.stdout);
    else assert.match(lcGate.stdout, /"final": "fail"|"final": "pass"/);
    if (profile === 'v2' && lcGate.code !== 0) assert.equal(lcGate.receipt.data.stage, 'visual-check', '2.x 只允许停在 visual-check（首屏约束）');

    // ③ 失败诊断原样带出：删 meta.title → validate 闸失败，诊断含内核结构化码
    const bad = JSON.parse(JSON.stringify(spec));
    delete bad.meta.title;
    const badPath = path.join(base, 'bad.json');
    fs.writeFileSync(badPath, JSON.stringify(bad));
    const g2 = cli(['gate', '--diagram', badPath, '--out', path.join(base, 'out', 'bad.html')], env, base);
    assert.equal(g2.code, 1);
    assert.equal(g2.receipt.diagnostics[0].rule, 'gate_validate-failed');
    assert.match(g2.receipt.diagnostics[0].evidence, /内核诊断\[/);
  });
}
