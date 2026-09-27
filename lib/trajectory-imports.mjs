// import 解析（0.29.0）：只认 HEAD——内容读 HEAD 版本、路径对照 HEAD 文件清单；只输出能落到仓内文件/目录的边（M 级）。
// 第三方包、Go 外部包、跨仓引用不产生关系也不计 unresolved；解析不到的仓内引用不猜，计 unresolved 披露。
// 本模块只含语言知识，不含任何 harness 知识。
import path from 'node:path';
import { gitSync } from './evidence.mjs';

// 与 trajectory.mjs 的 fail 同形（不从 trajectory.mjs 导入：避免与其形成循环依赖）。
const fail = (code, message) => Object.assign(new Error(message), { code });

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const TS_OF = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const PARSED = new Set([...JS_EXTS, '.go']);
const NOT_APPLICABLE = new Set(['.md', '.mdx', '.txt', '.rst', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.env',
  '.csv', '.tsv', '.sql', '.lock', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf']);

export const extLabel = (file) => path.extname(file).toLowerCase() || '(无扩展名)';
export function importKind(file) {
  const e = path.extname(file).toLowerCase();
  if (!e || NOT_APPLICABLE.has(e)) return 'notApplicable';
  return PARSED.has(e) ? 'parsed' : 'unparsed';
}

// 一次 git cat-file --batch 批读 HEAD 内容（按字节长度切分，路径含空格/中文安全）。
// 含换行的路径不送（请求按行分隔，会让其后应答串位）；应答头严格匹配「<oid> <type> <size>」，其余（missing/ambiguous）视为无内容。
export function readHeadFiles(repo, rels) {
  const out = new Map();
  const ask = rels.filter((r) => !r.includes('\n'));
  if (ask.length === 0) return out;
  const res = gitSync(['-C', repo, 'cat-file', '--batch'], { input: Buffer.from(ask.map((r) => 'HEAD:' + r).join('\n') + '\n'), encoding: 'buffer', maxBuffer: 1 << 30 });
  if (res.error || res.status !== 0) throw fail('project_source_not_git', 'git cat-file 读取 HEAD 失败：' + repo + '（' + (res.error ? res.error.code || res.error.message : String(res.stderr || '').trim().split('\n')[0]) + '）');
  const buf = res.stdout;
  let pos = 0;
  for (const rel of ask) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const m = /^[0-9a-f]{40,64} (\w+) (\d+)$/.exec(buf.toString('utf8', pos, nl));
    pos = nl + 1;
    if (!m) continue; // "<obj> missing" / "ambiguous"：无内容段
    const size = Number(m[2]);
    if (m[1] === 'blob') out.set(rel, buf.toString('utf8', pos, pos + size));
    pos += size + 1;
  }
  return out;
}

export function repoIndex(repo) {
  const empty = { repo, files: new Set(), packages: new Map(), pkgJson: new Map(), goModules: new Map(), goDirs: new Set() };
  const res = gitSync(['-C', repo, 'ls-tree', '-r', '-z', '--name-only', 'HEAD'], { maxBuffer: 1 << 28 });
  if (res.error) throw fail('project_source_not_git', 'git ls-tree 失败/超时：' + repo + '（' + (res.error.code || res.error.message) + '）');
  if (res.status !== 0) {
    if (gitSync(['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD']).status !== 0) return empty; // 空仓
    throw fail('project_source_not_git', 'git ls-tree 失败：' + repo + '（' + String(res.stderr || '').trim().split('\n')[0] + '）');
  }
  const rels = res.stdout.split('\0').filter(Boolean);
  const files = new Set(rels.map((r) => path.join(repo, r)));
  const pj = rels.filter((r) => path.posix.basename(r) === 'package.json' && !r.split('/').includes('node_modules')).sort();
  const gm = rels.filter((r) => path.posix.basename(r) === 'go.mod' && !r.split('/').includes('vendor')).sort();
  const texts = readHeadFiles(repo, [...pj, ...gm]);
  const packages = new Map();
  const pkgJson = new Map();
  for (const r of pj) {
    let j;
    try { j = JSON.parse(texts.get(r)); } catch { continue; }
    if (!j || typeof j !== 'object' || typeof j.name !== 'string' || !j.name) continue;
    const dir = path.join(repo, path.posix.dirname(r));
    if (!packages.has(j.name)) packages.set(j.name, dir); // 同名包：路径字典序首个为准
    pkgJson.set(dir, j);
  }
  const goModules = new Map();
  for (const r of gm) {
    const m = /^\s*module\s+"?([^\s"]+)"?/m.exec(texts.get(r) || '');
    if (m) goModules.set(path.join(repo, path.posix.dirname(r)), m[1]);
  }
  const goDirs = new Set([...files].filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).map((f) => path.dirname(f)));
  return { repo, files, packages, pkgJson, goModules, goDirs };
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const JS_SPEC_RES = [
  /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
// require() / import() 不锚行首：匹配点之前同一行若有未闭合的引号，则位于字符串字面量内（示例代码、测试夹具），不算引用。
function inString(code, idx) {
  const prefix = code.slice(code.lastIndexOf('\n', idx - 1) + 1, idx).replace(/\\./g, '');
  return ['\'', '"', '`'].some((q) => prefix.split(q).length % 2 === 0);
}
const jsSpecs = (code) => JS_SPEC_RES.flatMap((re, i) => [...code.matchAll(re)].filter((m) => i < 2 || !inString(code, m.index)).map((m) => m[1]));

// 相对/包内路径补全：原样 → 追加 JS/TS 扩展 → 目录 index.* → TS ESM 约定（./a.js → a.ts）。首个在 HEAD 清单者为准。
function fileOf(base, files) {
  const ext = path.extname(base);
  const cands = [base, ...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => path.join(base, 'index' + e)),
    ...(TS_OF[ext] || []).map((t) => base.slice(0, -ext.length) + t)];
  return cands.find((c) => files.has(c)) || null;
}

// 返回：命中文件（string）｜ null = 外部/跨仓，忽略 ｜ false = 仓内引用解析失败。
// 规格先去 ?query / #hash（0.29.1）；# 开头的是 Node imports 字段写法（package.json 内映射），不解析。
function resolveJs(file, rawSpec, index, inRepo) {
  if (rawSpec.startsWith('#')) return null;
  const spec = rawSpec.replace(/[?#].*$/, '');
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const base = path.resolve(path.dirname(file), spec);
    const inside = path.relative(index.repo, base);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !inRepo(base)) return null; // 出仓 / 跨仓：不计 unresolved
    return fileOf(base, index.files) || false;
  }
  // 包名引用：仓内 package.json 的 name → 包目录；无子路径取入口 exports(字符串)/module/main，解析不到回退 src/index.*、index.*。
  if (spec.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return null; // 绝对路径 / node: / URL
  const parts = spec.split('/');
  const n = spec.startsWith('@') ? 2 : 1;
  const dir = index.packages.get(parts.slice(0, n).join('/'));
  if (!dir) return null; // 第三方包
  const sub = parts.slice(n).join('/');
  if (sub) return fileOf(path.join(dir, sub), index.files) || fileOf(path.join(dir, 'src', sub), index.files) || false;
  const pj = index.pkgJson.get(dir) || {};
  const ex = typeof pj.exports === 'string' ? pj.exports : (pj.exports && typeof pj.exports['.'] === 'string' ? pj.exports['.'] : null);
  for (const entry of [ex, pj.module, pj.main]) {
    const hit = typeof entry === 'string' && entry ? fileOf(path.resolve(dir, entry), index.files) : null;
    if (hit) return hit;
  }
  return fileOf(path.join(dir, 'src', 'index'), index.files) || fileOf(path.join(dir, 'index'), index.files) || false;
}

// Go 的 import 只能出现在首个顶层声明之前：截掉其后部分，原始字符串里的 import 模板（代码生成、测试夹具）不算。
function goSpecs(src) {
  const cut = src.search(/^(?:func|type|var|const)\b/m);
  const code = cut < 0 ? src : src.slice(0, cut);
  const out = [];
  for (const m of code.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) out.push(m[1]);
  for (const b of code.matchAll(/^\s*import\s*\(([^)]*)\)/gm)) for (const l of b[1].matchAll(/^\s*(?:[\w.]+\s+)?"([^"]+)"/gm)) out.push(l[1]);
  return out;
}

// Go import 是包级（目录）：取文件向上最近的 go.mod，只处理 module 前缀内的路径；目录须有非 _test.go 的 .go 文件。
function resolveGo(file, spec, index) {
  let d = path.dirname(file);
  while (!index.goModules.has(d)) {
    if (d === index.repo || path.dirname(d) === d) return null; // 无 go.mod：全部视为外部
    d = path.dirname(d);
  }
  const mod = index.goModules.get(d);
  if (spec !== mod && !spec.startsWith(mod + '/')) return null; // 外部包
  const dir = path.join(d, spec.slice(mod.length));
  return index.goDirs.has(dir) ? dir : false;
}

export function importsOf(file, src, index, inRepo = () => true) {
  const code = stripComments(src);
  const go = file.endsWith('.go');
  const deps = [];
  const unresolved = [];
  const hit = new Set(); // 按解析后的目标去重：同一文件以不同写法（'./a.mjs' 与 './a'）引用同一目标只算 1 条文件级边
  for (const spec of new Set(go ? goSpecs(code) : jsSpecs(code))) {
    const r = go ? resolveGo(file, spec, index) : resolveJs(file, spec, index, inRepo);
    if (r === null) continue;
    if (r === false) { unresolved.push(spec); continue; }
    if (hit.has(r)) continue;
    hit.add(r);
    deps.push(go ? { dir: r } : { file: r });
  }
  return { deps, unresolved };
}
