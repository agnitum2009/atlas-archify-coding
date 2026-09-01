// init 命令端到端牙齿（v3 版式：七区 + 项目子目录 + projects.json 注册表 + 拒绝覆盖）。
// 0.7.0（holdout 缺陷3）：init 原生成 v1 平铺版式，build-portal 要 v3——新项目须手工迁三层目录；
// 现 init 直接生成 v3，零手工迁移直通 build-portal/doctor（端到端钉死，见本文件最后一个测试）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSidecar } from '../lib/store.mjs';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
const PORTAL = new URL('../scripts/build-portal.mjs', import.meta.url).pathname;

// 可移植性（与 doctor.test.mjs 同法）：CI 无 archify 时 archify-kernel 检查 fail-closed 会干扰端到端断言，
// 用 stub 保证该检查在任何机器上确定性通过（本文件断言的是版式直通，非 archify 解析）。
const ARCHIFY_STUB = path.join(os.tmpdir(), 'atlas-init-e2e-archify-stub.mjs');
fs.writeFileSync(ARCHIFY_STUB, 'process.exit(0);\n');

function run(args) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt };
}

test('init 生成 v3 版式（七区 + 项目子目录 + projects.json 注册表）+ INDEX 注册 + 骨架 spec + sidecar；重复 init 拒绝', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-init-')), 'demo-atlas');
  const ok = run(['init', '--dir', dir, '--title', '演示图谱', '--diagram-type', 'architecture', '--diagram-id', 'demo-map']);
  assert.equal(ok.code, 0);
  assert.equal(ok.receipt.status, 'ok');
  for (const p of ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history']) {
    assert.ok(fs.existsSync(path.join(dir, p)), p + ' 目录缺失');
  }
  assert.ok(fs.existsSync(path.join(dir, 'INDEX.md')));
  // v3 版式：项目名 = --diagram-id 首段（demo-map → demo），spec 落 spec/<项目>/。
  assert.equal(ok.receipt.data.project, 'demo', '项目名派生须随回执返回（--diagram-id 首段）');
  for (const zone of ['spec', 'evidence', 'data', 'artifacts']) {
    assert.ok(fs.existsSync(path.join(dir, zone, 'demo')), zone + '/demo/ 项目子目录缺失');
  }
  assert.ok(fs.existsSync(path.join(dir, 'spec', 'demo', 'demo-map.json')));
  assert.ok(fs.existsSync(path.join(dir, 'state', 'atlas-state.json')));
  // state/projects.json 机器可读注册表（atlas-layout §〇-v3.3）：init 即登记，build-portal 复用该伞。
  const registry = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'projects.json'), 'utf8'));
  assert.equal(registry.schemaVersion, 1);
  assert.deepEqual(registry.projects.map((p) => [p.project, p.umbrella, p.sourcePath, p.portals]), [['demo', 'demo-add', null, []]]);
  const index = fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8');
  assert.ok(index.includes('七区制'), 'INDEX 未声明目录职责');
  assert.ok(index.includes('demo-map'), 'INDEX 未注册图');
  assert.ok(index.includes('demo-add'), 'INDEX 未注册项目伞目录');

  const again = run(['init', '--dir', dir, '--title', 'x']);
  assert.equal(again.code, 1);
  assert.equal(again.receipt.diagnostics[0].rule, 'atlas_exists');

  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('init --template：demo 三件落齐；minimal（缺省/显式）不变；未知模板 fail-loud exit 1（用户输入校验失败，非 internal）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-init-tpl-'));

  // demo：演示图 spec + 侧车示例节点 + INDEX 注册三件齐（v3：spec 落 spec/<项目>/，项目名 = --dir basename）。
  const demoDir = path.join(base, 'demo-atlas');
  const demo = run(['init', '--dir', demoDir, '--title', '演示图谱', '--template', 'demo']);
  assert.equal(demo.code, 0);
  assert.equal(demo.receipt.status, 'ok');
  assert.equal(demo.receipt.data.template, 'demo');
  assert.equal(demo.receipt.data.project, 'demo-atlas', '无 --diagram-id 时项目名 = --dir basename 清洗');
  const demoSpecPath = path.join(demoDir, 'spec', 'demo-atlas', 'demo-map.json');
  assert.ok(fs.existsSync(demoSpecPath), 'demo 模板应落地 spec/<项目>/demo-map.json（v3 版式）');
  const demoSpec = JSON.parse(fs.readFileSync(demoSpecPath, 'utf8'));
  assert.equal(demoSpec.schema_version, 1, 'schema_version 照抄主 spec');
  assert.equal(demoSpec.diagram_type, 'architecture', 'diagram_type 照抄主 spec');
  assert.ok(demoSpec.components.length >= 2 && demoSpec.components.length <= 3, '演示图 2-3 个 component');
  const demoIds = demoSpec.components.map((c) => c.id);
  for (const conn of demoSpec.connections) {
    assert.ok(demoIds.includes(conn.from) && demoIds.includes(conn.to), '演示图 connection 必须引用真实 component id');
  }
  const sidecar = JSON.parse(fs.readFileSync(path.join(demoDir, 'state', 'atlas-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(sidecar.nodes), ['demo-a'], '侧车恰好播种 1 个示例节点');
  assert.equal(sidecar.nodes['demo-a'].progress, 'planned');
  const index = fs.readFileSync(path.join(demoDir, 'INDEX.md'), 'utf8');
  assert.ok(index.includes('demo-map'), 'INDEX 未注册演示图');
  assert.ok(index.includes('这是演示图，跑通读图→state set→evidence-add→settle→report 全环后可删'), 'INDEX 未写明演示图删除条件');
  assert.ok(demo.receipt.data.created.includes('spec/demo-atlas/demo-map.json'), 'created 清单应含 v3 路径 demo-map.json');

  // minimal（缺省）：与既有行为一致，无任何 demo 产物；v3 版式主 spec 落 spec/<项目>/main.json。
  const minDir = path.join(base, 'minimal-atlas');
  const min = run(['init', '--dir', minDir, '--title', '最小图谱']);
  assert.equal(min.code, 0);
  assert.equal(min.receipt.data.template, 'minimal');
  assert.equal(min.receipt.data.project, 'minimal-atlas');
  assert.ok(fs.existsSync(path.join(minDir, 'spec', 'minimal-atlas', 'main.json')), 'minimal 主 spec 落 spec/<项目>/main.json');
  assert.ok(!fs.existsSync(path.join(minDir, 'spec', 'demo-map.json')));
  assert.ok(!fs.existsSync(path.join(minDir, 'spec', 'minimal-atlas', 'demo-map.json')));
  const minSidecar = JSON.parse(fs.readFileSync(path.join(minDir, 'state', 'atlas-state.json'), 'utf8'));
  assert.equal(Object.keys(minSidecar.nodes).length, 0);
  assert.ok(!fs.readFileSync(path.join(minDir, 'INDEX.md'), 'utf8').includes('demo-map'));

  // minimal（显式）＝缺省。
  const min2Dir = path.join(base, 'minimal-explicit');
  const min2 = run(['init', '--dir', min2Dir, '--title', '最小显式', '--template', 'minimal']);
  assert.equal(min2.code, 0);
  assert.ok(fs.existsSync(path.join(min2Dir, 'spec', 'minimal-explicit', 'main.json')));
  assert.ok(!fs.existsSync(path.join(min2Dir, 'spec', 'minimal-explicit', 'demo-map.json')));

  // 未知模板：fail-loud，不落地任何文件（exit 1 = 用户输入校验失败，非 internal）。
  const unknownDir = path.join(base, 'unknown-atlas');
  const unknown = run(['init', '--dir', unknownDir, '--title', 'x', '--template', 'yolo']);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.receipt.diagnostics[0].rule, 'unknown_template');
  assert.ok(!fs.existsSync(path.join(unknownDir, 'state', 'atlas-state.json')), '未知模板不得创建任何文件');

  fs.rmSync(base, { recursive: true, force: true });
});

test('init 侧车携带 revision:0 且可被 loadSidecar 直读；覆盖竞态时仍以 atlas_exists 拒绝', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-init-rev-'));
  const dir = path.join(base, 'rev-atlas');
  const res = run(['init', '--dir', dir, '--title', 'revision 图谱', '--template', 'demo']);
  assert.equal(res.code, 0);
  const sidecarPath = path.join(dir, 'state', 'atlas-state.json');
  // 初始 revision:0（与 store CAS 版本号约定对齐），落盘即可被 store 直接读。
  const loaded = loadSidecar(sidecarPath);
  assert.equal(loaded.revision, 0, 'init 侧车初始 revision 必须为 0');
  assert.equal(loaded.nodes['demo-a'].progress, 'planned');
  // O_EXCL 双保险：existsSync 检查与 'wx' 落盘之间窗口无关，已存在即拒绝且报同一错误码。
  const again = run(['init', '--dir', dir, '--title', 'x']);
  assert.equal(again.code, 1);
  assert.equal(again.receipt.diagnostics[0].rule, 'atlas_exists');
  fs.rmSync(base, { recursive: true, force: true });
});

test('项目名派生两条路径（零新旗标）：--diagram-id 首段 / --dir basename；派生为空 = bad_args 且不落地任何文件', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-init-derive-'));

  // 路径一：显式 --diagram-id 取首段（第一个连字符前）。
  const aDir = path.join(base, 'whatever-dir');
  const a = run(['init', '--dir', aDir, '--title', '派生A', '--diagram-id', 'trade-spine']);
  assert.equal(a.code, 0);
  assert.equal(a.receipt.data.project, 'trade', '--diagram-id trade-spine → 首段 trade');
  assert.ok(fs.existsSync(path.join(aDir, 'spec', 'trade', 'trade-spine.json')), '主 spec 落 spec/trade/');
  const aRegistry = JSON.parse(fs.readFileSync(path.join(aDir, 'state', 'projects.json'), 'utf8'));
  assert.equal(aRegistry.projects[0].umbrella, 'trade-add');

  // 路径二：无 --diagram-id 取 --dir basename，清洗为 [a-z0-9-]（大小写与非法字符折叠）。
  const bDir = path.join(base, 'Biz Atlas_2026');
  const b = run(['init', '--dir', bDir, '--title', '派生B']);
  assert.equal(b.code, 0);
  assert.equal(b.receipt.data.project, 'biz-atlas-2026', '--dir basename 清洗为 [a-z0-9-]');
  assert.ok(fs.existsSync(path.join(bDir, 'spec', 'biz-atlas-2026', 'main.json')), '缺省 diagram-id=main 落项目子目录');

  // 派生为空（--diagram-id 首段清洗后无 [a-z0-9] 字符）：fail-loud bad_args，不落地任何文件。
  const cDir = path.join(base, 'c-atlas');
  const c = run(['init', '--dir', cDir, '--title', '派生C', '--diagram-id', '-x']);
  assert.equal(c.code, 1);
  assert.equal(c.receipt.diagnostics[0].rule, 'bad_args');
  assert.ok(!fs.existsSync(cDir), '派生失败不得创建任何文件');

  fs.rmSync(base, { recursive: true, force: true });
});

// holdout 缺陷3 核心验收判据：全新 init 出来的目录，不做任何手工迁移，
// 直接跑 build-portal --project 与 doctor --sidecar --atlas 都应成功且 layout error=0。
test('零手工迁移端到端：init（v3）→ build-portal --project 直通 → doctor --atlas layout error=0', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-init-e2e-'));
  const dir = path.join(base, 'atlas');

  const init = run(['init', '--dir', dir, '--title', '零迁移直通', '--diagram-id', 'gov-map']);
  assert.equal(init.code, 0, JSON.stringify(init.receipt));
  assert.equal(init.receipt.data.project, 'gov', '项目名 = --diagram-id 首段');

  // 直通①：build-portal 不再 project_missing——init 已建 artifacts/<项目>/ 与注册表。
  const portal = spawnSync(process.execPath, [PORTAL, '--atlas', dir, '--project', 'gov'], { encoding: 'utf8' });
  assert.equal(portal.status, 0, 'build-portal 应零迁移直通：' + portal.stderr);
  const now = new Date();
  const yymmdd = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  const portalIndex = path.join(dir, 'gov-add', 'gov-add-' + yymmdd, 'index.html');
  assert.ok(fs.existsSync(portalIndex), 'v3 两级期门户 index.html 应生成：gov-add/gov-add-' + yymmdd + '/');
  const registry = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'projects.json'), 'utf8'));
  assert.deepEqual(registry.projects[0].portals, [yymmdd], '注册表 portals 应登记本期');

  // 直通②：doctor --sidecar --atlas 成功且 layout error=0。
  const doctor = spawnSync(process.execPath, [BIN, 'doctor', '--sidecar', path.join(dir, 'state', 'atlas-state.json'), '--atlas', dir], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { ARCHIFY_BIN: ARCHIFY_STUB }),
  });
  assert.equal(doctor.status, 0, 'doctor 应零迁移直通：' + doctor.stdout + doctor.stderr);
  const receipt = JSON.parse(doctor.stdout);
  assert.equal(receipt.status, 'ok');
  const layout = receipt.data.checks.find((c) => c.name === 'atlas-layout');
  assert.equal(layout.ok, true, 'atlas-layout 检查须通过：' + layout.detail);
  assert.ok(layout.detail.includes('0 error'), 'layout error 计数须为 0：' + layout.detail);
  const layoutErrors = receipt.data.layout.diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(layoutErrors, [], 'layout 明细零 error');

  fs.rmSync(base, { recursive: true, force: true });
});
