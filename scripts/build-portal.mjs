#!/usr/bin/env node
// 门户生成器（specs/atlas-layout.md §〇-v3，2026-08-16 负责人令）：扫 artifacts/<项目>/（按模块分组）
// 与 evidence/<项目>/（visual-check PNG 缩略），生成两级期门户 <根>/<伞名>/<伞名>-<YYMMDD>/index.html
// ——按模块分组的画廊页，相对链接 ../../artifacts/... ../../evidence/... 零拷贝（深度 +1，实跑逐条
// resolve 验存在由测试保证）。伞名缺省 <项目>-add；同名异路源仓派生 <项目>-<路径简写>-add（§〇-v3.2）。
// --root 模式（§〇.1/§〇-v3.4 根可视化索引）：扫数据根，生成 <根>/index.html 两级导航（项目伞 →
// 该伞下各期门户）+ 七区地图 + 账本速览 + 页脚四块（全相对链接，零拷贝）。
// 纯生成物：重跑本命令即覆盖 index.html（幂等）；旧期目录不删（历史保留）；禁手改。
// 零运行时依赖：手写 HTML 模板，明暗自适应一行 CSS（color-scheme）。可移植，无本机路径假设。
// 用法：node scripts/build-portal.mjs --atlas <根> --root
//      node scripts/build-portal.mjs --atlas <根> --project <名> [--source <源仓路径>] [--init <YYMMDD>]（缺省今天）
//      --root 与 --project 互斥（同给 = exit 1 bad usage）。
// 退出码：0=ok · 1=failed（用户输入/项目子目录缺失/根缺 spec/ 项目一级子目录/注册表坏 JSON）· 2=internal。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FLAGS = new Set(['--atlas', '--project', '--source', '--init', '--root']);
// 布尔旗标：只认存在，不取值（--root = 根可视化索引模式）。
const BOOLEAN_FLAGS = new Set(['--root']);

// §〇-v2.1 v2 平铺门户目录名（存量兼容：--root 照常收录并标注建议迁移）。
const PORTAL_RE = /^(.+)-add-(\d{6})$/;
// §〇-v3.1 伞目录名 <伞名>。
const UMBRELLA_RE = /^(.+)-add$/;

function fail(code, message) {
  process.stderr.write('build-portal ' + code + '：' + message + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!FLAGS.has(a)) {
      fail('bad_args', '未知旗标 ' + a + '（合法：--atlas <根> --root | --atlas <根> --project <名> [--source <源仓路径>] [--init <YYMMDD>]）');
    }
    if (BOOLEAN_FLAGS.has(a)) {
      args[a.slice(2)] = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      fail('bad_args', a + ' 缺少参数值');
    }
    args[a.slice(2)] = v;
    i += 1;
  }
  return args;
}

function todayYYMMDD(now) {
  const d = now || new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return String(d.getFullYear()).slice(2) + mm + dd;
}

function todayISO(now) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// HTML 转义（文件名/模块名嵌入模板的安全底线）。
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- §〇-v3.3 机器可读项目注册表 <根>/state/projects.json ----
// 形状：{schemaVersion:1, projects:[{project, umbrella, sourcePath|null, firstSeen, portals:[YYMMDD...]}]}。
// 由本脚本读写；坏 JSON fail-loud（exit 1，绝不静默重建）；文件缺失视为空注册表。
// 放 state/ 区不落根：根受 P1 禁平铺约束。

function registryPath(root) {
  return path.join(root, 'state', 'projects.json');
}

function loadRegistry(root) {
  const p = registryPath(root);
  if (!fs.existsSync(p)) return { schemaVersion: 1, projects: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    fail('registry_invalid', 'state/projects.json 不可解析（fail-loud，不静默重建）：' + err.message);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    fail('registry_invalid', 'state/projects.json 形状不符（须 {schemaVersion:1, projects:[{project, umbrella, sourcePath, firstSeen, portals}]}）');
  }
  if (data.schemaVersion !== 1) {
    fail('registry_invalid', 'state/projects.json schemaVersion 不支持：' + JSON.stringify(data.schemaVersion) + '（本引擎只认 1）');
  }
  return data;
}

function saveRegistry(root, registry) {
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(registryPath(root), JSON.stringify(registry, null, 2) + '\n');
}

// §〇-v3.2 路径简写：目录段名清洗为 [a-z0-9-]（小写、非法字符折叠为单个连字符、去首尾连字符）。
function slugify(segment) {
  return String(segment).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pathSha6(absPath) {
  return crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 6);
}

// §〇-v3.2 同名异路伞名分配：候选 slug 自源路径父目录起逐级向上（父 → 祖父 → …，去重清洗），
// 被占用则追加一段连字符连接直到唯一；全被占用追加路径 sha256 前 6（hex）。
// 占用 = 注册表已用伞名 ∪ 根下同名目录。负责人原话「第一个出现忽略这个路径」——首个登记者不带
// 路径段（缺省伞，见 buildPortal 决策 a），本函数只服务同名异路的新条目。
function uniqueUmbrella(root, registry, project, source) {
  const abs = path.resolve(source);
  const segs = [];
  for (let cur = path.dirname(abs); ;) {
    const s = slugify(path.basename(cur));
    if (s && !segs.includes(s)) segs.push(s);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (segs.length === 0) {
    const own = slugify(path.basename(abs));
    segs.push(own !== '' ? own : 'src');
  }
  const taken = (name) => registry.projects.some((e) => e && e.umbrella === name) || fs.existsSync(path.join(root, name));
  for (let i = 1; i <= segs.length; i += 1) {
    const name = project + '-' + segs.slice(0, i).join('-') + '-add';
    if (!taken(name)) return name;
  }
  return project + '-' + segs.join('-') + '-' + pathSha6(abs) + '-add';
}

// 该图在 evidence/<项目>/<id>/ 下的 visual-check PNG（取第一个；无则返回 null，只列 HTML 链接）。
function findVisualCheckPng(evidenceProjectDir, id) {
  const dir = path.join(evidenceProjectDir, id);
  let png = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.visual-check\..*\.png$/i.test(f)) {
        png = f;
        break;
      }
    }
  } catch {
    png = null; // 证据目录缺失 = 无缩略，不阻断
  }
  return png;
}

function buildPortal(opts) {
  const root = path.resolve(opts.atlas);
  const project = opts.project;
  const date = opts.init || todayYYMMDD();
  const source = opts.source !== undefined ? path.resolve(opts.source) : null;

  // fail-loud：项目子目录不存在（artifacts/ 为收录主源）即 exit 1，绝不生成空壳门户。
  const artifactsDir = path.join(root, 'artifacts', project);
  if (!fs.existsSync(artifactsDir) || !fs.statSync(artifactsDir).isDirectory()) {
    fail('project_missing', '项目子目录不存在：artifacts/' + project + '（atlas 根：' + root + '）');
  }
  const evidenceDir = path.join(root, 'evidence', project);

  // §〇-v3.3 注册表（坏 JSON fail-loud；缺失 = 空注册表）。
  const registry = loadRegistry(root);

  // §〇-v3.2 伞名决策：
  // a) 项目未登记 → 伞 <项目>-add（首个登记者不带路径段），登记 {project, umbrella, sourcePath: --source ?? null, firstSeen}；
  // b) 已登记且（未给 --source / --source === 登记值 / 登记值为 null）→ 复用该伞（null 首次给出时补记，
  //    后续异路才能正确分流）；
  // c) 已登记且 --source 与登记值不同 → 新条目伞 <项目>-<路径简写>-add（uniqueUmbrella）。
  const candidates = registry.projects.filter((e) => e && e.project === project);
  let entry = null;
  if (source !== null) {
    entry = candidates.find((e) => e.sourcePath === source) || candidates.find((e) => e.sourcePath == null) || null;
  } else if (candidates.length > 0) {
    entry = candidates[0];
  }
  let created = false;
  if (entry === null) {
    created = true;
    const umbrella = candidates.length === 0
      ? project + '-add'
      : uniqueUmbrella(root, registry, project, source);
    entry = { project, umbrella, sourcePath: source, firstSeen: todayISO(), portals: [] };
    registry.projects.push(entry);
  } else if (entry.sourcePath == null && source !== null) {
    entry.sourcePath = source;
  }
  const umbrella = entry.umbrella;

  // 按模块分组（模块目录名 <模块>-<YYMMDD>；只收 .html 交付物；排序保证幂等输出）。
  const modules = [];
  for (const e of fs.readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const items = fs.readdirSync(path.join(artifactsDir, e.name))
      .filter((f) => f.endsWith('.html'))
      .sort();
    if (items.length === 0) continue;
    modules.push({ name: e.name, items });
  }
  modules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const total = modules.reduce((n, m) => n + m.items.length, 0);

  // 相对链接：门户在 <根>/<伞名>/<伞名>-<日期>/ 两级深度，向上退两级再入区（零拷贝）。
  const relArtifact = (moduleName, file) => '../../artifacts/' + project + '/' + moduleName + '/' + file;
  const relEvidence = (id, png) => '../../evidence/' + project + '/' + id + '/' + png;

  const sections = [];
  for (const m of modules) {
    const lis = m.items.map((f) => {
      const id = f.slice(0, -'.html'.length);
      const png = findVisualCheckPng(evidenceDir, id);
      const thumb = png
        ? ' <a href="' + esc(relEvidence(id, png)) + '"><img class="thumb" src="' + esc(relEvidence(id, png)) + '" alt="visual-check ' + esc(id) + '"></a>'
        : '';
      return '<li><a href="' + esc(relArtifact(m.name, f)) + '">' + esc(id) + '（HTML）</a>' + thumb + '</li>';
    });
    sections.push('<section><h2>模块 ' + esc(m.name) + '（' + m.items.length + ' 件）</h2>\n<ul>\n' + lis.join('\n') + '\n</ul></section>');
  }
  const body = sections.length > 0 ? sections.join('\n') : '<p>（无交付物）</p>';

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">', // 明暗自适应一行 CSS
    '<title>' + esc(project) + ' 图集门户 ' + esc(date) + '</title>',
    '<style>',
    '  body { font-family: system-ui, sans-serif; max-width: 72em; margin: 2em auto; padding: 0 1em; line-height: 1.6; }',
    '  img.thumb { max-width: 320px; height: auto; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 4px; vertical-align: middle; }',
    '  a { text-decoration: none; }',
    '</style>',
    '</head>',
    '<body>',
    '<header>',
    '<h1>' + esc(project) + ' 图集门户</h1>',
    '<p><strong>纯生成物，重跑本命令覆盖</strong>：node scripts/build-portal.mjs --atlas <根> --project ' + esc(project) + (opts.source !== undefined ? ' --source ' + esc(opts.source) : '') + ' [--init <YYMMDD>]</p>',
    '<p>门户目录：' + esc(umbrella + '/' + umbrella + '-' + date) + '/ · 伞：' + esc(umbrella) + (entry.sourcePath ? ' · 源仓：' + esc(entry.sourcePath) : '') + ' · 收录：' + total + ' 件交付物 / ' + modules.length + ' 个模块 · 旧期目录保留为历史</p>',
    '</header>',
    '<main>',
    body,
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');

  // 幂等：期目录可已存在（同日期重扫 = 覆盖 index.html；旧期目录不删）。
  const portalDir = path.join(root, umbrella, umbrella + '-' + date);
  fs.mkdirSync(portalDir, { recursive: true });
  fs.writeFileSync(path.join(portalDir, 'index.html'), html);

  // 注册表回写：portals 去重升序；同期重跑集合不变 → JSON 字节稳定（幂等）。
  entry.portals = [...new Set([...(entry.portals || []), date])].sort();
  saveRegistry(root, registry);

  return { portalDir, umbrella, total, modules: modules.length, created };
}

// ---- --root 根可视化索引（§〇.1/§〇-v3.4）：<根>/index.html，两级导航 + 七区地图 + 账本速览 + 页脚 ----

// 七区职责一句话（照 specs/atlas-layout.md §〇.1/§二 措辞精简）。
const ZONE_BLURBS = [
  ['spec', '图谱规格：spec/<项目>/<diagram-id>.json，一图一文件'],
  ['artifacts', '交付物：HTML，两级 项目/模块-日期'],
  ['evidence', '视觉核查回执与快照：evidence/<项目>/<diagram-id>/'],
  ['data', '数据资产：CSV，全行带 文件:行号 或 git <sha> 证据'],
  ['state', '三轴状态侧车：atlas-state.json + 项目注册表 projects.json + 历史账本'],
  ['rulings', '裁定节点：RULINGS.md 引用台账条目，原文在台账'],
  ['history', '快照与时间线：SNAPSHOT-MANIFEST.json + 版本快照'],
];

// 递归统计某区 文件/目录 数（不跟随符号链接——垫片不计）；区缺失 = null（显示「缺失」）。
function zoneCounts(zoneDir) {
  if (!fs.existsSync(zoneDir) || !fs.statSync(zoneDir).isDirectory()) return null;
  const counts = { files: 0, dirs: 0 };
  const stack = [zoneDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (e.isDirectory()) {
        counts.dirs += 1;
        stack.push(path.join(cur, e.name));
      } else if (e.isFile()) {
        counts.files += 1;
      }
    }
  }
  return counts;
}

// 项目实扫计数：规格 = spec/<项目>/ 下 .json 文件数；交付物 = artifacts/<项目>/ 递归 .html 数；
// 证据目录 = evidence/<项目>/ 下一级子目录数。目录缺失按 0 计（容错，不阻断生成）。
function projectCounts(root, project) {
  const counts = { specs: 0, artifacts: 0, evidenceDirs: 0 };
  try {
    counts.specs = fs.readdirSync(path.join(root, 'spec', project))
      .filter((f) => f.endsWith('.json')).length;
  } catch { /* 缺失 = 0 */ }
  try {
    const stack = [path.join(root, 'artifacts', project)];
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        if (e.isDirectory()) stack.push(path.join(cur, e.name));
        else if (e.isFile() && e.name.endsWith('.html')) counts.artifacts += 1;
      }
    }
  } catch { /* 缺失 = 0 */ }
  try {
    counts.evidenceDirs = fs.readdirSync(path.join(root, 'evidence', project), { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
  } catch { /* 缺失 = 0 */ }
  return counts;
}

// 伞下期目录列举（两级导航第二级）：只收 <伞名>-<YYMMDD>/ 且含 index.html 的期，日期倒序（最新在前）。
function listPeriods(root, umbrella) {
  const dir = path.join(root, umbrella);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const periodRe = new RegExp('^' + escapeRegExp(umbrella) + '-(\\d{6})$');
  const periods = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = periodRe.exec(e.name);
    if (m && fs.existsSync(path.join(dir, e.name, 'index.html'))) {
      periods.push({ date: m[1], link: umbrella + '/' + e.name + '/index.html' });
    }
  }
  periods.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return periods;
}

// 根下 v2 平铺门户发现（§〇-v3.5 兼容）：<项目>-add-<YYMMDD> 全量（目录名升序 = 时间序）。
function findV2Portals(root, project) {
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const m = PORTAL_RE.exec(e.name);
    if (m && m[1] === project) out.push({ dir: e.name, date: m[2] });
  }
  return out.sort((a, b) => (a.dir < b.dir ? -1 : 1));
}

function fmtYYMMDD(yymmdd) {
  return '20' + yymmdd.slice(0, 2) + '-' + yymmdd.slice(2, 4) + '-' + yymmdd.slice(4, 6);
}

// 生成时间戳（YYYY-MM-DD HH:mm）。
function nowStamp(now) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function buildRootIndex(opts) {
  const root = path.resolve(opts.atlas);

  // fail-loud：根缺 spec/ 项目一级子目录（v2/v3 版式 spec/<项目>/）即 exit 1，绝不生成空壳可视化索引。
  let specEntries;
  try {
    specEntries = fs.readdirSync(path.join(root, 'spec'), { withFileTypes: true });
  } catch {
    fail('root_spec_missing', '根缺 spec/ 项目一级子目录（v2 版式 spec/<项目>/；atlas 根：' + root + '）');
  }
  const projects = specEntries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (projects.length === 0) {
    fail('root_spec_missing', 'spec/ 下无项目一级子目录（v2 版式 spec/<项目>/；atlas 根：' + root + '）');
  }

  // §〇-v3.3 注册表（只读）：坏 JSON fail-loud（与 --project 同法，不静默降级）。
  const registry = loadRegistry(root);

  // 根下伞目录清单（两级导航第一级）。
  const umbrellaDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && UMBRELLA_RE.test(e.name))
    .map((e) => e.name);

  // a) 项目卡片区：每项目一卡——两级导航（伞 → 各期，倒序、最新标「最新」）+ 实扫计数；
  //    兼容收录根下 v2 平铺门户（最新一期 + 「建议迁移」标注，不报错）。
  const cards = [];
  let totalSpecs = 0;
  let totalArtifacts = 0;
  let totalEvidence = 0;
  let totalPeriods = 0;
  for (const proj of projects) {
    const c = projectCounts(root, proj);
    totalSpecs += c.specs;
    totalArtifacts += c.artifacts;
    totalEvidence += c.evidenceDirs;

    // 该项目的伞：注册表登记优先（带 sourcePath）；未登记的根下伞目录按「去掉 -add 后边界前缀
    // 匹配」归属（注册表已归他人伞的不抢）。
    const claimed = new Set();
    const umbrellas = [];
    for (const e of registry.projects) {
      if (e && e.project === proj && typeof e.umbrella === 'string') {
        umbrellas.push({ name: e.umbrella, source: e.sourcePath || null });
        claimed.add(e.umbrella);
      }
    }
    for (const u of umbrellaDirs) {
      if (claimed.has(u)) continue;
      const stripped = UMBRELLA_RE.exec(u)[1];
      if (stripped === proj || stripped.startsWith(proj + '-')) {
        umbrellas.push({ name: u, source: null });
        claimed.add(u);
      }
    }

    const blocks = [];
    let hasPortal = false;
    for (const u of umbrellas) {
      const periods = listPeriods(root, u.name);
      if (periods.length === 0) {
        blocks.push('<p class="muted">伞 <code>' + esc(u.name) + '/</code>（无期目录：node scripts/build-portal.mjs --atlas &lt;根&gt; --project ' + esc(proj) + '）</p>');
        continue;
      }
      hasPortal = true;
      totalPeriods += periods.length;
      const lis = periods.map((p, i) => '<li><a href="' + esc(p.link) + '">' + esc(p.date) + (i === 0 ? '（最新）' : '') + '</a></li>');
      blocks.push(
        '<div class="umbrella">\n' +
        '<p>伞：<code>' + esc(u.name) + '/</code>' + (u.source ? ' · 源仓：<code>' + esc(u.source) + '</code>' : '') + '</p>\n' +
        '<p>初始化：' + esc(fmtYYMMDD(periods[periods.length - 1].date)) + ' · 最近重扫：' + esc(fmtYYMMDD(periods[0].date)) + ' · 期数 ' + periods.length + '</p>\n' +
        '<ul>\n' + lis.join('\n') + '\n</ul>\n' +
        '</div>'
      );
    }

    // v2 平铺门户（§〇-v3.5 兼容）：照常收录最新一期，标注建议迁移，不报错。
    const v2portals = findV2Portals(root, proj);
    let v2Html = '';
    if (v2portals.length > 0) {
      hasPortal = true;
      const latest = v2portals[v2portals.length - 1];
      v2Html = '<p class="muted">v2 平铺门户（建议迁移）：<a href="' + esc(latest.dir + '/index.html') + '">' + esc(latest.dir) + '</a>（初始化 ' + esc(fmtYYMMDD(v2portals[0].date)) + ' · 最近重扫 ' + esc(fmtYYMMDD(latest.date)) + '）</p>';
    }
    if (!hasPortal) {
      blocks.push('<p class="muted">（无门户：node scripts/build-portal.mjs --atlas &lt;根&gt; --project ' + esc(proj) + '）</p>');
    }

    cards.push(
      '<article class="card">\n' +
      '<h2>' + esc(proj) + '</h2>\n' +
      blocks.join('\n') + '\n' +
      v2Html + '\n' +
      '<p>规格 ' + c.specs + ' · 交付物 ' + c.artifacts + ' · 证据目录 ' + c.evidenceDirs + '</p>\n' +
      '</article>'
    );
  }
  const cardsHtml = cards.join('\n');

  // b) 七区地图：职责一句 + 实时计数（文件/目录）。
  const zoneRows = ZONE_BLURBS.map(([name, blurb]) => {
    const c = zoneCounts(path.join(root, name));
    const count = c === null
      ? '<span class="missing">（缺失）</span>'
      : c.files + ' 文件 · ' + c.dirs + ' 目录';
    return '<tr><td><code>' + name + '/</code></td><td>' + esc(blurb) + '</td><td>' + count + '</td></tr>';
  }).join('\n');

  // c) 账本速览：直读 state/atlas-state.json（存在才读，容错——缺失/不可解析不阻断）。
  const statePath = path.join(root, 'state', 'atlas-state.json');
  let ledgerHtml;
  if (!fs.existsSync(statePath)) {
    ledgerHtml = '<p class="muted">（state/atlas-state.json 未生成，账本速览暂缺）</p>';
  } else {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const listLen = (k) => (Array.isArray(s[k]) ? s[k].length : '—');
      const nodeCount = s.nodes && typeof s.nodes === 'object' ? Object.keys(s.nodes).length : '—';
      ledgerHtml = '<ul>' +
        '<li>节点数：' + nodeCount + '</li>' +
        '<li>revision：' + (Number.isInteger(s.revision) ? s.revision : '—') + '</li>' +
        '<li>trace 条数：' + listLen('trace') + '</li>' +
        '<li>lessons 条数：' + listLen('lessons') + '</li>' +
        '<li>notices 条数：' + listLen('notices') + '</li>' +
        '</ul>';
    } catch {
      ledgerHtml = '<p class="muted">（state/atlas-state.json 存在但不可解析，账本速览暂缺）</p>';
    }
  }

  // d) 页脚：生成时间戳 + 纯生成物声明 + INDEX.md 相对链接。
  const footer = '<p>生成时间：' + nowStamp() + ' · <strong>纯生成物，重跑 build-portal --root 覆盖</strong>；文字正本见 <a href="INDEX.md">INDEX.md</a></p>';

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">', // 明暗自适应一行 CSS
    '<title>数据根可视化索引 ' + esc(path.basename(root)) + '</title>',
    '<style>',
    '  body { font-family: system-ui, sans-serif; max-width: 72em; margin: 2em auto; padding: 0 1em; line-height: 1.6; }',
    '  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(18em, 1fr)); gap: 1em; }',
    '  .card { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px; padding: 0.7em 1em; }',
    '  .card h2 { margin: 0 0 0.3em; font-size: 1.1em; }',
    '  .card p { margin: 0.25em 0; }',
    '  .card ul { margin: 0.25em 0; padding-left: 1.2em; }',
    '  .umbrella { margin: 0.4em 0; }',
    '  table { border-collapse: collapse; width: 100%; }',
    '  th, td { text-align: left; padding: 0.35em 0.6em; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); vertical-align: top; }',
    '  .muted { color: color-mix(in srgb, currentColor 55%, transparent); }',
    '  .missing { color: color-mix(in srgb, currentColor 55%, transparent); font-style: italic; }',
    '  a { text-decoration: none; }',
    '  footer { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); }',
    '</style>',
    '</head>',
    '<body>',
    '<header>',
    '<h1>数据根可视化索引 · ' + esc(path.basename(root)) + '</h1>',
    '<p><strong>纯生成物，重跑本命令覆盖</strong>：node scripts/build-portal.mjs --atlas &lt;根&gt; --root</p>',
    '<p>两级导航：项目伞 → 该伞下各期门户（倒序，最新标「最新」）· 收录：' + projects.length + ' 项目 / ' + totalPeriods + ' 期门户 · 规格 ' + totalSpecs + ' · 交付物 ' + totalArtifacts + ' · 证据目录 ' + totalEvidence + '</p>',
    '</header>',
    '<main>',
    '<section><h2>项目卡片</h2>\n<div class="cards">\n' + cardsHtml + '\n</div></section>',
    '<section><h2>七区地图</h2>\n<table>\n<thead><tr><th>区</th><th>职责</th><th>实时计数</th></tr></thead>\n<tbody>\n' + zoneRows + '\n</tbody>\n</table></section>',
    '<section><h2>账本速览</h2>\n' + ledgerHtml + '</section>',
    '</main>',
    '<footer>',
    footer,
    '</footer>',
    '</body>',
    '</html>',
  ].join('\n');

  // 幂等：直接覆盖 <根>/index.html（重跑即同内容）。
  fs.writeFileSync(path.join(root, 'index.html'), html);

  return { rootIndexPath: path.join(root, 'index.html'), projects: projects.length, periods: totalPeriods };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.atlas) fail('bad_args', '缺少 --atlas <根>');
  if (args.root && args.project) fail('bad_args', '--root 与 --project 互斥（根可视化索引 vs 单项目门户），只给其一');
  if (args.root) {
    if (args.init !== undefined) fail('bad_args', '--init 仅用于 --project 门户，--root 模式不接受');
    if (args.source !== undefined) fail('bad_args', '--source 仅用于 --project 门户（登记源仓路径派生同名异路伞），--root 模式不接受');
    const r = buildRootIndex(args);
    process.stdout.write('根可视化索引：' + r.rootIndexPath + '\n');
    process.stdout.write('项目：' + r.projects + ' / 期门户：' + r.periods + '（两级导航：伞 → 期；纯生成物，重跑 --root 即覆盖；文字正本见 INDEX.md）\n');
    return;
  }
  if (!args.project) fail('bad_args', '缺少 --project <名>');
  if (args.init !== undefined && !/^\d{6}$/.test(args.init)) {
    fail('bad_args', '--init 须为 6 位 YYMMDD（如 260815），收到：' + args.init);
  }
  const r = buildPortal(args);
  process.stdout.write('门户生成：' + r.portalDir + '/index.html\n');
  process.stdout.write('伞：' + r.umbrella + (r.created ? '（新登记）' : '（复用已登记伞）') + ' · 收录：' + r.total + ' 件交付物 / ' + r.modules + ' 个模块（纯生成物，重跑本命令即覆盖；旧期保留为历史）\n');
}

main();
