// O1 牙齿（2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O1）：
// 锚根白名单写边硬校验 + 首跑 grandfathered 豁免清单。真实子进程 + 临时 atlas，绝不触碰真实侧车。
//
// 覆盖：门未激活（自由侧车）零拦截；atlas 根/registry sourcePath/config/--allow-root 四源；根外拒写（error 非 warning）；
// 首跑快照（含 receipt 锚）+ 豁免内 warning；reanchor 新锚同过白名单且被拒时零写入；禁入来源（dist 段 / 临时目录）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
const REPO_ROOT = path.resolve(path.dirname(BIN), '..');

function run(args, cwd) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', cwd });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout, stderr: res.stderr };
}

function mkAtlas() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-o1-'));
  const stateDir = path.join(dir, 'atlas', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'atlas', 'c.ts'), 'inside atlas\n');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'o.ts'), 'outside atlas\n');
  return { dir, stateDir, sidecar: path.join(stateDir, 'atlas-state.json'), atlas: path.join(dir, 'atlas'), outside };
}

function register(atlas, entries) {
  fs.writeFileSync(path.join(atlas.stateDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: entries }, null, 2) + '\n');
}

function seedNode(atlas, node = 'demo-n1') {
  const r = run(['state', 'set', '--node', node, '--axis', 'progress', '--value', 'planned', '--reason', 'r', '--owner', 'o', '--class', 'task', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(r.code, 0, r.stdout);
}

test('O1 门未激活：自由侧车（无 projects.json/anchor-roots.json）零拦截，不产豁免文件', () => {
  const atlas = mkAtlas();
  seedNode(atlas);
  const r = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(atlas.outside, 'o.ts') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.receipt.data.anchorRoot.gate, 'inactive');
  assert.equal(r.receipt.data.anchorRoot.exempted, false);
  assert.ok(!fs.existsSync(path.join(atlas.stateDir, 'anchor-root-exemptions.json')), '门未激活不得产豁免文件');
  fs.rmSync(atlas.dir, { recursive: true, force: true });
});

test('O1 四源白名单：atlas 根 / registry sourcePath / anchor-roots.json / --allow-root；根外 exit 1 且诊断含根名', () => {
  const atlas = mkAtlas();
  seedNode(atlas);
  register(atlas, [{ project: 'demo', umbrella: 'demo-add', sourcePath: REPO_ROOT, sidecar: 'atlas-state.json' }]);

  const inAtlas = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(atlas.atlas, 'c.ts') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(inAtlas.code, 0, inAtlas.stdout);
  assert.equal(inAtlas.receipt.data.anchorRoot.matched, atlas.atlas);
  assert.equal(inAtlas.receipt.data.anchorRoot.source, 'atlas-root');

  const inRegistry = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(REPO_ROOT, 'lib', 'commands.mjs') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(inRegistry.code, 0, inRegistry.stdout);
  assert.equal(inRegistry.receipt.data.anchorRoot.matched, REPO_ROOT);
  assert.equal(inRegistry.receipt.data.anchorRoot.source, 'registry');

  const denied = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(atlas.outside, 'o.ts') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(denied.code, 1, '白名单外锚必须 exit 1：' + denied.stdout);
  assert.equal(denied.receipt.diagnostics[0].rule, 'anchor_root_denied');
  assert.ok(denied.receipt.diagnostics[0].evidence.includes(atlas.atlas), '诊断须含白名单根名：' + denied.receipt.diagnostics[0].evidence);

  const allowed = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(atlas.outside, 'o.ts') + ':1', '--allow-root', atlas.outside, '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(allowed.code, 0, allowed.stdout);
  assert.equal(allowed.receipt.data.anchorRoot.source, 'cli');

  // 配置源：换掉 registry，改由 <侧车同目录>/anchor-roots.json 显式登记（config 来源同过滤临时目录，故用仓根）
  fs.rmSync(path.join(atlas.stateDir, 'projects.json'));
  fs.writeFileSync(path.join(atlas.stateDir, 'anchor-roots.json'), JSON.stringify({ schemaVersion: 1, anchorRoots: [REPO_ROOT] }, null, 2) + '\n');
  const viaConfig = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(REPO_ROOT, 'lib', 'evidence.mjs') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(viaConfig.code, 0, viaConfig.stdout);
  assert.equal(viaConfig.receipt.data.anchorRoot.source, 'config');
  assert.equal(viaConfig.receipt.data.anchorRoot.matched, REPO_ROOT);
  fs.rmSync(atlas.dir, { recursive: true, force: true });
});

test('O1 首跑快照：存量根外锚落 grandfathered 清单（path+reason+receipt 含 commit），豁免内 warning 不 error', () => {
  const atlas = mkAtlas();
  seedNode(atlas);
  // 先在门未激活时落一条「存量」根外锚（模拟 2026-09-14 之前的 43 条前缀错根锚）
  const legacy = path.join(atlas.outside, 'o.ts') + ':1';
  const pre = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', legacy, '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(pre.code, 0, pre.stdout);

  register(atlas, [{ project: 'demo', umbrella: 'demo-add', sourcePath: REPO_ROOT, sidecar: 'atlas-state.json' }]);
  const first = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(atlas.atlas, 'c.ts') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(first.code, 0, first.stdout);
  assert.equal(first.receipt.data.anchorRoot.exemptionsGenerated, 1, '首跑须把 1 条存量根外锚登记为豁免');

  const exemptionsPath = path.join(atlas.stateDir, 'anchor-root-exemptions.json');
  assert.ok(fs.existsSync(exemptionsPath), '首跑须落盘豁免清单');
  const doc = JSON.parse(fs.readFileSync(exemptionsPath, 'utf8'));
  assert.equal(doc.reason, 'grandfathered 2026-09-14');
  assert.equal(doc.entries.length, 1);
  assert.deepEqual(Object.keys(doc.entries[0]).sort(), ['path', 'reason', 'receipt']);
  assert.equal(doc.entries[0].path, path.join(atlas.outside, 'o.ts'));
  assert.equal(doc.entries[0].reason, 'grandfathered 2026-09-14');
  assert.equal(doc.entries[0].receipt.locator, 'lib/anchor-roots.mjs:1');
  assert.ok(doc.entries[0].receipt.commit === null || /^[0-9a-f]{7,40}$/.test(doc.entries[0].receipt.commit), 'receipt 须锚定实现 commit（或 null=无 git）');

  // 二次调用幂等：清单不被重写
  const again = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(atlas.atlas, 'c.ts') + ':2', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(again.code, 0, again.stdout);
  assert.equal(again.receipt.data.anchorRoot.exemptionsGenerated, undefined, '清单已存在即幂等，不重生成');

  // 豁免内锚：放行 + warning
  const rebless = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', legacy, '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(rebless.code, 0, rebless.stdout);
  assert.equal(rebless.receipt.data.anchorRoot.exempted, true);
  assert.ok(rebless.receipt.diagnostics.some((d) => d.rule === 'anchor_root_grandfathered' && d.severity === 'warning'));
  fs.rmSync(atlas.dir, { recursive: true, force: true });
});

test('O1 reanchor：新锚同过白名单，根外被拒且零写入（旧锚留原地）', () => {
  const atlas = mkAtlas();
  seedNode(atlas);
  register(atlas, [{ project: 'demo', umbrella: 'demo-add', sourcePath: REPO_ROOT, sidecar: 'atlas-state.json' }]);
  const oldAnchor = path.join(atlas.atlas, 'c.ts') + ':1';
  run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', oldAnchor, '--sidecar', atlas.sidecar], atlas.dir);

  const bad = run(['state', 'evidence-reanchor', '--node', 'demo-n1', '--from', oldAnchor, '--to', path.join(atlas.outside, 'o.ts') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(bad.code, 1, bad.stdout);
  assert.equal(bad.receipt.diagnostics[0].rule, 'anchor_root_denied');
  const after = JSON.parse(fs.readFileSync(atlas.sidecar, 'utf8'));
  assert.deepEqual(after.nodes['demo-n1'].evidence, [oldAnchor], '被拒 reanchor 须零写入');

  const good = run(['state', 'evidence-reanchor', '--node', 'demo-n1', '--from', oldAnchor, '--to', path.join(REPO_ROOT, 'lib', 'evidence.mjs') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(good.code, 0, good.stdout);
  assert.equal(good.receipt.data.anchorRoot.source, 'registry');
  fs.rmSync(atlas.dir, { recursive: true, force: true });
});

test('O1 禁入来源：registry/atlas 来源的 dist 段与临时目录根被拒（不静默入白名单），随回执披露', () => {
  const atlas = mkAtlas();
  seedNode(atlas);
  const distRepo = path.join(atlas.dir, 'build', 'dist', 'repo');
  fs.mkdirSync(distRepo, { recursive: true });
  fs.writeFileSync(path.join(distRepo, 'd.ts'), 'dist\n');
  register(atlas, [
    { project: 'demo', umbrella: 'demo-add', sourcePath: distRepo, sidecar: 'atlas-state.json' },
    { project: 'tmp', umbrella: 'tmp-add', sourcePath: path.join(os.tmpdir(), 'junk-repo'), sidecar: 'atlas-state.json' },
  ]);
  const denied = run(['state', 'evidence-add', '--node', 'demo-n1', '--locator', path.join(distRepo, 'd.ts') + ':1', '--sidecar', atlas.sidecar], atlas.dir);
  assert.equal(denied.code, 1, denied.stdout);
  assert.equal(denied.receipt.diagnostics[0].rule, 'anchor_root_denied');
  // registry 来源被拒事实须可机读（不静默）
  const rejected = JSON.parse(fs.readFileSync(atlas.stateDir + '/anchor-root-exemptions.json', 'utf8')).rejectedRoots;
  assert.ok(rejected.some((r) => r.reason === 'build-output' && r.root === distRepo), 'dist 段须被拒并披露：' + JSON.stringify(rejected));
  assert.ok(rejected.some((r) => r.reason === 'ephemeral-tmp'), '临时目录须被拒并披露：' + JSON.stringify(rejected));
  fs.rmSync(atlas.dir, { recursive: true, force: true });
});
