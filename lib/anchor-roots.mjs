// 锚根白名单 + 存量豁免（O1，2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O1）。
//
// 立法动机（demo-b 实测 43 条前缀错根锚）：锚路径前缀指错仓根，改回正确前缀后文件即存在——现行写边
// 只校验格式（parseLocator）不校验根合法性，错根锚静默入账。本模块给 evidence-add / evidence-reanchor
// 的写边加「锚根 ∈ 白名单」硬校验；存量错根锚走一次性 grandfathered 豁免清单（warning 不 error，
// 不追溯改写），豁免条目带 path + reason + receipt 锚（含落定 commit，豁免本身可审计）。
//
// 白名单来源（缺省 = 侧车所在 atlas 根 ∪ projects.json 全部登记仓 sourcePath；可显式追加）：
//   ① <侧车同目录>/projects.json 各条目 sourcePath；② <侧车同目录>/anchor-roots.json 的 anchorRoots[]；
//   ③ evidence-add/reanchor 的 --allow-root（单次调用生效，不落盘）。
// 激活条件（opt-in，零破坏，与 lib/project-gate.mjs 的 L1/L2 同纪律）：projects.json 或 anchor-roots.json
// 存在且可解析——自由侧车（临时目录/未登记账本）不激活，旧调用零硬 fail。
// 禁入白名单（设计件明载）：dist/、.next/ 段；临时目录（/tmp、os.tmpdir）；机外介质（/media、/mnt、/Volumes）；
// 非绝对路径。命中者不进白名单，随回执 anchorRoot.rejected 披露，绝不静默丢弃。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseLocator, gitSync } from './evidence.mjs';

export const ANCHOR_ROOTS_FILE = 'anchor-roots.json';
export const ANCHOR_EXEMPTIONS_FILE = 'anchor-root-exemptions.json';
export const GRANDFATHER_REASON = 'grandfathered 2026-09-14';
// 豁免回执锚：指向本模块（本 commit 内的实现件）第 1 行 + 落定 commit sha。行号取文件头（最稳），
// 「本 commit」语义由 receipt.commit 承载（branch 合并后 commit 对象不变，锚不失效）。
const EXEMPTIONS_RECEIPT_LOCATOR = 'lib/anchor-roots.mjs:1';

const BUILD_SEGMENTS = ['dist', '.next'];
const EXTERNAL_PREFIXES = ['/media/', '/mnt/', '/Volumes/'];

// 单条根路径的准入判定：null = 可入白名单；否则返回拒绝理由（机器可读码）。
// 例外两处（明载，非静默放宽）：
//  ① source='atlas-root'（侧车自己所在的 atlas 根）永不过滤——否则 /tmp 或 /media 上的 atlas
//     会得到一纸空白名单，连「锚在自家账本目录内」都被拒（自败式门禁）；
//  ② source='cli'（--allow-root）是**单次调用的显式人工决定**，不是白名单的持久条目——只拒
//     非绝对/过宽/dist·.next 段；/tmp 与 /media 由调用者当场自负。设计件的「禁入白名单」
//     针对持久来源（atlas 根、registry sourcePath、anchor-roots.json），三处照旧全过滤。
export function classifyRoot(root, { source = 'registry' } = {}) {
  const raw = String(root == null ? '' : root).trim();
  if (raw === '') return 'empty';
  if (!path.isAbsolute(raw)) return 'relative';
  const norm = path.normalize(raw);
  if (norm === path.parse(norm).root) return 'root-too-broad';
  const segs = norm.split(path.sep).filter(Boolean);
  if (segs.some((s) => BUILD_SEGMENTS.includes(s))) return 'build-output';
  if (source === 'atlas-root' || source === 'cli') return null;
  const tmp = path.normalize(os.tmpdir());
  if (norm === tmp || norm.startsWith(tmp + path.sep) || norm === '/tmp' || norm.startsWith('/tmp/')) return 'ephemeral-tmp';
  if (EXTERNAL_PREFIXES.some((p) => norm.startsWith(p))) return 'external-media';
  return null;
}

function under(root, file) {
  const r = path.normalize(root);
  const f = path.normalize(file);
  return f === r || f.startsWith(r + path.sep);
}

// 白名单判定用真实路径：根内符号链接指向根外文件时，normalize 看到的是根内路径，realpath 才是实相。
// 根与目标两侧都取 realpath（根经符号链接到达同样合法，复审 2026-09-18）；目标不存在（写边不校验存在）时
// 按最近存在的祖先解析实相再接回余段，不可解析时退回 normalize 结果。
function realFileOf(file) {
  const norm = path.normalize(file);
  let base = norm;
  const rest = [];
  while (true) {
    try { return rest.length ? path.join(fs.realpathSync(base), ...rest) : fs.realpathSync(base); } catch { /* 上溯 */ }
    const parent = path.dirname(base);
    if (parent === base) return norm;
    rest.unshift(path.basename(base));
    base = parent;
  }
}

function underAnyRoot(roots, file) {
  const real = realFileOf(file);
  return roots.some((r) => under(r.real, real));
}

// atlas 根派生：<atlas>/state/<侧车>.json → <atlas>；侧车直接放 atlas 根 → 其所在目录。
export function atlasRootOf(sidecarPath) {
  const dir = path.dirname(path.resolve(sidecarPath));
  return path.basename(dir) === 'state' ? path.dirname(dir) : dir;
}

// 配置读取（2026-09-15，防误边界）：不存在 = opt-in 未启用（零破坏）；已存在但不可读/非 JSON = fail-loud
// （坏配置不得静默降级为 inactive——那等于一键解除已声明的锚根门禁）。
function configInvalid(file, detail) {
  const err = new Error('锚根门禁配置已存在但不可用：' + detail + '（文件 ' + file + '）——坏配置不解除门禁；修复或移走该文件后重试');
  err.code = 'anchor_roots_config_invalid';
  err.path = file;
  return err;
}

function readConfig(file, what) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { present: false, value: null };
    throw configInvalid(file, what + '不可读：' + e.message);
  }
  try {
    return { present: true, value: JSON.parse(raw) };
  } catch (e) {
    throw configInvalid(file, what + '不是合法 JSON：' + e.message);
  }
}

// 解析白名单上下文。active=false 时调用方不得拦截任何写（opt-in 纪律）；配置坏 = 抛错（fail-loud）。
export function loadAnchorRootContext(sidecarPath, { allowRoots = [] } = {}) {
  const abs = path.resolve(sidecarPath);
  const dir = path.dirname(abs);
  const atlasRoot = atlasRootOf(abs);
  const registryPath = path.join(dir, 'projects.json');
  const configPath = path.join(dir, ANCHOR_ROOTS_FILE);
  const registryRead = readConfig(registryPath, 'projects.json');
  let registryOk = false;
  if (registryRead.present) {
    const registry = registryRead.value;
    if (!registry || typeof registry !== 'object' || Array.isArray(registry) || !Array.isArray(registry.projects)) {
      throw configInvalid(registryPath, 'projects.json 缺少 projects 数组（形状坏）');
    }
    registryOk = true;
  }
  const registry = registryRead.value;
  const configRead = readConfig(configPath, ANCHOR_ROOTS_FILE);
  let configured = null;
  if (configRead.present) {
    const config = configRead.value;
    if (config && Array.isArray(config.anchorRoots)) configured = config.anchorRoots;
    else if (config && Array.isArray(config.roots)) configured = config.roots;
    else throw configInvalid(configPath, ANCHOR_ROOTS_FILE + ' 缺少 anchorRoots[] / roots[] 数组（形状坏）');
  }
  const active = registryOk || configured !== null;

  const candidates = [{ root: atlasRoot, source: 'atlas-root' }];
  if (registryOk) {
    for (const p of registry.projects) {
      if (p && typeof p.sourcePath === 'string' && p.sourcePath) candidates.push({ root: p.sourcePath, source: 'registry' });
    }
  }
  if (configured) for (const r of configured) candidates.push({ root: r, source: 'config' });
  // --allow-root：单次调用生效的显式根；相对路径按调用方 cwd 解析（与 locator 同口径），不落盘。
  for (const r of [].concat(allowRoots || [])) {
    const raw = String(r == null ? '' : r).trim();
    if (raw === '') continue;
    candidates.push({ root: path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw), source: 'cli' });
  }

  const roots = [];
  const rejected = [];
  const seen = new Set();
  for (const c of candidates) {
    const reason = classifyRoot(c.root, { source: c.source });
    const norm = typeof c.root === 'string' && path.isAbsolute(c.root) ? path.normalize(c.root) : null;
    if (reason) { rejected.push({ root: String(c.root), source: c.source, reason }); continue; }
    if (seen.has(norm)) continue;
    seen.add(norm);
    roots.push({ root: norm, real: realFileOf(norm), source: c.source });
  }
  return { active, sidecarPath: abs, dir, atlasRoot, registryPath: registryOk ? registryPath : null, configPath: configured !== null ? configPath : null, roots, rejected };
}

// 读豁免清单：不存在 = 空表（零破坏）；已存在但坏 = fail-loud（清单坏会让存量豁免静默消失 →
// 存量锚被突然拒写，必须显式报因而不是让用户面对一纸 anchor_root_denied）。
export function loadAnchorExemptions(sidecarPath) {
  const file = path.join(path.dirname(path.resolve(sidecarPath)), ANCHOR_EXEMPTIONS_FILE);
  const read = readConfig(file, ANCHOR_EXEMPTIONS_FILE);
  if (!read.present) return { path: file, exists: false, entries: [] };
  const parsed = read.value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.entries)) {
    throw configInvalid(file, ANCHOR_EXEMPTIONS_FILE + ' 缺少 entries 数组（形状坏）');
  }
  const entries = parsed.entries.filter((e) => e && typeof e.path === 'string');
  return { path: file, exists: true, entries };
}

function engineCommit() {
  try {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const r = gitSync(['-C', repoRoot, 'rev-parse', 'HEAD']);
    const sha = String(r.stdout || '').trim();
    return r.status === 0 && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

// 存量过渡（首跑）：把侧车中「已在账但不在白名单」的绝对锚一次性登记为 grandfathered 豁免。
// 首跑必落盘（含 0 条的空清单）：清单是「本账的存量快照」——若首跑不写文件，后来经 --allow-root
// 落锚的存量就会被误归入 grandfathered（冒领存量身份），故文件存在性即「快照已取」标志。
// 已存在清单 = 幂等不覆盖（审计件，不静默重写）。
export function ensureGrandfatheredExemptions(sidecarPath, sidecar, context) {
  const out = { path: path.join(path.dirname(path.resolve(sidecarPath)), ANCHOR_EXEMPTIONS_FILE), existed: false, created: false, entries: [], unresolvable: 0, skipped: null };
  if (!context.active) { out.skipped = 'gate-inactive'; return out; }
  const loaded = loadAnchorExemptions(sidecarPath);
  out.existed = loaded.exists;
  if (loaded.exists) { out.entries = loaded.entries; return out; }

  const seen = new Set();
  const found = [];
  for (const node of Object.values((sidecar && sidecar.nodes) || {})) {
    if (!node) continue;
    for (const locator of node.evidence || []) {
      const parsed = parseLocator(locator);
      if (!parsed.ok) { out.unresolvable += 1; continue; }
      // 相对锚（存量读方按 --root 解析）落不到确定路径，不入豁免（写方新锚一律绝对化）。
      if (!path.isAbsolute(parsed.file)) { out.unresolvable += 1; continue; }
      const file = path.normalize(parsed.file);
      if (underAnyRoot(context.roots, file)) continue;
      if (seen.has(file)) continue;
      seen.add(file);
      found.push(file);
    }
  }
  const at = new Date().toISOString();
  const receipt = { locator: EXEMPTIONS_RECEIPT_LOCATOR, commit: engineCommit(), at };
  const doc = {
    schemaVersion: 1,
    generatedAt: at,
    reason: GRANDFATHER_REASON,
    receipt,
    note: '一次性存量豁免（O1，2026-09-14）：清单内锚写边放行但发 warning，不追溯改写；清理路径 = 逐个 evidence-reanchor 回白名单内后从本清单删除条目',
    entries: found.map((file) => ({ path: file, reason: GRANDFATHER_REASON, receipt })),
    rejectedRoots: context.rejected,
  };
  fs.mkdirSync(path.dirname(out.path), { recursive: true });
  fs.writeFileSync(out.path, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  out.created = true;
  out.entries = doc.entries;
  return out;
}

// 写边判据：白名单命中 → ok；豁免清单命中 → ok+exempted；否则拒（error）。
export function anchorRootVerdict(locator, context, exemptions, { cwd = process.cwd() } = {}) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return { ok: false, reason: 'bad_locator', diagnostic: parsed.diagnostic };
  if (!context.active) return { ok: true, matched: null, exempted: false, source: null, gate: 'inactive' };
  const file = path.isAbsolute(parsed.file) ? path.normalize(parsed.file) : path.resolve(cwd, parsed.file);
  const real = realFileOf(file);
  const hit = context.roots.find((r) => under(r.real, real));
  if (hit) return { ok: true, matched: hit.root, exempted: false, source: hit.source, gate: 'active' };
  const exempt = (exemptions || []).find((e) => path.normalize(e.path) === file);
  if (exempt) return { ok: true, matched: null, exempted: true, source: 'exemption', gate: 'active', exemption: { path: exempt.path, reason: exempt.reason } };
  return { ok: false, reason: 'outside-whitelist', file, gate: 'active' };
}
