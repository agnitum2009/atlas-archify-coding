// 锚定位符（locator）lint 内核（command-contract.md §5 移除注记）：文件:行号 格式 + 存在性 + 行界校验。
// 顶层 evidence lint 命令已于 v0.10.0 移除；本模块由 state evidence-add/remove/reanchor（写方）与 report（读方）继续使用。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
    // 逐条目随带自身诊断（report 的完成声称守卫要按锚定位到因由；旧调用方只看 ok/valid/invalid，纯增字段）。
    report.results.push(result.ok ? { locator, ok: true } : { locator, ok: false, diagnostic: result.diagnostic });
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

// ---------- 锚对 HEAD 校验（O2，2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O2） ----------
// 立法动机（demo-b alt 事故）：锚在工作树有、HEAD 无（未提交的新文件被当证据落锚）——图账宣称对齐实相，
// 实相（HEAD）里根本没有。原校验链（lintLocator/anchorState）只看工作树 fs.existsSync + 读文件，
// 不看 git HEAD。本段以 `git show HEAD:<rel>` 取目标行内容与工作树同位置比对（锚所在仓取自己的 HEAD）。
//
// 台账状态（state）：
//   ok                    工作树行内容 == HEAD 行内容
//   content-mismatch      行在界但内容不同（工作树≠HEAD）→ error a3-head-mismatch
//   line-out-of-bounds    HEAD 版文件行数少于锚行号 → error a3-head-mismatch
//   uncommitted           文件不在 HEAD（未提交/未跟踪且未被 ignore）→ error a1-evidence-uncommitted
//   gitignored            文件被 .gitignore 排除（如 atlas artifacts/ 生成物——永不可能入 HEAD）
//                         → 只入回执 evidenceHead.gitignored 计数，不发 error（错误类会有永久假红）
//   no-git               锚不在任何 git 仓内 → 记 noGit，不发声
//   broken / unparseable 文件缺/行越界/格式坏——属既有 broken 侧语义，本段不重复发声
//
// 建仓判定用向上找 .git（worktree 的 .git 是文件，存在性判定同样成立）。缓存键=(仓根, rel)，
// 同一文件多个锚只起一次 git 进程。
const HEAD_SHOW_MAXBUFFER = 64 * 1024 * 1024;

export function gitRepoRootOf(absFilePath) {
  let d = path.dirname(path.resolve(absFilePath));
  for (let i = 0; i < 40; i += 1) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

// 单锚三态旁的第4维：对 HEAD 的判定。cache 为可选 Map<(仓根\0rel) → {missing, ignored, lines}>。
export function headAnchorState(locator, root, cache) {
  const parsed = parseLocator(locator);
  if (!parsed.ok) return { state: 'unparseable' };
  const abs = path.isAbsolute(parsed.file) ? parsed.file : path.resolve(root || '.', parsed.file);
  let treeLines;
  try { treeLines = fs.readFileSync(abs, 'utf8').split('\n'); } catch { return { state: 'broken' }; }
  if (parsed.line < 1 || parsed.line > treeLines.length) return { state: 'broken' };
  const repoRoot = gitRepoRootOf(abs);
  if (!repoRoot) return { state: 'no-git', file: abs };
  const rel = path.relative(repoRoot, abs);
  const key = repoRoot + '\0' + rel;
  let entry = cache ? cache.get(key) : null;
  if (!entry) {
    const show = spawnSync('git', ['-C', repoRoot, 'show', 'HEAD:' + rel], { encoding: 'utf8', maxBuffer: HEAD_SHOW_MAXBUFFER });
    if (show.status === 0) {
      entry = { missing: false, lines: String(show.stdout).split('\n') };
    } else {
      // 不在 HEAD：再用 check-ignore 区分「未提交」与「被 ignore 的生成物」（后者不可能入 HEAD，错误类不适用）。
      const ig = spawnSync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', rel]);
      entry = { missing: true, ignored: ig.status === 0 };
    }
    if (cache) cache.set(key, entry);
  }
  if (entry.missing) return { state: entry.ignored ? 'gitignored' : 'uncommitted', repoRoot, rel, file: abs };
  if (parsed.line > entry.lines.length) return { state: 'line-out-of-bounds', repoRoot, rel, file: abs };
  const treeHash = lineHash(treeLines[parsed.line - 1]);
  const headHash = lineHash(entry.lines[parsed.line - 1]);
  if (treeHash !== headHash) return { state: 'content-mismatch', repoRoot, rel, file: abs, treeHash, headHash };
  return { state: 'ok', repoRoot, rel, file: abs, treeHash, headHash };
}

// 批量：只查 progress=verified 节点（设计件 O2 的适用面；未声称对齐的节点不查）。
// 逐节点聚合诊断（同节点同因只发一条，样例封顶 SAMPLE 个节点 id），回执计数与小节供 report/doctor 复用。
export function checkVerifiedHeadAnchors(nodes, root, { sampleLimit = 5 } = {}) {
  const cache = new Map();
  const counts = { ok: 0, 'content-mismatch': 0, 'line-out-of-bounds': 0, uncommitted: 0, gitignored: 0, 'no-git': 0, broken: 0, unparseable: 0 };
  const nodesBy = { uncommitted: [], contentMismatch: [], gitignored: [], noGit: [] };
  const errors = [];
  const warnings = [];
  let checkedAnchors = 0;
  let checkedNodes = 0;
  for (const [id, node] of Object.entries(nodes || {})) {
    if (!node || node.progress !== 'verified') continue;
    checkedNodes += 1;
    const per = { contentMismatch: [], oob: [], uncommitted: [], gitignored: [] };
    let noGit = false;
    for (const locator of node.evidence || []) {
      const st = headAnchorState(locator, root, cache);
      checkedAnchors += 1;
      counts[st.state] = (counts[st.state] || 0) + 1;
      if (st.state === 'content-mismatch') per.contentMismatch.push(locator);
      else if (st.state === 'line-out-of-bounds') per.oob.push(locator);
      else if (st.state === 'uncommitted') per.uncommitted.push(locator);
      else if (st.state === 'gitignored') per.gitignored.push(locator);
      else if (st.state === 'no-git') noGit = true;
    }
    if (per.contentMismatch.length > 0 || per.oob.length > 0) {
      const sample = [].concat(per.contentMismatch, per.oob).slice(0, 3);
      nodesBy.contentMismatch.push(id);
      errors.push({
        rule: 'a3-head-mismatch',
        severity: 'error',
        subject: id,
        evidence: 'A3/O2：' + id + '（progress=verified）工作树内容 ≠ git HEAD——' + sample.join(', ') +
          (per.contentMismatch.length + per.oob.length > sample.length ? ' 等 ' + (per.contentMismatch.length + per.oob.length) + ' 条' : '') +
          '；改锚不会消除该差异（不自动改锚）：先把目标行提交到 HEAD，或将锚指向 HEAD 已存在的证据行',
        supportedFixes: ['git add/commit 目标证据行，或 state evidence-reanchor --to <HEAD 内已提交行>'],
      });
    }
    if (per.uncommitted.length > 0) {
      const sample = per.uncommitted.slice(0, 3);
      nodesBy.uncommitted.push(id);
      errors.push({
        rule: 'a1-evidence-uncommitted',
        severity: 'error',
        subject: id,
        evidence: 'A1/O2：' + id + '（progress=verified）锚指向**不在 git HEAD**的文件（工作树-only）：' + sample.join(', ') +
          (per.uncommitted.length > sample.length ? ' 等 ' + per.uncommitted.length + ' 条' : '') +
          '—— 未提交的文件不能作为「已对齐实相」的证据（demo-b alt 事故）；补救 = 先提交该文件，或改锚到 HEAD 内证据行',
        supportedFixes: ['git add/commit 目标文件后重新 evidence-add 钉哈希', 'state evidence-reanchor --to <HEAD 内已提交锚>'],
      });
    }
    if (per.gitignored.length > 0) {
      const sample = per.gitignored.slice(0, 3);
      nodesBy.gitignored.push(id);
      warnings.push({
        rule: 'a3-head-mismatch',
        severity: 'warning',
        subject: id,
        evidence: 'O2：' + id + ' 的锚指向 .gitignore 排除的生成物（永不可能入 HEAD）：' + sample.join(', ') +
          (per.gitignored.length > sample.length ? ' 等 ' + per.gitignored.length + ' 条' : '') + '；不作 error（否则类红永久），建议改锚到可再生它的源件',
        supportedFixes: ['state evidence-reanchor --to <生成该产物的源件行>'],
      });
    }
    if (noGit) nodesBy.noGit.push(id);
  }
  const cap = (list) => ({ count: list.length, sample: list.slice(0, sampleLimit) });
  // 覆盖/结果聚合（2026-09-15，缺陷3）：区分「真比对通过」「免检」「未检查」「不一致」——
  // ok 只表示「无 error 且无未检查锚」；checkedAnchors=0 时 verdict=no-scope，不构成任何一致性证明。
  const checked = counts.ok || 0;
  const exemptCount = (counts.gitignored || 0) + (counts['no-git'] || 0);
  const uncheckedCount = (counts.broken || 0) + (counts.unparseable || 0);
  let verdict;
  if (errors.length > 0) verdict = 'inconsistent';
  else if (checkedAnchors === 0) verdict = 'no-scope';
  else if (uncheckedCount > 0) verdict = checked > 0 ? 'partial' : 'unchecked-only';
  else if (checked > 0) verdict = exemptCount > 0 ? 'partial' : 'verified';
  else if (exemptCount > 0) verdict = 'exempt-only';
  else verdict = 'no-scope';
  return {
    verdict,
    ok: errors.length === 0 && uncheckedCount === 0,
    checkedNodes,
    checkedAnchors,
    checked,
    exempt: { gitignored: counts.gitignored || 0, noGit: counts['no-git'] || 0 },
    unchecked: { broken: counts.broken || 0, unparseable: counts.unparseable || 0 },
    counts,
    errors,
    warnings,
    uncommitted: cap(nodesBy.uncommitted),
    contentMismatch: cap(nodesBy.contentMismatch),
    gitignored: cap(nodesBy.gitignored),
    noGit: cap(nodesBy.noGit),
  };
}

