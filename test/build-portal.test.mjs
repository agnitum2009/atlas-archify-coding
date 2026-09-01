// 门户生成器牙齿（specs/atlas-layout.md §〇-v3，2026-08-16 负责人令）：两级门户幂等生成 + 计数正确
// + 相对链接零拷贝（../../ 深度逐条 resolve 验存在）+ 注册表（state/projects.json）登记/复用/幂等/
// 坏 JSON fail-loud + 同名异路派生伞 + 根索引两级导航；项目子目录不存在 = exit 1 fail-loud；
// 缺省 --init 用今天。全部临时目录，绝不触碰生产数据根。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTAL = path.join(ROOT, 'scripts', 'build-portal.mjs');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// v2/v3 项目骨架：两个模块目录共 3 个 html，其中一个图带 visual-check PNG。
function scaffoldProject(root, project) {
  const a = path.join(root, 'artifacts', project);
  const e = path.join(root, 'evidence', project);
  fs.mkdirSync(path.join(a, 'loops-260815'), { recursive: true });
  fs.writeFileSync(path.join(a, 'loops-260815', 'demo.html'), '<html>demo</html>\n');
  fs.writeFileSync(path.join(a, 'loops-260815', 'extra.html'), '<html>extra</html>\n');
  fs.mkdirSync(path.join(a, 'batch-260815'), { recursive: true });
  fs.writeFileSync(path.join(a, 'batch-260815', 'main.html'), '<html>main</html>\n');
  fs.writeFileSync(path.join(a, 'batch-260815', 'notes.txt'), 'x'); // 非 html 不计入
  fs.mkdirSync(path.join(e, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(e, 'demo', 'demo.visual-check.1440x900.dark.png'), 'x');
  return { htmlCount: 3 };
}

// v3 标准根骨架：七区 + INDEX.md（页脚正本链接目标）+ spec/<项目>/（--root 与注册表写路径的前置）。
function scaffoldRoot(root) {
  for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history']) {
    fs.mkdirSync(path.join(root, z), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'INDEX.md'), '# 项目注册表\n\n| 项目 | demo |\n');
  fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'spec', 'demo', 'main.json'), '{}\n');
  scaffoldProject(root, 'demo');
}

function runPortal(args) {
  return spawnSync(process.execPath, [PORTAL, ...args], { encoding: 'utf8' });
}

test('build-portal：两级门户幂等生成 + 计数正确 + 相对链接零拷贝；注册表登记；旧 v2 平铺门户保留', () => {
  const dir = tmpdir('portal-ok-');
  try {
    const root = path.join(dir, 'atlas');
    scaffoldRoot(root);
    // 旧 v2 平铺门户（存量样本，根下保留不迁，§〇-v3.5 兼容）。
    fs.mkdirSync(path.join(root, 'demo-add-260801'), { recursive: true });
    fs.writeFileSync(path.join(root, 'demo-add-260801', 'index.html'), '<html>old</html>\n');

    const r1 = runPortal(['--atlas', root, '--project', 'demo', '--init', '260815']);
    assert.equal(r1.status, 0, r1.stderr);
    assert.ok(r1.stdout.includes('demo-add/demo-add-260815'), '打印两级门户路径；' + r1.stdout);
    assert.ok(r1.stdout.includes('3 件交付物'), '收录计数 = 3 个 html；' + r1.stdout);
    assert.ok(r1.stdout.includes('2 个模块'), '模块计数 = 2；' + r1.stdout);
    assert.ok(r1.stdout.includes('新登记'), '首个登记者 = 新建伞；' + r1.stdout);

    const index = fs.readFileSync(path.join(root, 'demo-add', 'demo-add-260815', 'index.html'), 'utf8');
    assert.ok(index.includes('纯生成物，重跑本命令覆盖'), '头注声明纯生成物');
    // 相对链接零拷贝：两级深度指向 ../../artifacts/ 与 ../../evidence/，期目录内除 index.html 无他物。
    assert.ok(index.includes('../../artifacts/demo/loops-260815/demo.html'), 'HTML 链接为相对路径零拷贝（两级深度）');
    assert.ok(index.includes('../../evidence/demo/demo/demo.visual-check.1440x900.dark.png'), 'visual-check PNG 缩略链接（两级深度）');
    const portalFiles = fs.readdirSync(path.join(root, 'demo-add', 'demo-add-260815'));
    assert.deepEqual(portalFiles, ['index.html'], '期目录 = 纯生成物，仅 index.html');

    // 注册表登记：{project, umbrella, sourcePath:null, firstSeen, portals:['260815']}（§〇-v3.3 形状）。
    const reg1 = fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8');
    const reg = JSON.parse(reg1);
    assert.equal(reg.schemaVersion, 1);
    assert.equal(reg.projects.length, 1);
    assert.equal(reg.projects[0].project, 'demo');
    assert.equal(reg.projects[0].umbrella, 'demo-add');
    assert.equal(reg.projects[0].sourcePath, null, '未给 --source 登记为 null');
    assert.match(reg.projects[0].firstSeen, /^\d{4}-\d{2}-\d{2}$/, 'firstSeen = ISO 日期');
    assert.deepEqual(reg.projects[0].portals, ['260815'], 'portals 含本期');

    // 幂等：重跑 exit 0、门户/注册表字节不变；旧 v2 平铺门户保留为历史。
    const r2 = runPortal(['--atlas', root, '--project', 'demo', '--init', '260815']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(r2.stdout.includes('复用已登记伞'), '同期重跑复用已登记伞；' + r2.stdout);
    assert.equal(fs.readFileSync(path.join(root, 'demo-add', 'demo-add-260815', 'index.html'), 'utf8'), index, '重跑幂等：index.html 内容不变');
    assert.equal(fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8'), reg1, '重跑幂等：注册表字节不变');
    assert.ok(fs.existsSync(path.join(root, 'demo-add-260801', 'index.html')), '旧 v2 平铺门户保留为历史，不删不覆盖');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal：项目子目录不存在 = exit 1 fail-loud', () => {
  const dir = tmpdir('portal-missing-');
  try {
    const root = path.join(dir, 'atlas');
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
    const r = runPortal(['--atlas', root, '--project', 'nope', '--init', '260815']);
    assert.equal(r.status, 1);
    assert.ok((r.stderr + r.stdout).includes('artifacts/nope'), 'fail-loud 指名缺失的项目子目录；' + r.stderr + r.stdout);
    assert.ok(!fs.existsSync(path.join(root, 'nope-add')), '失败不得生成空壳伞');
    assert.ok(!fs.existsSync(path.join(root, 'state', 'projects.json')), '失败不写注册表');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal：缺省 --init 用今天；未知旗标与坏日期 = exit 1', () => {
  const dir = tmpdir('portal-default-');
  try {
    const root = path.join(dir, 'atlas');
    for (const z of ['spec', 'artifacts', 'evidence']) fs.mkdirSync(path.join(root, z), { recursive: true });
    fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
    scaffoldProject(root, 'demo');
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = String(now.getFullYear()).slice(2) + mm + dd;
    const r = runPortal(['--atlas', root, '--project', 'demo']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(root, 'demo-add', 'demo-add-' + today, 'index.html')), '缺省 --init = 今天 ' + today);
    const badFlag = runPortal(['--atlas', root, '--project', 'demo', '--sidecar', 'x']);
    assert.equal(badFlag.status, 1);
    assert.ok(badFlag.stderr.includes('未知旗标'), '未知旗标拒绝（fail-loud）；' + badFlag.stderr);
    const badDate = runPortal(['--atlas', root, '--project', 'demo', '--init', '26081']);
    assert.equal(badDate.status, 1);
    assert.ok(badDate.stderr.includes('YYMMDD'), '坏日期格式拒绝；' + badDate.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal --root：两级导航 + v2 平铺门户兼容收录 + 七区计数 + 账本速览 + 相对链接零绝对路径', () => {
  const dir = tmpdir('portal-root-ok-');
  try {
    const root = path.join(dir, 'atlas');
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history']) {
      fs.mkdirSync(path.join(root, z), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'INDEX.md'), '# 项目注册表\n');
    // 项目 demo：2 规格 / 3 交付物 / 1 证据目录；v2 平铺门户 260801（旧）+ 260815（新）。
    fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'spec', 'demo', 'main.json'), '{}\n');
    scaffoldProject(root, 'demo');
    fs.mkdirSync(path.join(root, 'demo-add-260801'), { recursive: true });
    fs.writeFileSync(path.join(root, 'demo-add-260801', 'index.html'), '<html>old</html>\n');
    fs.mkdirSync(path.join(root, 'demo-add-260815'), { recursive: true });
    fs.writeFileSync(path.join(root, 'demo-add-260815', 'index.html'), '<html>new</html>\n');
    // 项目 add：1 规格 / 1 交付物 / 0 证据目录；无门户（给生成提示）。
    fs.mkdirSync(path.join(root, 'spec', 'add'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'add', 'flow.json'), '{}\n');
    fs.mkdirSync(path.join(root, 'artifacts', 'add', 'mod-260816'), { recursive: true });
    fs.writeFileSync(path.join(root, 'artifacts', 'add', 'mod-260816', 'flow.html'), '<html>flow</html>\n');
    // 账本：节点 2 / revision 7 / trace 3 / lessons 0 / notices 1。
    fs.writeFileSync(path.join(root, 'state', 'atlas-state.json'),
      JSON.stringify({ schemaVersion: 1, nodes: { a: {}, b: {} }, revision: 7, trace: [1, 2, 3], lessons: [], notices: [1] }));

    const r = runPortal(['--atlas', root, '--root']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('根可视化索引'), '打印根索引；' + r.stdout);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    // a) 项目卡片区：两项目齐全；v2 平铺门户照常收录最新一期并标注建议迁移（§〇-v3.5）。
    assert.ok(html.includes('<h2>项目卡片</h2>'), '项目卡片区标题');
    assert.ok(html.includes('<h2>demo</h2>'), 'demo 卡片');
    assert.ok(html.includes('<h2>add</h2>'), 'add 卡片');
    assert.ok(html.includes('两级导航'), '页头两级导航说明');
    assert.ok(html.includes('v2 平铺门户（建议迁移）'), 'v2 平铺门户兼容收录标注');
    assert.ok(html.includes('href="demo-add-260815/index.html"'), 'v2 兼容链接取最新 260815');
    assert.ok(!html.includes('href="demo-add-260801/index.html"'), 'v2 旧门户不出现为链接');
    assert.ok(html.includes('初始化 2026-08-01 · 最近重扫 2026-08-15'), 'v2 门户日期解析（首期/末期 → YYYY-MM-DD）');
    assert.ok(html.includes('规格 2 · 交付物 3 · 证据目录 1'), 'demo 实扫计数：2 规格/3 交付物/1 证据目录');
    assert.ok(html.includes('规格 1 · 交付物 1 · 证据目录 0'), 'add 实扫计数：1 规格/1 交付物/0 证据目录');
    assert.ok(html.includes('（无门户：'), '无门户项目给生成提示');

    // b) 七区地图：七区各一行职责 + 实时计数。
    assert.ok(html.includes('<h2>七区地图</h2>'), '七区地图标题');
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history']) {
      assert.ok(html.includes('<code>' + z + '/</code>'), '七区地图含 ' + z + '/');
    }
    assert.ok(html.includes('3 文件 · 2 目录'), 'spec 区实时计数（2 项目目录 + 3 规格文件）');
    assert.ok(html.includes('0 文件 · 0 目录'), 'rulings 空区计数为 0 文件 · 0 目录');

    // c) 账本速览：直读 atlas-state.json 的节点数/revision/trace/lessons/notices。
    assert.ok(html.includes('<h2>账本速览</h2>'), '账本速览标题');
    assert.ok(html.includes('节点数：2'), '账本节点数');
    assert.ok(html.includes('revision：7'), '账本 revision');
    assert.ok(html.includes('trace 条数：3'), '账本 trace 条数');
    assert.ok(html.includes('lessons 条数：0'), '账本 lessons 条数');
    assert.ok(html.includes('notices 条数：1'), '账本 notices 条数');

    // d) 页脚：时间戳 + 纯生成物声明 + INDEX.md 相对链接。
    assert.ok(/生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(html), '页脚生成时间戳');
    assert.ok(html.includes('纯生成物，重跑 build-portal --root 覆盖'), '页脚纯生成物声明');
    assert.ok(html.includes('文字正本见'), '页脚 INDEX.md 正本指引');
    assert.ok(html.includes('href="INDEX.md"'), 'INDEX.md 相对链接');

    // 相对链接零绝对路径：所有 href 均相对且不含本机路径。
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0, '存在链接');
    assert.ok(hrefs.every((h) => !h.startsWith('/') && !h.includes(dir)), 'href 零绝对路径；' + hrefs.join(', '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal --root：两级导航含全部期且最新标记正确（伞下多期 + 实跑生成）', () => {
  const dir = tmpdir('portal-root-nav-');
  try {
    const root = path.join(dir, 'atlas');
    scaffoldRoot(root);
    const r1 = runPortal(['--atlas', root, '--project', 'demo', '--init', '260815']);
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = runPortal(['--atlas', root, '--project', 'demo', '--init', '260816']);
    assert.equal(r2.status, 0, r2.stderr);
    const r3 = runPortal(['--atlas', root, '--root']);
    assert.equal(r3.status, 0, r3.stderr);
    assert.ok(r3.stdout.includes('期门户：2'), '索引统计期数；' + r3.stdout);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    // 两级导航：项目伞 → 该伞下各期门户，链接 <伞名>/<伞名>-<日期>/index.html，倒序、最新标「最新」。
    assert.ok(html.includes('伞：<code>demo-add/</code>'), '卡片显示伞名');
    assert.ok(html.includes('初始化：2026-08-15 · 最近重扫：2026-08-16 · 期数 2'), '初始化（首期）/最近重扫（末期）/期数');
    assert.ok(html.includes('href="demo-add/demo-add-260816/index.html"'), '链接 260816 期');
    assert.ok(html.includes('href="demo-add/demo-add-260815/index.html"'), '链接 260815 期');
    assert.ok(html.includes('260816（最新）'), '最新一期（260816）标「最新」');
    assert.ok(!html.includes('260815（最新）'), '旧一期不标「最新」');
    assert.ok(html.indexOf('260816') < html.indexOf('260815'), '期列表倒序（最新在前）');
    // 根索引两级链接逐条 resolve 验存在。
    for (const m of html.matchAll(/href="([^"#]+)"/g)) {
      const target = path.resolve(path.dirname(path.join(root, 'index.html')), m[1]);
      assert.ok(fs.existsSync(target), '根索引链接可达：' + m[1]);
    }
    // 注册表两期去重升序。
    const reg = JSON.parse(fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8'));
    assert.deepEqual(reg.projects[0].portals, ['260815', '260816'], 'portals 去重升序');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal --source：同名异路派生 <项目>-<slug>-add 伞（父目录名 slug + 占用向上追加 + sha 兜底）', () => {
  const dir = tmpdir('portal-source-');
  try {
    const root = path.join(dir, 'atlas');
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state']) fs.mkdirSync(path.join(root, z), { recursive: true });
    fs.mkdirSync(path.join(root, 'spec', 'add'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'add', 'flow.json'), '{}\n');
    scaffoldProject(root, 'add');

    // a) 首个登记者不带路径段（负责人原话「第一个出现忽略这个路径」）：首跑即带 --source，伞仍缺省 add-add。
    const r1 = runPortal(['--atlas', root, '--project', 'add', '--source', '/srv/origin/add', '--init', '260815']);
    assert.equal(r1.status, 0, r1.stderr);
    assert.ok(fs.existsSync(path.join(root, 'add-add', 'add-add-260815', 'index.html')), '缺省伞 add-add/add-add-260815（首个登记者不带路径段）');

    // c) 同名异路：--source /srv/mirror/add 与登记值不同 → slug = 父目录名 mirror → 伞 add-mirror-add。
    const r2 = runPortal(['--atlas', root, '--project', 'add', '--source', '/srv/mirror/add', '--init', '260815']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(fs.existsSync(path.join(root, 'add-mirror-add', 'add-mirror-add-260815', 'index.html')), '同名异路伞 add-mirror-add（slug=父目录名）');

    // 占用向上追加一段：--source /hosts/mirror/add → segs [mirror, hosts]，mirror 被占 → add-mirror-hosts-add。
    const r3 = runPortal(['--atlas', root, '--project', 'add', '--source', '/hosts/mirror/add', '--init', '260815']);
    assert.equal(r3.status, 0, r3.stderr);
    assert.ok(fs.existsSync(path.join(root, 'add-mirror-hosts-add', 'add-mirror-hosts-add-260815', 'index.html')), '占用向上追加段 add-mirror-hosts-add');

    // 仍冲突追加路径 sha256 前 6：--source /mirror/add → segs [mirror] 唯一段被占 → sha 兜底。
    const sha6 = crypto.createHash('sha256').update('/mirror/add').digest('hex').slice(0, 6);
    const r4 = runPortal(['--atlas', root, '--project', 'add', '--source', '/mirror/add', '--init', '260815']);
    assert.equal(r4.status, 0, r4.stderr);
    assert.ok(fs.existsSync(path.join(root, 'add-mirror-' + sha6 + '-add', 'add-mirror-' + sha6 + '-add-260815', 'index.html')), 'sha 兜底伞 add-mirror-' + sha6 + '-add');

    // 注册表：4 条目，伞名/源路径一一对应，首条不带路径段。
    const reg = JSON.parse(fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8'));
    assert.deepEqual(
      reg.projects.map((e) => [e.umbrella, e.sourcePath]),
      [
        ['add-add', '/srv/origin/add'],
        ['add-mirror-add', '/srv/mirror/add'],
        ['add-mirror-hosts-add', '/hosts/mirror/add'],
        ['add-mirror-' + sha6 + '-add', '/mirror/add'],
      ],
      '注册表四条目：伞名 ↔ 源路径映射（首条不带路径段）；' + JSON.stringify(reg.projects),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal --source：同 source 复用已登记伞（多期累积）；注册表幂等', () => {
  const dir = tmpdir('portal-reuse-');
  try {
    const root = path.join(dir, 'atlas');
    for (const z of ['spec', 'artifacts', 'evidence', 'data', 'state']) fs.mkdirSync(path.join(root, z), { recursive: true });
    fs.mkdirSync(path.join(root, 'spec', 'add'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'add', 'flow.json'), '{}\n');
    scaffoldProject(root, 'add');

    const r1 = runPortal(['--atlas', root, '--project', 'add', '--source', '/srv/mirror/add', '--init', '260815']);
    assert.equal(r1.status, 0, r1.stderr);
    // 登记值 null 时 --source 首次给出即补记（b 分支）；此后同 source 复用同一伞。
    const r2 = runPortal(['--atlas', root, '--project', 'add', '--source', '/srv/mirror/add', '--init', '260816']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(r2.stdout.includes('复用已登记伞'), '同 source 复用伞；' + r2.stdout);
    const reg = JSON.parse(fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8'));
    assert.equal(reg.projects.length, 1, '同 source 不新开条目');
    assert.equal(reg.projects[0].umbrella, 'add-add', '复用首登记伞（首登记者不给路径段——本例首跑即带 source，登记为该 source 的缺省伞）');
    assert.equal(reg.projects[0].sourcePath, '/srv/mirror/add', 'sourcePath 补记');
    assert.deepEqual(reg.projects[0].portals, ['260815', '260816'], '两期去重升序累积');
    // 幂等：同 source 同期重跑 → 注册表字节不变。
    const before = fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8');
    const r3 = runPortal(['--atlas', root, '--project', 'add', '--source', '/srv/mirror/add', '--init', '260816']);
    assert.equal(r3.status, 0, r3.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'state', 'projects.json'), 'utf8'), before, '注册表幂等（字节不变）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal：注册表坏 JSON = exit 1 fail-loud（不静默重建、不生成门户）', () => {
  const dir = tmpdir('portal-badjson-');
  try {
    const root = path.join(dir, 'atlas');
    scaffoldRoot(root);
    const regPath = path.join(root, 'state', 'projects.json');
    fs.writeFileSync(regPath, '{oops 不是 JSON');
    const r = runPortal(['--atlas', root, '--project', 'demo', '--init', '260815']);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('projects.json'), 'fail-loud 指名注册表；' + r.stderr);
    assert.ok(r.stderr.includes('fail-loud') || r.stderr.includes('不可解析'), '消息说明不静默重建；' + r.stderr);
    assert.equal(fs.readFileSync(regPath, 'utf8'), '{oops 不是 JSON', '坏 JSON 原样保留（绝不静默重建）');
    assert.ok(!fs.existsSync(path.join(root, 'demo-add')), '坏注册表不生成门户');
    // --root 模式同样 fail-loud。
    const r2 = runPortal(['--atlas', root, '--root']);
    assert.equal(r2.status, 1);
    assert.ok(r2.stderr.includes('projects.json'), '--root 同法 fail-loud；' + r2.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'index.html')), '--root 失败不生成根索引');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal：门户页相对链接在两级深度下可达（href/src 逐条 resolve 验存在）', () => {
  const dir = tmpdir('portal-reldepth-');
  try {
    const root = path.join(dir, 'atlas');
    scaffoldRoot(root);
    const r = runPortal(['--atlas', root, '--project', 'demo', '--init', '260815']);
    assert.equal(r.status, 0, r.stderr);
    const portalDir = path.join(root, 'demo-add', 'demo-add-260815');
    const html = fs.readFileSync(path.join(portalDir, 'index.html'), 'utf8');
    const refs = [
      ...[...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]),
    ].filter((u) => u.startsWith('../'));
    assert.ok(refs.length >= 4, '相对引用齐全（3 交付物链接 + PNG 缩略 src/href）；' + refs.join(', '));
    for (const u of refs) {
      const target = path.resolve(portalDir, u);
      assert.ok(fs.existsSync(target), '两级深度相对链接可达：' + u);
    }
    // 全部为 ../../ 深度（两级门户 → 根 → 区）。
    assert.ok(refs.every((u) => u.startsWith('../../')), '相对链接均为 ../../（深度 +1 修正）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal --root：幂等（重跑 exit 0；内容仅时间戳行可异）', () => {
  const dir = tmpdir('portal-root-idem-');
  try {
    const root = path.join(dir, 'atlas');
    for (const z of ['spec', 'artifacts', 'evidence']) fs.mkdirSync(path.join(root, z), { recursive: true });
    fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
    scaffoldProject(root, 'demo');

    const r1 = runPortal(['--atlas', root, '--root']);
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = runPortal(['--atlas', root, '--root']);
    assert.equal(r2.status, 0, r2.stderr);
    const stripStamp = (h) => h.replace(/生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, '生成时间：STAMP');
    const h1 = stripStamp(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    const h2 = stripStamp(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    assert.equal(h2, h1, '重跑幂等：除生成时间戳外字节一致');
    assert.equal(fs.readdirSync(root).filter((n) => n === 'index.html').length, 1, '根 index.html 唯一（覆盖不增殖）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal：--root 与 --project 互斥 = exit 1 bad usage；--root 拒 --init/--source', () => {
  const dir = tmpdir('portal-root-mutex-');
  try {
    const root = path.join(dir, 'atlas');
    for (const z of ['spec', 'artifacts', 'evidence']) fs.mkdirSync(path.join(root, z), { recursive: true });
    fs.mkdirSync(path.join(root, 'spec', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'demo', 'demo.json'), '{}\n');
    scaffoldProject(root, 'demo');
    const both = runPortal(['--atlas', root, '--root', '--project', 'demo']);
    assert.equal(both.status, 1);
    assert.ok(both.stderr.includes('互斥'), '互斥消息；' + both.stderr);
    const withInit = runPortal(['--atlas', root, '--root', '--init', '260815']);
    assert.equal(withInit.status, 1);
    assert.ok(withInit.stderr.includes('--init'), '--root 模式拒 --init；' + withInit.stderr);
    const withSource = runPortal(['--atlas', root, '--root', '--source', '/srv/x']);
    assert.equal(withSource.status, 1);
    assert.ok(withSource.stderr.includes('--source'), '--root 模式拒 --source；' + withSource.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'index.html')), '失败不生成根索引');
    assert.ok(!fs.existsSync(path.join(root, 'demo-add')), '失败不生成伞');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-portal --root：根缺 spec/ 项目一级子目录 = exit 1 fail-loud', () => {
  const dir = tmpdir('portal-root-spec-');
  try {
    const root = path.join(dir, 'atlas');
    // spec/ 整个缺失。
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    const r1 = runPortal(['--atlas', root, '--root']);
    assert.equal(r1.status, 1);
    assert.ok((r1.stderr + r1.stdout).includes('spec'), 'fail-loud 指名 spec；' + r1.stderr + r1.stdout);
    // spec/ 存在但无项目一级子目录（v1 平铺根）同样拒绝。
    fs.mkdirSync(path.join(root, 'spec'));
    fs.writeFileSync(path.join(root, 'spec', 'demo.json'), '{}\n');
    const r2 = runPortal(['--atlas', root, '--root']);
    assert.equal(r2.status, 1);
    assert.ok((r2.stderr + r2.stdout).includes('项目'), '指名无项目一级子目录；' + r2.stderr + r2.stdout);
    assert.ok(!fs.existsSync(path.join(root, 'index.html')), '失败不得生成空壳根索引');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
