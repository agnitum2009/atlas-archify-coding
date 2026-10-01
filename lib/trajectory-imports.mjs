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

const jsId = c => !!c && (/[$\p{ID_Continue}\u200c\u200d]/u.test(c) || /[\ud800-\udfff]/.test(c));
const REGEX_PREFIX = new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'yield', 'await', 'new', 'else', 'do']);
const CONTROL_PAREN = new Set(['if', 'while', 'for', 'with', 'switch', 'catch']);
const OBJECT_PREFIX = new Set(['=', '(', '[', ',', 'return', 'yield']);

// TSX 类型参数箭头与 JSX 标签分别扫描，复用调用方的引号与表达式词法状态。
function genericArrow(src, start, quoted) {
  let i = start + 1, depth = 1;
  for (; i < src.length && depth; i += 1) {
    if (src[i] === '<') depth += 1;
    else if (src[i] === '>') depth -= 1;
    else if (src[i] === '"' || src[i] === "'") i = quoted(i) - 1;
  }
  if (depth || !/[,=]|\bextends\b/.test(src.slice(start, i))) return false;
  while (/\s/.test(src[i] || '') && i < src.length) i += 1;
  if (src[i] !== '(') return false;
  depth = 1;
  for (i += 1; i < src.length && depth; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') depth -= 1;
    else if (src[i] === '"' || src[i] === "'") i = quoted(i) - 1;
  }
  while (/\s/.test(src[i] || '') && i < src.length) i += 1;
  if (depth) return false;
  if (src.startsWith('=>', i)) return true;
  if (src[i] !== ':') return false;
  depth = 0;
  for (i += 1; i < src.length; i += 1) {
    if (!depth && src.startsWith('=>', i)) return true;
    if (src.startsWith('</', i) || (!depth && src[i] === ';')) return false;
    if (src[i] === '"' || src[i] === "'") i = quoted(i) - 1;
    else if ('([{<'.includes(src[i])) depth += 1;
    else if (')]}>'.includes(src[i])) depth -= 1;
  }
  return false;
}

function markup(src, start, mask, quoted, code) {
  const tag = /^<([A-Za-z_$][\w$:.-]*|)(?=[\s/>])/.exec(src.slice(start));
  if (!tag) return -1;
  let i = start + tag[0].length, segment = start;
  for (; i < src.length; i += 1) {
    if (src[i] === '"' || src[i] === "'") i = quoted(i) - 1;
    else if (src[i] === '{') {
      mask.fill(2, segment, i + 1);
      i = code(i + 1, true);
      segment = i;
    } else if (src[i] === '>') {
      mask.fill(2, segment, i + 1);
      if (src[i - 1] === '/') return i + 1;
      i += 1;
      break;
    }
  }
  segment = i;
  while (i < src.length) {
    if (src.startsWith('</', i)) {
      const close = /^<\/([\w$:.-]*)\s*>/.exec(src.slice(i));
      if (!close || close[1] !== tag[1]) break;
      mask.fill(2, segment, i + close[0].length);
      return i + close[0].length;
    }
    if (src[i] === '{' || (src[i] === '<' && /^<[A-Za-z_$>]/.test(src.slice(i)))) {
      mask.fill(2, segment, i + (src[i] === '{' ? 1 : 0));
      const expression = src[i] === '{';
      const end = expression ? code(i + 1, true) : markup(src, i, mask, quoted, code);
      if (end < 0) return -1;
      i = expression ? end : end - 1;
      segment = i;
    }
    i += 1;
  }
  mask.fill(2, segment);
  return -1;
}

// UTF-16 坐标与 matchAll 一致。1=注释，2=非代码正文，4=非模块顶层的 import/export；
// 模板/JSX 的表达式递归回代码，正文绝不作为依赖事实。
function jsContext(src, jsx, tsx) {
  const mask = new Uint8Array(src.length);
  let valid = true;
  const quoted = start => {
    let i = start + 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '\\') { i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 2 : 1; continue; }
      if (src[i] === src[start]) return i + 1;
      if (src[i] === '\r' || src[i] === '\n') break;
    }
    valid = false;
    return src.length;
  };
  const template = start => {
    let i = start + 1, segment = start;
    for (; i < src.length; i += 1) {
      if (src[i] === '\\') { i += 1; continue; }
      if (src[i] === '`') { mask.fill(2, segment, i + 1); return i + 1; }
      if (src.startsWith('${', i)) {
        mask.fill(2, segment, i + 2);
        i = code(i + 2, true);
        segment = i;
      }
    }
    mask.fill(2, segment);
    valid = false;
    return src.length;
  };
  const code = (start, expression = false) => {
    const braces = [], parens = [];
    let i = start, regex = true, previous = '';
    while (i < src.length) {
      const c = src[i], next = src[i + 1];
      if (/\s/.test(c)) { i += 1; continue; }
      if (c === '/' && (next === '/' || next === '*')) {
        let end = i + 2;
        if (next === '/') { while (end < src.length && !/[\r\n\u2028\u2029]/.test(src[end])) end += 1; }
        else {
          end = src.indexOf('*/', end);
          if (end === -1) { valid = false; end = src.length; } else end += 2;
        }
        mask.fill(1, i, end); i = end; continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        const end = c === '`' ? template(i) : quoted(i);
        if (c !== '`') mask.fill(2, i, end);
        i = end; regex = false; previous = 'literal'; continue;
      }
      if (c === '/' && regex === null) { valid = false; return src.length; }
      if (c === '/' && regex) {
        const begin = i;
        let bracket = false, closed = false;
        for (i += 1; i < src.length; i += 1) {
          if (src[i] === '\\') { i += 1; continue; }
          if (/[\r\n\u2028\u2029]/.test(src[i])) break;
          if (src[i] === '[') bracket = true;
          else if (src[i] === ']') bracket = false;
          else if (src[i] === '/' && !bracket) { i += 1; closed = true; break; }
        }
        if (!closed) { valid = false; i = src.length; }
        while (jsId(src[i])) i += 1;
        mask.fill(2, begin, i); regex = false; previous = 'literal'; continue;
      }
      if (jsx && c === '<' && regex && /^<[A-Za-z_$>]/.test(src.slice(i)) && !(tsx && genericArrow(src, i, quoted))) {
        const end = markup(src, i, mask, quoted, code);
        if (end < 0) { valid = false; return src.length; }
        i = end; regex = false; previous = 'literal'; continue;
      }
      if (jsId(c)) {
        const begin = i;
        while (jsId(src[i])) i += 1;
        const word = src.slice(begin, i);
        if ((word === 'import' || word === 'export') && (expression || braces.length || parens.length)) mask[begin] = 4;
        regex = REGEX_PREFIX.has(word);
        previous = word === 'await' && previous === 'for' ? 'for' : word;
        continue;
      }
      if (c === '}' && expression && !braces.length) return i;
      if ((c === '+' && next === '+') || (c === '-' && next === '-')) {
        i += 2; regex = false; previous = c + next; continue;
      }
      if (c === '(') { parens.push(CONTROL_PAREN.has(previous)); regex = true; }
      else if (c === ')') regex = parens.pop() || false;
      else if (c === '{') { braces.push(previous === ':' ? null : !OBJECT_PREFIX.has(previous)); regex = true; }
      else if (c === '}') regex = braces.pop() ?? null;
      else if (c === '=' && next === '>') { i += 1; previous = '=>'; regex = true; }
      else regex = !['.', ']'].includes(c);
      if (previous !== '=>' || c !== '=') previous = c;
      i += 1;
    }
    if (expression || braces.length || parens.length) valid = false;
    return i;
  };
  let start = 0;
  if (src.startsWith('#!')) {
    const end = src.indexOf('\n');
    start = end < 0 ? src.length : end;
    mask.fill(1, 0, start);
  }
  code(start);
  return { mask, valid, quoted };
}

function jsString(raw) {
  const escapes = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' };
  return raw.replace(/\\(?:\r\n|[\r\n\u2028\u2029]|x[\da-f]{2}|u\{[\da-f]+\}|u[\da-f]{4}|[\s\S])/gi, (m, offset) => {
    const e = m.slice(1);
    if (/^[\r\n\u2028\u2029]/.test(e)) return '';
    if (e === 'x' || e === 'u' || /^[1-9]$/.test(e) || (e === '0' && /\d/.test(raw[offset + m.length] || ''))) throw new Error('不确定的字符串转义');
    if (e.startsWith('x')) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e.startsWith('u')) return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    return Object.hasOwn(escapes, e) ? escapes[e] : e;
  });
}

function jsSpecs(src, file) {
  const ext = extLabel(file);
  const context = jsContext(src, !['.ts', '.mts', '.cts'].includes(ext), ext === '.tsx');
  if (!context.valid) return { specs: [], unparsed: true };
  const { mask, quoted } = context;
  const token = start => {
    let i = start;
    while (i < src.length && (/\s/.test(src[i]) || mask[i] === 1)) i += 1;
    if (src[i] === "'" || src[i] === '"') {
      const end = quoted(i);
      return { type: 'string', value: jsString(src.slice(i + 1, end - 1)), end };
    }
    if (jsId(src[i]) && !(mask[i] & 2)) {
      const begin = i;
      while (jsId(src[i])) i += 1;
      return { type: 'word', value: src.slice(begin, i), end: i };
    }
    return { type: 'punct', value: src[i] || '', end: i + 1 };
  };
  // 保持既有输出顺序：from 声明、裸 import、require、import()；目标文件仍在 importsOf 去重。
  const groups = [[], [], [], []];
  try {
    for (const m of src.matchAll(/\b(import|export|require)\b/g)) {
      if ((mask[m.index] & 3) || jsId(src[m.index - 1]) || jsId(src[m.index + m[0].length])) continue;
      let prev = m.index - 1;
      while (prev >= 0 && (/\s/.test(src[prev]) || mask[prev] === 1)) prev -= 1;
      if (src[prev] === '.') {
        let end = prev - 1;
        while (end >= 0 && (/\s/.test(src[end]) || mask[end] === 1)) end -= 1;
        let start = end;
        while (jsId(src[start])) start -= 1;
        const qualifier = src.slice(start + 1, end + 1);
        while (start >= 0 && (/\s/.test(src[start]) || mask[start] === 1)) start -= 1;
        if (m[1] !== 'require' || qualifier !== 'module' || src[start] === '.') continue;
      }
      let t = token(m.index + m[0].length);
      if (m[1] === 'require' || (m[1] === 'import' && t.value === '(')) {
        if (t.value !== '(') continue;
        const spec = token(t.end), close = token(spec.end);
        if (spec.type === 'string' && (close.value === ')' || (m[1] === 'import' && close.value === ','))) groups[m[1] === 'require' ? 2 : 3].push(spec.value);
        continue;
      }
      if (mask[m.index] & 4) continue;
      if (m[1] === 'import' && t.type === 'string') { groups[1].push(t.value); continue; }
      if (m[1] === 'export') {
        if (t.value === 'type') t = token(t.end);
        if (t.value !== '{' && t.value !== '*') continue;
      }
      let depth = 0;
      for (;;) {
        if (!t.value || t.value === ';' || t.value === '=' || t.value === '(' || (t.type === 'string' && !depth)) break;
        if (t.value === '{') depth += 1;
        else if (t.value === '}') { if (!depth) break; depth -= 1; }
        else if (t.value === 'from' && !depth) {
          const spec = token(t.end);
          if (spec.type === 'string') groups[0].push(spec.value);
          break;
        } else if (t.type === 'punct' && ![',', '*'].includes(t.value)) break;
        t = token(t.end);
      }
    }
  } catch { return { specs: [], unparsed: true }; }
  return { specs: groups.flat(), unparsed: false };
}

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
  const go = file.endsWith('.go');
  const parsed = go ? { specs: goSpecs(stripComments(src)), unparsed: false } : jsSpecs(src, file);
  if (parsed.unparsed) return { deps: [], unresolved: [], unparsed: true };
  const deps = [];
  const unresolved = [];
  const hit = new Set(); // 按解析后的目标去重：同一文件以不同写法（'./a.mjs' 与 './a'）引用同一目标只算 1 条文件级边
  for (const spec of new Set(parsed.specs)) {
    const r = go ? resolveGo(file, spec, index) : resolveJs(file, spec, index, inRepo);
    if (r === null) continue;
    if (r === false) { unresolved.push(spec); continue; }
    if (hit.has(r)) continue;
    hit.add(r);
    deps.push(go ? { dir: r } : { file: r });
  }
  return { deps, unresolved };
}
