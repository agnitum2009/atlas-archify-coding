// 锚定位符（locator）lint 内核（command-contract.md §5 移除注记）：文件:行号 格式 + 存在性 + 行界校验。
// 顶层 evidence lint 命令已于 v0.10.0 移除；本模块由 state evidence-add/remove/reanchor（写方）与 report（读方）继续使用。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 全角冒号不做自动归一：Linux 文件名可合法包含全角冒号（如 'a：b.md'），归一会破坏该类合法 locator；
// 仅在解析失败且字符串含全角冒号时附加可行动提示，让用户自行改用半角分隔符（实战反馈档（2026-08-15））。
export function locatorFormatMessage(locator) {
  const base = 'locator 必须形如 文件:行号';
  if (!String(locator).includes('：')) return base;
  return base + "——检测到全角冒号'：'；分隔符须用半角冒号':'，形如 文件:行号";
}

export function parseLocator(locator) {
  const m = /^([^:]+):(\d+)$/.exec(String(locator).trim());
  if (!m) {
    return { ok: false, diagnostic: diag('bad_locator', locatorFormatMessage(locator), locator) };
  }
  return { ok: true, file: m[1], line: Number(m[2]) };
}

// 批二（2026-08-15）：写入形态绝对化——evidence-add 落账前把相对 locator 解析为绝对路径
// （path.resolve against cwd），已是绝对的原样；格式校验与行界 lint 逻辑不变（parseLocator 同正则）。
// 根治 cwd 漂移（DEFENSIVE.md §5 的类杀）：新锚落账即绝对，读方（report / doctor）不再因 cwd
// 不同而解析出不同结果；旧相对锚仍被读方按 --root 解析（兼容读，见契约 §5）。
export function absoluteLocator(locator, cwd) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return parsed;
  const base = path.isAbsolute(parsed.file) ? parsed.file : path.resolve(cwd, parsed.file);
  return { ok: true, locator: base + ':' + parsed.line };
}

export function lintLocator(locator, root) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return parsed;
  const full = path.resolve(root, parsed.file);
  if (!fs.existsSync(full)) {
    return { ok: false, diagnostic: diag('file_missing', '文件不存在：' + full, locator) };
  }
  let content;
  try {
    content = fs.readFileSync(full, 'utf8');
  } catch (e) {
    return { ok: false, diagnostic: diag('file_unreadable', '文件不可读：' + e.message, locator) };
  }
  const totalLines = content.split('\n').length;
  if (parsed.line < 1 || parsed.line > totalLines) {
    return { ok: false, diagnostic: diag('line_out_of_bounds', '行号越界：' + parsed.line + '（文件共 ' + totalLines + ' 行）', locator) };
  }
  return { ok: true, file: parsed.file, line: parsed.line, full };
}

export function lintLocators(locators, root) {
  const report = { valid: 0, invalid: 0, diagnostics: [], results: [] };
  for (const locator of locators) {
    const result = lintLocator(locator, root);
    report.results.push({ locator, ok: result.ok });
    if (result.ok) {
      report.valid += 1;
    } else {
      report.invalid += 1;
      report.diagnostics.push(result.diagnostic);
    }
  }
  return report;
}

function diag(rule, message, subject) {
  return { rule, severity: 'error', subject, evidence: message, supportedFixes: [] };
}

// ---------- 锚行哈希三态（缺口② 语义绑定增强，2026-08-16；先例=pi-readseek 的 LINE:HASH 模式） ----------
// evidenceMeta（节点可选增量字段，snapshot-policy §5.2 登记）：键=锚字符串，值={ h:<目标行 trim 后内容
// sha256 前 12 hex>, at:<ISO> }。evidence 数组保持纯字符串不动（既有消费者零影响）；旧侧车无此字段照常（D2 容忍立场）。

export const LINE_HASH_HEX = 12;

export function lineHash(text) {
  return crypto.createHash('sha256').update(String(text).trim(), 'utf8').digest('hex').slice(0, LINE_HASH_HEX);
}

// 读目标行算哈希；文件缺/不可读/行越界返回 null——写入边（evidence-add）不因读取失败阻断落锚：
// 锚已过格式校验，哈希缺失即 unhashed（读方三态按 unhashed 容忍，不误报 drifted）。
export function computeLocatorHash(locator, root) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return null;
  let content;
  try {
    content = fs.readFileSync(path.resolve(root || '.', parsed.file), 'utf8');
  } catch {
    return null;
  }
  const lines = content.split('\n');
  if (parsed.line < 1 || parsed.line > lines.length) return null;
  return lineHash(lines[parsed.line - 1]);
}

// 三态判定（契约 §5）：broken=文件缺/行越界（与 lintLocator 同语义）；drifted=文件行都在但内容哈希不匹配；
// ok=哈希匹配；unhashed=锚无哈希（存量锚，不算 drifted——漂移判定只对有哈希锚成立）。
export function anchorState(locator, meta, root) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return 'broken';
  let content;
  try {
    content = fs.readFileSync(path.resolve(root || '.', parsed.file), 'utf8');
  } catch {
    return 'broken';
  }
  const lines = content.split('\n');
  if (parsed.line < 1 || parsed.line > lines.length) return 'broken';
  const expected = meta && typeof meta.h === 'string' && meta.h ? meta.h : null;
  if (!expected) return 'unhashed';
  return lineHash(lines[parsed.line - 1]) === expected ? 'ok' : 'drifted';
}

// ---------- 锚质量 warning（0.8.0，holdout 遗留缺陷2：lint 只验存在+行界，不验「这行有内容」） ----------
// 两类 warning 级判定，绝不升 error（存量账宽容，不拒任何昨天接受的输入）；只属读方（doctor
// evidence-resolvability），evidence-add 写入边不拦截——「lint 属读方」既有语义不变（契约 §5 写明理由）。
// 返回值 = warning 诊断对象数组（可能为空）；解析失败/文件缺失/行越界一律返回 []（那些属 broken 侧语义，不在此重复发声）。
export function anchorQuality(locator, root) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return [];
  let buf;
  try {
    buf = fs.readFileSync(path.resolve(root || '.', parsed.file));
  } catch {
    return [];
  }
  // 疑似二进制：读前 8KB 含 NUL 字节即判（文本文件不会出现 NUL）。二进制无「行内容」语义，命中即返，跳过空行判定。
  if (buf.subarray(0, 8192).includes(0)) {
    return [{ rule: 'anchor-binary', severity: 'warning', subject: locator, evidence: '锚目标疑似二进制文件（前 8KB 含 NUL 字节）：' + parsed.file + '——二进制无证据行语义，建议改锚到可读证据行', supportedFixes: [] }];
  }
  const lines = buf.toString('utf8').split('\n');
  if (parsed.line >= 1 && parsed.line <= lines.length && lines[parsed.line - 1].trim() === '') {
    // 0.12.0（实战反馈档-2026-08-23 P3-9）：附最近非空行建议，处置一步到位（落既有
    // supportedFixes 信封字段，不新增 schema 键——交叉验证 reviewer-B 席确认此法优于报告原文的新 "suggest" 字段）。
    let nearest = null;
    for (let d = 1; d < lines.length; d += 1) {
      const up = parsed.line - d;
      const down = parsed.line + d;
      if (up >= 1 && lines[up - 1].trim() !== '') { nearest = up; break; }
      if (down <= lines.length && lines[down - 1].trim() !== '') { nearest = down; break; }
    }
    const fixes = nearest === null ? [] : ['建议改锚到最近内容行 ' + parsed.file + ':' + nearest + '（state evidence-reanchor --from ' + locator + ' --to ' + parsed.file + ':' + nearest + '）'];
    return [{ rule: 'anchor-empty-line', severity: 'warning', subject: locator, evidence: '锚目标行 trim 后为空（' + parsed.file + ':' + parsed.line + '）——空行无证据语义（:360 漂移教训），建议改锚到实际内容行', supportedFixes: fixes }];
  }
  return [];
}

