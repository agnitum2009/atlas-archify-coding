// 布局校验器（specs/atlas-layout.md）：v3 门户伞目录版式（§〇-v3，2026-08-16 负责人令）为主，
// v2 多项目版式（§〇）为存量兼容，v1 平铺版式已废弃（0.9.0 塌缩，两段式废弃第一阶段）。
// 识别：spec/ 下有一级子目录 = v2/v3 模式；v1 平铺（spec/ 直接放 <diagram-id>.json）= 只发一条
// 迁移 warning 并直接返回——数据根已 v3、init 自 0.7.0 起直接生成 v3，完整 v1 校验链无数据可服务
//（Lehman 法则2 复杂度做功 / Sculley 死分支处方）；v1 详细校验已于 0.9.0 停止。
// v3 增量：根下伞目录 ^(.+)-add$（伞内只允许 <伞名>-<YYMMDD>/ 期目录），v2 平铺门户降 warning 迁移提示（结构校验照跑）。
// 纪律：违规 = error（P4/P6 按规范原文 = warning）；
// 机器不可判定的规则逐条列入 unchecked 具名披露，绝不静默跳过。诊断形状照抄 command-contract.md 信封 diagnostics。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// §二 七区制（init 强制生成的七个分区）。
export const ZONES = ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history'];

// §二/§三.3 evidence/<diagram-id>/ 只存视觉核查回执与快照（v2 下为 evidence/<项目>/<diagram-id>/）。
const EVIDENCE_EXTS = new Set(['.png', '.json', '.html']);

// §〇-v2.1 门户目录名 <项目>-add-<YYMMDD>（贪婪捕获：项目名自身可含连字符，最后一段 -add-<6位日期> 生效）。
// v3 起为存量兼容版式（warning 提示迁入伞目录，结构校验照跑）。
const PORTAL_RE = /^(.+)-add-(\d{6})$/;
// §〇-v3.1 伞目录名 <伞名>（贪婪捕获：伞名自身可含连字符，最后一段 -add 生效；如 demo-add、add-mirror-add）。
const UMBRELLA_RE = /^(.+)-add$/;
// §〇-v3.5：v2 平铺门户识别时的迁移提示。
const V2_PORTAL_WARNING = 'v2 平铺门户已过时，建议迁入伞目录（见 atlas-layout v3）';
// §〇-v2.1 artifacts 两级 = 项目 / 模块-初始化时间：模块目录名 <模块>-<YYMMDD>（如 loops-260815）。
const MODULE_DATE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*-\d{6}$/;
// §〇.3（0.9.0 塌缩）：v1 平铺废弃标记——检测到只发本条 warning 并直接返回，不再跑 v1 校验链。
// 0.10.1：文案去掉「v0.10.0 起不再校验」的未来式承诺——运行期字符串里写未来版本号必然腐烂（Status rots 同病），
// 只陈述已发生的事实（0.9.0 已停校验）。
const V1_DEPRECATED_WARNING = 'v1 平铺版式已废弃，请迁移至 v3（见 atlas-layout §〇-v3）；其详细布局校验已于 v0.9.0 停止，本目录不再做布局检查';

// 机器不可判定的规范条目（具名披露；判定需历史对比、内容语义或渲染测量）。
export const UNCHECKED = [
  '§三.1 diagram-id 跨时间稳定性（「一图一个稳定 id」的稳定性需历史对比，静态不可判）',
  '§三.4 裁定原文只在台账（rulings/ 内容是否仅为引用行属语义判断，静态不可判）',
  '§六-R1 完整默认视图（交付 HTML 默认首屏必须呈现完整图，需渲染/四视口测量）',
  '§六-R2 焦点章节（meta.views 首章「当前焦点（在途 n）」的存在与正确性，属 spec/HTML 内容校验）',
  '§六-R3 焦点标记（in_progress 节点 tag 直标完整图，属渲染产物内容校验）',
  '§五 迁移说明（init --migrate 流程性约定，非静态布局规则）',
  '§〇-v2.2.3 门户纯生成（门户目录由 build-portal 生成/覆盖、禁手改——需工具/历史比对，静态不可判）',
  '§〇.1 根 index.html 可视化索引纯生成（build-portal --root 生成/覆盖、禁手改——需工具/历史比对，静态不可判）',
  '§〇-v2.1 根 INDEX.md 项目注册表字段（项目/门户目录/初始化时间/重扫时间/图数/侧车指针）完整性与正确性需语义判断，静态不可全判',
  '§〇-v3.2 伞目录与源路径映射正确性（伞名 <项目>-<路径简写>-add 的 slug 是否忠实指代源仓路径，需外部真相，静态不可判）',
];

function diag(rule, severity, subject, evidence, supportedFixes) {
  return { rule, severity, subject, evidence, supportedFixes: supportedFixes || [] };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// §〇-v3.3 机器可读项目注册表 <根>/state/projects.json（build-portal 读写，形状
// {schemaVersion:1, projects:[{project, umbrella, sourcePath|null, firstSeen, portals:[YYMMDD...]}]}）。
// 校验器只读：缺失 = 空注册表（回退项目名匹配）；存在但不可解析/形状不符 = corrupt
// （warning + 回退；坏 JSON 的 fail-loud 属 build-portal 写侧纪律，见 §〇-v3.3）。
function readProjectsRegistry(root) {
  const p = path.join(root, 'state', 'projects.json');
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return { entries: [] };
  }
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && Array.isArray(data.projects)) return { entries: data.projects };
  } catch { /* corrupt → 下方统一降级 */ }
  return { entries: [], corrupt: true };
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push({ path: p, name: e.name, isDir: e.isDirectory(), isSymlink: e.isSymbolicLink() });
    if (e.isDirectory()) walk(p, out);
  }
  return out;
}

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}

// P5 证据双形态（2026-08-15 负责人裁定①，specs/atlas-layout.md §二）：
//   文件:行号 = 细粒度位置声称；git <sha>（7-40 位十六进制）= 提交级事实声称（内容寻址不可变，抗行号漂移）。
const GIT_SHA_RE = /^git ([0-9a-fA-F]{7,40})$/;

// SHA 存在性二层校验的 git 根解析：图谱目录自身是 git 仓则用之（.git 目录或 worktree 文件均算），
// 否则环境变量 ATLAS_GIT_ROOT；均无 → null（此时不逐条报噪音，改 unchecked 具名披露）。
function resolveGitRoot(root) {
  try {
    const st = fs.statSync(path.join(root, '.git'));
    if (st.isFile() || st.isDirectory()) return root;
  } catch { /* 图谱目录自身非 git 仓 */ }
  const env = process.env.ATLAS_GIT_ROOT;
  return env && env.trim() !== '' ? path.resolve(env) : null;
}

// 单条 SHA 是否为仓内 commit：git cat-file -e <sha>^{commit}（spawnSync 调系统 git，零运行时依赖纪律内）。
// missing 与环境失败分离：git 缺对象与坏环境同走 exit 128，按 stderr 区分——环境失败绝不伪报「SHA 不在仓」。
function shaIsCommit(gitRoot, sha) {
  const res = spawnSync('git', ['cat-file', '-e', sha + '^{commit}'], { cwd: gitRoot });
  if (res.error) return { fail: res.error.message };
  if (res.status === 0) return { ok: true };
  const stderr = String(res.stderr || '');
  if (/not a valid object name/i.test(stderr)) return { missing: true };
  return { fail: 'git exit ' + res.status + (stderr ? '：' + stderr.split('\n')[0].trim() : '') };
}

export function validateLayout(rootDir, opts) {
  const root = path.resolve(rootDir);
  // P6 需侧车（doctor --atlas 与 --sidecar 联动）；显式给了才验，不给不报噪音。
  const sidecarPath = opts && opts.sidecarPath ? path.resolve(opts.sidecarPath) : null;
  const d = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    d.push(diag('layout.root', 'error', root, 'atlas 目录不存在或不是目录', []));
    return { root, diagnostics: d, unchecked: UNCHECKED };
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const hasDir = (name) => entries.some((e) => e.name === name && e.isDirectory());
  // 目录名可为顶层分区或嵌套相对路径（v2：spec/<项目>/ 等）；不存在 = 空列表。
  const listDir = (name) => {
    try {
      return fs.readdirSync(path.join(root, name), { withFileTypes: true });
    } catch {
      return [];
    }
  };

  // 版式识别前置（0.9.0 塌缩，§〇.3 / 契约 §10）：spec/ 下无一级子目录 = v1 平铺，已废弃——
  // 只发一条迁移 warning 并直接返回（不再跑整条校验链；保持 warning 级、exit 0 语义，不制造破坏性变更）。
  const specEntries = listDir('spec');
  if (!specEntries.some((e) => e.isDirectory())) {
    d.push(diag('layout.legacy', 'warning', 'spec/', V1_DEPRECATED_WARNING, ['迁移至 v3 版式（atlas-engine init 直接生成：七区 + 项目一级子目录），见 specs/atlas-layout.md §〇-v3']));
    return { root, diagnostics: d, unchecked: UNCHECKED };
  }
  const projects = specEntries.filter((e) => e.isDirectory()).map((e) => e.name);

  // §二 七区目录齐全。
  for (const zone of ZONES) {
    if (!hasDir(zone)) {
      d.push(diag('layout.zones', 'error', zone + '/', '七区制目录缺失：' + zone + '/', ['创建分区目录 ' + zone + '/']));
    }
  }

  // §二 INDEX.md（唯一入口）必须存在。
  const indexEntry = entries.find((e) => e.name === 'INDEX.md' && e.isFile());
  if (!indexEntry) {
    d.push(diag('layout.index', 'error', 'INDEX.md', '缺总索引 INDEX.md（六层注册表 + 图清单唯一入口；v2 = 项目注册表）', ['atlas-engine init 生成或补建 INDEX.md']));
  }

  // P1 禁平铺：根目录只允许 INDEX.md + 七区目录（v2 另允许 v2 平铺门户目录；v3 另允许伞目录
  // <伞名>/——伞内只允许期目录，见下；隐藏点文件降级 warning；符号链接垫片不计平铺违规——过渡措施）。
  // §〇-v3.3 注册表：伞名→项目段对齐优先用注册表；缺失/损坏/未登记回退项目名匹配。
  const registry = readProjectsRegistry(root);
  if (registry.corrupt) {
    d.push(diag('layout.registry', 'warning', 'state/projects.json', '项目注册表不可解析（build-portal 写侧对坏 JSON fail-loud；校验器此处回退伞名首段/边界前缀匹配）', ['人工处置后重跑，或经 build-portal --project 重新登记（绝不静默重建）']));
  }
  const registryByUmbrella = new Map();
  for (const entry of registry.entries) {
    if (entry && typeof entry.umbrella === 'string' && typeof entry.project === 'string') {
      registryByUmbrella.set(entry.umbrella, entry.project);
    }
  }
  for (const e of entries) {
    if (e.isFile() && e.name === 'INDEX.md') continue;
    if (e.isFile() && e.name === 'index.html') continue; // §〇.1 根可视化索引（build-portal --root 纯生成物）
    if (e.isDirectory() && ZONES.includes(e.name)) continue;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory() && PORTAL_RE.test(e.name)) {
      // §〇-v2.1 v2 平铺门户（§〇-v3.5 存量宽容）：结构校验照跑（error），另出一条 v3 迁移 warning。
      const proj = PORTAL_RE.exec(e.name)[1];
      if (!projects.includes(proj)) {
        d.push(diag('layout.portal', 'error', e.name, '门户目录项目名不在 spec/ 一级子目录项目集合中（命名 <项目>-add-<YYMMDD>）', ['核对项目名，或补 spec/<项目>/ 注册该项目']));
      }
      if (!fs.existsSync(path.join(root, e.name, 'index.html'))) {
        d.push(diag('layout.portal', 'error', e.name + '/index.html', '门户目录缺生成式 index.html（纯生成物，由 build-portal 生成）', ['运行 node scripts/build-portal.mjs --atlas <根> --project <项目>']));
      }
      d.push(diag('layout.portal-v2', 'warning', e.name, V2_PORTAL_WARNING, ['迁入伞目录：重跑 build-portal --project 即按 v3 两级版式 <伞名>/<伞名>-<YYMMDD>/ 生成新期，见 specs/atlas-layout.md §〇-v3']));
      continue;
    }
    if (e.isDirectory() && UMBRELLA_RE.test(e.name)) {
      // §〇-v3.1 伞目录：伞名项目段对齐（注册表优先，回退首段/边界前缀匹配）+ 伞内期目录校验。
      const umbrella = e.name;
      const stripped = UMBRELLA_RE.exec(umbrella)[1];
      const regProject = registryByUmbrella.get(umbrella);
      if (regProject !== undefined) {
        if (!projects.includes(regProject)) {
          d.push(diag('layout.portal', 'error', umbrella + '/', '注册表登记的伞项目 ' + regProject + ' 不在 spec/ 一级子目录集合中（state/projects.json 对齐）', ['补 spec/' + regProject + '/ 注册该项目，或修正 state/projects.json']));
        }
      } else {
        const fallback = projects.find((p) => stripped === p) || projects.find((p) => stripped.startsWith(p + '-'));
        if (!fallback) {
          d.push(diag('layout.portal', 'error', umbrella + '/', '伞名项目段不在 spec/ 一级子目录项目集合中（伞名 <项目>-add / 同名异路 <项目>-<路径简写>-add；注册表未登记该伞，回退首段/边界前缀匹配）', ['核对伞名，或补 spec/<项目>/ 注册该项目，或经 build-portal --project [--source] 重新登记']));
        }
      }
      const periodRe = new RegExp('^' + escapeRegExp(umbrella) + '-(\\d{6})$');
      for (const c of listDir(umbrella)) {
        if (c.isSymbolicLink()) continue; // 符号链接垫片一律跳过（§〇-v2.3/§〇-v3.5 过渡措施）
        const subject = umbrella + '/' + c.name;
        if (c.isDirectory() && periodRe.test(c.name)) {
          if (!fs.existsSync(path.join(root, umbrella, c.name, 'index.html'))) {
            d.push(diag('layout.portal', 'error', subject + '/index.html', '期目录缺生成式 index.html（纯生成物，由 build-portal 生成）', ['运行 node scripts/build-portal.mjs --atlas <根> --project <项目> [--init ' + periodRe.exec(c.name)[1] + ']']));
          }
          continue;
        }
        if (c.isDirectory() && /^(.+)-(\d{6})$/.test(c.name)) {
          d.push(diag('layout.portal', 'error', subject + '/', '期目录名前缀与伞名不符（须为 <伞名>-<YYMMDD>，伞名前缀强制一致）', ['按 ' + umbrella + '-<YYMMDD> 重命名']));
        } else {
          d.push(diag('layout.portal', 'error', subject, '伞内只允许 <伞名>-<YYMMDD>/ 期目录（v3 两级门户版式，见 §〇-v3.1）', ['移入对应期目录或删除']));
        }
      }
      continue;
    }
    const severity = e.name.startsWith('.') ? 'warning' : 'error';
    d.push(diag('P1', severity, e.name, '根目录只允许 INDEX.md + 七区目录 + v2 平铺门户目录 + v3 伞目录（<伞名>/）+ 生成式 index.html（根可视化索引，build-portal --root 产物），出现其他条目（禁平铺）', ['移入对应分区或删除']));
  }

  // §〇.1 根可视化索引（build-portal --root 纯生成物）：缺失 = warning——文字正本 INDEX.md 仍为 error 级。
  if (!entries.some((e) => e.name === 'index.html' && e.isFile())) {
    d.push(diag('layout.root-index', 'warning', 'index.html', '根缺生成式可视化索引 index.html（build-portal --root 产物；文字正本 INDEX.md 仍为 error 级要求）', ['运行 node scripts/build-portal.mjs --atlas <根> --root']));
  }

  const all = walk(root, []);

  // P3 禁双份：.vN 后缀 / 「副本」文件（版本一律走 git 历史）。
  // 2026-08-15 语义对齐：①符号链接垫片一律跳过——垫片是过渡物，与 P1/P2 的
  // 「symlink 不计平铺违规」同一原则，P3 此前漏了这条；②.vN 版本化规格名为 warning——
  // 版本化图规格是登记在册的合法演进产物（早期图集实测「版本靠 .v2 后缀」），
  // 真双份靠 P4 注册对账与人工审查兜底；「副本」文件仍 error。
  for (const f of all) {
    if (f.isDir || f.isSymlink) continue;
    if (/\.v\d+\.[^.]+$/.test(f.name)) {
      d.push(diag('P3', 'warning', rel(root, f.path), '禁 .vN 后缀/副本双份：同一 diagram-id 永不并存两份（版本走 git 历史；v2 下 .vN = warning：版本化图规格是登记在册的合法演进产物，真双份靠 P4 注册对账与人工审查兜底）', ['删除副本，差异并入 git 历史']));
    } else if (f.name.includes('副本')) {
      d.push(diag('P3', 'error', rel(root, f.path), '禁 .vN 后缀/副本双份：同一 diagram-id 永不并存两份（版本走 git 历史）', ['删除副本，差异并入 git 历史']));
    }
  }

  // §三.3 证据归位 + §三.4 数据资产只进 data/（v2/v3：门户目录专供人类访问 html/png，
  // 伞目录与 v2 平铺门户同属门户区，其内快照豁免归位检查）。
  // 2026-08-15 语义对齐（v1 接受语义）：error 级取消。visual-check 件与其所属图的主 .html 同处一个
  // 模块目录 = 接受不报——画廊语义（门户需要就近链接），v1 时代 artifacts/ 平铺即此摆位、一直接受；
  // evidence/ 区正本仍是权威回执位。孤儿 visual-check（同目录无对应主 .html）= warning；
  // 普通 PNG 快照（无 visual-check 名）未归位 evidence/ = warning（v1 平铺时代根散快照即被接受）。
  for (const f of all) {
    if (f.isDir) continue;
    const r = rel(root, f.path);
    const ext = path.extname(f.name).toLowerCase();
    const firstSeg = r.split('/')[0];
    const inPortal = PORTAL_RE.test(firstSeg) || UMBRELLA_RE.test(firstSeg);
    if (!r.startsWith('evidence/') && !inPortal && (ext === '.png' || f.name.includes('visual-check'))) {
      if (f.name.includes('visual-check')) {
        const base = f.name.split('.visual-check')[0];
        const mainNearby = fs.readdirSync(path.dirname(f.path)).includes(base + '.html');
        if (!mainNearby) {
          d.push(diag('layout.evidence-placement', 'warning', r, '孤儿 visual-check：同目录无对应主 ' + base + '.html（evidence/<项目>/<diagram-id>/ 才是权威回执位；门户画廊需就近链接）', ['移至 evidence/<项目>/<diagram-id>/，或与主 .html 同目录摆放']));
        }
      } else {
        d.push(diag('layout.evidence-placement', 'warning', r, 'PNG 快照未进 evidence/<项目>/<diagram-id>/（回执/快照应归位 evidence 区；v1 接受语义下不再阻断，warning 提示）', ['移至 evidence/<项目>/<diagram-id>/']));
      }
    }
    if (ext === '.csv' && !r.startsWith('data/')) {
      d.push(diag('layout.data-placement', 'error', r, '数据资产（CSV）只进 data/', ['移至 data/']));
    }
  }

  // P2 禁混放 + §三.1 一元化（v2/v3 唯一存活路径——v1 平铺已在前置识别处只发一条 warning 直接返回，
  // 0.9.0 塌缩）：spec/evidence/data 一级=项目名隔离，artifacts 两级=项目/模块-日期，一元化按项目内同名。
  // spec/<项目>/ 只允许 <diagram-id>.json；spec/ 顶层只允许项目子目录（散文件 = 平铺泄漏）。
  const specIdsByProject = new Map();
  for (const proj of projects) {
    const ids = new Set();
    for (const e of listDir('spec/' + proj)) {
      if (e.isSymbolicLink()) continue; // 旧路径符号链接垫片（§〇-v2.3 过渡措施）
      if (e.isDirectory() || path.extname(e.name).toLowerCase() !== '.json') {
        d.push(diag('P2', 'error', 'spec/' + proj + '/' + e.name, 'spec/<项目>/ 只允许 <diagram-id>.json 一图一文件', ['移出非 spec 文件']));
      } else {
        ids.add(e.name.slice(0, -'.json'.length));
        // 0.10.0（holdout #2 P2c）：spec JSON 可解析性——「图谱目录自检」须验 spec 可解析，坏 JSON
        // 不应活到 compile 才炸（实测 spec/<项目>/bad.json 内容「{bad json」时 doctor 零诊断）。
        // error 级 layout.spec-unparsable，消息带文件与解析错误首行；只验可解析性，schema 校验属 archify validate/compile。
        try {
          JSON.parse(fs.readFileSync(path.join(root, 'spec', proj, e.name), 'utf8'));
        } catch (err) {
          d.push(diag('layout.spec-unparsable', 'error', 'spec/' + proj + '/' + e.name, 'spec JSON 不可解析：' + String(err && err.message).split('\n')[0], ['修正 JSON 语法后重跑（doctor 只验可解析性；schema 校验属 archify validate / compile）']));
        }
      }
    }
    specIdsByProject.set(proj, ids);
  }
  for (const e of specEntries) {
    if (e.isDirectory() || e.isSymbolicLink()) continue;
    d.push(diag('P2', 'error', 'spec/' + e.name, 'spec/ 一级子目录 = 项目名隔离（v2），根下禁散文件', ['移入 spec/<项目>/']));
  }
  // artifacts/ 两级 = 项目 / 模块-日期；模块目录名 <模块>-<YYMMDD> 正则校验。
  for (const e of listDir('artifacts')) {
    if (e.isSymbolicLink()) continue;
    if (!e.isDirectory()) {
      d.push(diag('P2', 'error', 'artifacts/' + e.name, 'artifacts/ 一级子目录 = 项目名（v2 两级：项目/模块-日期）', ['移入 artifacts/<项目>/']));
      continue;
    }
    if (!projects.includes(e.name)) {
      d.push(diag('layout.naming', 'error', 'artifacts/' + e.name + '/', '交付物项目目录无同名 spec 项目（v2 一元化：spec/<项目>/ 必须存在）', ['补 spec/<项目>/ 或移除孤儿交付物目录']));
      continue;
    }
    for (const f of listDir('artifacts/' + e.name)) {
      if (f.isSymbolicLink()) continue;
      if (!f.isDirectory()) {
        d.push(diag('P2', 'error', 'artifacts/' + e.name + '/' + f.name, 'artifacts/<项目>/ 只允许 <模块>-<YYMMDD> 子目录', ['移入模块-日期子目录']));
        continue;
      }
      if (!MODULE_DATE_RE.test(f.name)) {
        d.push(diag('layout.naming', 'error', 'artifacts/' + e.name + '/' + f.name, '模块目录名须为 <模块>-<YYMMDD>（6 位日期，如 loops-260815）', ['按 <模块>-<YYMMDD> 重命名']));
      }
    }
  }
  // evidence/ 两级 = 项目 / diagram-id；只存回执与快照；证据子目录须有同项目同名 spec。
  for (const e of listDir('evidence')) {
    if (e.isSymbolicLink()) continue;
    if (!e.isDirectory()) {
      d.push(diag('P2', 'error', 'evidence/' + e.name, 'evidence/ 一级子目录 = 项目名隔离（v2），根下禁散文件', ['移入 evidence/<项目>/<diagram-id>/']));
      continue;
    }
    for (const g of listDir('evidence/' + e.name)) {
      if (!g.isDirectory()) {
        d.push(diag('P2', 'error', 'evidence/' + e.name + '/' + g.name, 'evidence/<项目>/ 只按图建子目录 <diagram-id>/，禁散文件', ['移入 evidence/<项目>/<diagram-id>/']));
        continue;
      }
      for (const f of walk(path.join(root, 'evidence', e.name, g.name), [])) {
        if (f.isDir || !EVIDENCE_EXTS.has(path.extname(f.name).toLowerCase())) {
          d.push(diag('P2', 'error', rel(root, f.path), 'evidence/<项目>/<diagram-id>/ 只允许回执与快照（' + [...EVIDENCE_EXTS].join('/') + '）', ['移出非回执/快照文件']));
        }
      }
      const projSpecs = specIdsByProject.get(e.name);
      if (projSpecs && !projSpecs.has(g.name)) {
        // 2026-08-15 语义对齐：存量史实目录 v1 时代已接受（如 evidence/demo-trade-spine/ ↔ spec id
        // demo-trade-spine.workflow），史实目录不强改——error 降 warning，消息附建议改名。
        const candidates = [...projSpecs].filter((s) => s.startsWith(g.name) || g.name.startsWith(s));
        d.push(diag('layout.naming', 'warning', 'evidence/' + e.name + '/' + g.name + '/', '证据子目录名与 spec id 不同名（v2 一元化：spec/<项目>/<diagram-id>.json；史实目录不强改）' + (candidates.length ? '；建议改名 evidence/' + e.name + '/' + g.name + '/ → ' + candidates.join(' 或 ') : ''), ['建议按 spec id 改名对齐，或补 spec/<项目>/<diagram-id>.json']));
      }
    }
  }

  // P4 禁无索引：INDEX 未注册 = warning（按规范原文严重度；v2 以项目为注册单位）。
  if (indexEntry) {
    const indexText = fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8');
    for (const proj of projects) {
      if (!indexText.includes(proj)) {
        d.push(diag('P4', 'warning', proj, 'INDEX.md 未注册该项目（v2：根 INDEX.md = 项目注册表：项目/门户目录/初始化时间/重扫时间/图数/侧车指针）', ['在 INDEX.md 项目注册表登记 ' + proj]));
      }
    }
  }

  // P5 禁无证据的数据资产：data/ 下 CSV 缺证据列 = error；行证据为空 = error；
  // 证据双形态（2026-08-15 裁定①）：文件:行号 或 git <sha>，两种格式合法即 compliant（不再对 SHA 报
  // 政策性 warning）；SHA 另做二层存在性机器校验——有 git 根逐条 git cat-file -e，不在仓 = error
  // p5-sha-broken；无根不逐条报噪音，unchecked 具名披露一条；git 调用失败（环境问题）同样具名披露，绝不伪报。
  // data/ 一级子目录 = 项目名隔离（v2），CSV 在 data/<项目>/ 下。
  const csvFiles = [];
  for (const e of listDir('data')) {
    if (e.isSymbolicLink()) continue;
    if (!e.isDirectory()) {
      d.push(diag('P2', 'error', 'data/' + e.name, 'data/ 一级子目录 = 项目名隔离（v2），根下禁散文件', ['移入 data/<项目>/']));
      continue;
    }
    for (const f of listDir('data/' + e.name)) {
      if (f.isFile() && f.name.endsWith('.csv')) csvFiles.push(path.join(root, 'data', e.name, f.name));
    }
  }
  const shaRows = [];
  for (const csvPath of csvFiles) {
    const csvRel = rel(root, csvPath);
    const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
    const evCol = header.findIndex((c) => c.includes('evidence') || c.includes('证据'));
    if (evCol === -1) {
      d.push(diag('P5', 'error', csvRel, '数据资产缺证据列（表头无 evidence/证据 列）', ['表头补证据列，全行带 文件:行号 或 git <sha> 证据']));
      continue;
    }
    for (let i = 1; i < lines.length; i += 1) {
      const cell = (lines[i].split(',')[evCol] || '').trim();
      const at = csvRel + ':' + (i + 1);
      const gitSha = GIT_SHA_RE.exec(cell);
      if (cell === '') {
        d.push(diag('P5', 'error', at, '数据行证据为空（禁无证据的数据资产）', ['补 文件:行号 或 git <sha> 证据']));
      } else if (gitSha) {
        shaRows.push({ at, sha: gitSha[1] }); // 格式合法即 compliant；存在性留给二层校验统一判
      } else if (!/:\d+/.test(cell)) {
        d.push(diag('P5', 'warning', at, '证据非双形态（文件:行号 / git <sha>）定位符：' + cell, []));
      }
    }
  }
  const extraUnchecked = [];
  if (shaRows.length > 0) {
    const gitRoot = resolveGitRoot(root);
    if (!gitRoot) {
      extraUnchecked.push('SHA 存在性未验：无可用 git 根（图谱目录非 git 仓且未设 ATLAS_GIT_ROOT）');
    } else {
      for (const row of shaRows) {
        const verdict = shaIsCommit(gitRoot, row.sha);
        if (verdict.ok) continue;
        if (verdict.missing) {
          d.push(diag('p5-sha-broken', 'error', row.at, 'git SHA 不在仓中（' + row.sha + '，根：' + gitRoot + '）——提交级事实声称失效', ['核对 SHA，或设 ATLAS_GIT_ROOT 指向含该提交的 git 仓']));
        } else {
          extraUnchecked.push('SHA 存在性未验：git 调用失败（' + verdict.fail + '）');
          break; // 环境级失败逐条同因，披露一条即可
        }
      }
    }
  }

  // P6 v2 节点前缀纪律（§〇-v2.2.2 账本隔离）：节点 id 须以已知项目名前缀开头（项目名集合取自
  // spec/ 一级子目录名）；需 --sidecar 联动；diagram-* 元节点与 kind=meta 豁免。warning 级（规范原文）。
  if (projects.length > 0 && sidecarPath) {
    let sidecarData = null;
    try {
      sidecarData = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    } catch {
      extraUnchecked.push('P6 未验：侧车不可读（' + sidecarPath + '）');
    }
    if (sidecarData) {
      const offending = [];
      for (const [id, node] of Object.entries(sidecarData.nodes || {})) {
        if (!node) continue;
        if (node.kind === 'meta' || id.startsWith('diagram-')) continue;
        if (!projects.some((p) => id === p || id.startsWith(p + '-'))) offending.push(id);
      }
      // 0.10.0（holdout #2 P1）：聚合式封顶——最多逐条列前 5 个节点 id，其余以计数汇总为一条
      // （与 doctor 侧 emptyLine/binary 的采样封顶风格一致）；此前逐条打印，306 个无前缀节点 = 306 条相同 warning 洪峰。
      const P6_SAMPLE = 5;
      const p6Fix = '节点 id 加所属项目名前缀（如 ' + projects[0] + '-<id>），或建 spec/<项目>/ 注册该项目';
      for (const id of offending.slice(0, P6_SAMPLE)) {
        d.push(diag('P6', 'warning', id, '节点 id 不以任何已知项目名前缀开头（v2 账本隔离纪律：节点 id 项目前缀 + owner 字段）', [p6Fix]));
      }
      if (offending.length > P6_SAMPLE) {
        d.push(diag('P6', 'warning', '（其余同类汇总）', '另有 ' + (offending.length - P6_SAMPLE) + ' 个节点同类（id 无前缀），共 ' + offending.length + ' 个；前 ' + P6_SAMPLE + ' 个已逐条列出', [p6Fix]));
      }
    }
  }

  return { root, diagnostics: d, unchecked: UNCHECKED.concat(extraUnchecked) };
}
