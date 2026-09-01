#!/usr/bin/env node
// 契约保鲜对账门禁（PENDING-IMPROVEMENTS-2026-08-15 D6；demo-harness「Status rots」教训机器化之二）：
// a) --help 对账：实跑 bin --help，注册表命令名（EXPECTED_COMMANDS，现十条）逐一确认出现；反向——help 里出现的顶级命令
//    （[x] 小节头 + atlas-engine <cmd> 用法行）必须在 command-contract.md 有对应章节（宽松=单词出现）。
// b) 错误码对账：lib/*.mjs + bin/*.mjs 全部字面错误码（diagnostics.rule 发射上下文）对照契约附录 A 表——
//    代码有而附录缺 = exit 1 列名清单；附录有而代码无 = warning 打印不阻断（历史码宽容）。
// c) 预算对账（增长控制开发规范批一#4）：命令数 ≤11（当前 10——0.10.0 移除 evidence 后腾出 1 个名额；
//    硬顶不随实数回落，理由见 specs/command-contract.md「治理」节；占用名额须过准入五问+采用率基线）、全仓唯一旗标总数 ≤50（从注册表 flags 字段聚合统计，
//    不再 grep 文本）——超顶 exit 1 并打印「预算超限=强制一次显式决定:提预算或退一个旗标」。
// d) 旗标三向对账（批一#2/#4）：每命令 flags ⊆ 该命令 usage 文本提及 ∪ 契约对应节提及（宽松字面匹配），
//    flags 有而两处皆无 = exit 1（防白名单私加旗标绕文档）。
// 可移植性（DEFENSIVE.md §7 教训）：不依赖 TTY 格式、不依赖本机路径；CI 无 archify 也可跑
// （--help 路径不触 archify 内核）。用法：node scripts/verify-contract-freshness.mjs [--commands-budget <N>] [--flags-budget <N>]（预算覆盖仅供测试红路验证）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const BIN = path.join(root, 'bin', 'atlas-engine.mjs');
const CONTRACT = path.join(root, 'specs', 'command-contract.md');
const APPENDIX_TITLE = '## 附录 A 错误码';
const SRC_DIRS = ['lib', 'bin'];

// 预算硬顶（specs/command-contract.md「治理」节）：命令数 ≤ COMMAND_BUDGET；全仓唯一旗标 ≤ FLAG_BUDGET。
let COMMAND_BUDGET = 11;
let FLAG_BUDGET = 50;
const scriptArgs = process.argv.slice(2);
for (let i = 0; i < scriptArgs.length; i += 1) {
  if (scriptArgs[i] === '--commands-budget' || scriptArgs[i] === '--flags-budget') {
    const v = Number(scriptArgs[i + 1]);
    if (!Number.isInteger(v) || v < 0) {
      console.error(scriptArgs[i] + ' 需要非负整数参数');
      process.exit(2);
    }
    if (scriptArgs[i] === '--commands-budget') COMMAND_BUDGET = v;
    else FLAG_BUDGET = v;
    i += 1;
    continue;
  }
  console.error('未知参数：' + scriptArgs[i] + '（用法：--commands-budget <N> --flags-budget <N>）');
  process.exit(2);
}

// 十命令（与契约 §1-10、帮助文本同序；D4 后帮助文本由注册表生成，此表是注册表名的对账锚。
// 0.10.0：evidence 顶层命令按两段式废弃政策第二阶段移除，十一 → 十）。
const EXPECTED_COMMANDS = ['init', 'state', 'diff', 'compile', 'report', 'gate', 'trace', 'lessons', 'notice', 'doctor'];

// 非错误码字面量例外（按命名空间显式剔除，避免门禁误报）：
// - RECEIPT_RULES：成功回执 receipt.rule 命名空间（契约 §2 文档化：A2/A2-init/A2-correction/A3/
//   A2-cross-axis-settle/A2-cross-axis-block），非 diagnostics.rule 错误码，不查附录 A。
// - gate_：diag('gate_' + result.stage) 动态前缀，无完整字面量；附录以模板行 gate_<stage> 覆盖。
// - SYSTEM_CODES：Node/OS 原生错误码（kill ESRCH / fs ENOENT / mkdir EEXIST 的 e.code 检查），非本仓错误码。
const RECEIPT_RULES = new Set(['A2', 'A2-init', 'A2-correction', 'A3', 'A2-cross-axis-settle', 'A2-cross-axis-block']);
const DYNAMIC_PREFIXES = new Set(['gate_']);
const SYSTEM_CODES = new Set(['ESRCH', 'ENOENT', 'EEXIST']);

// ---------- 采集代码字面错误码 ----------
// emitted = 会真正进入 diagnostics.rule 的码（发射上下文）；literals = 全部字面量（含 e.code 检查上下文）。
const emitted = new Set();
const literals = new Set();
const patterns = [
  // 发射：各模块局部 diag('code', ...) 首参（bin 与 lib 同构）。
  { re: /diag\(\s*'([a-z][a-z0-9_-]*)'/g, to: 'both' },
  // 发射：err.code = 'code'（err./e. 前缀同匹配；\b 在 '.' 与字母间成界）。
  { re: /\bcode\s*=\s*'([a-z][a-z0-9_-]*)'/g, to: 'both' },
  // 发射：diag(e.code || 'sidecar_error', ...) 兜底。
  { re: /code\s*\|\|\s*'([a-z][a-z0-9_-]*)'/g, to: 'both' },
  // 发射：诊断对象字面量 rule: 'code'（如 autoTrace 的 trace_degraded）；回执码由 RECEIPT_RULES 剔除。
  { re: /rule\s*:\s*'([a-z][a-z0-9_-]*)'/g, to: 'both' },
  // 字面量：e.code === 'code' / !== 等检查上下文（反向核对用）。
  { re: /code\s*(?:===|!==|==|!=)\s*'([a-z][a-z0-9_-]*)'/g, to: 'literals' },
];
for (const dir of SRC_DIRS) {
  for (const file of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(root, dir, file), 'utf8');
    for (const p of patterns) {
      for (const m of text.matchAll(p.re)) {
        const code = m[1];
        if (SYSTEM_CODES.has(code)) continue;
        if (DYNAMIC_PREFIXES.has(code)) continue;
        literals.add(code);
        if (p.to === 'both' && !RECEIPT_RULES.has(code)) emitted.add(code);
      }
    }
  }
}

// ---------- 注册表动态 import（批一#2/#4：flags 聚合的唯一真相源，不 grep 文本） ----------
let COMMANDS = [];
try {
  const mod = await import(pathToFileURL(path.join(root, 'lib', 'commands.mjs')).href);
  COMMANDS = mod.COMMANDS;
} catch (e) {
  console.error('lib/commands.mjs 动态 import 失败：' + e.message);
  process.exit(2);
}
const uniqueFlags = new Set();
for (const c of COMMANDS) {
  if (!Array.isArray(c.flags) || c.flags.length === 0) {
    console.error('注册表命令缺 flags 白名单（批一#2：每命令必须显式登记合法旗标）：' + c.name);
    process.exit(1);
  }
  for (const f of c.flags) uniqueFlags.add(f);
}

// ---------- 解析契约附录 A 表 ----------
const contract = fs.readFileSync(CONTRACT, 'utf8');
const appendixStart = contract.indexOf(APPENDIX_TITLE);
if (appendixStart === -1) {
  console.error('command-contract.md 找不到附录 A（' + APPENDIX_TITLE + '）');
  process.exit(1);
}
const appendixCodes = new Set();
for (const line of contract.slice(appendixStart).split('\n')) {
  const m = line.match(/^\| ([^|]+?) \|/);
  if (!m) continue;
  const code = m[1].trim();
  if (/^[a-z][a-z0-9_<>-]*$/.test(code)) appendixCodes.add(code);
}

let exitCode = 0;

// ---------- a) --help ↔ 契约 ----------
let help;
try {
  help = execFileSync(process.execPath, [BIN, '--help'], { cwd: root, encoding: 'utf8' });
} catch (e) {
  console.error('无法执行 bin --help（' + e.message + '）');
  process.exit(2);
}
const wordRe = (name) => new RegExp('\\b' + name + '\\b');
// 正向：十命令名逐一出现在 --help。
const missingInHelp = EXPECTED_COMMANDS.filter((n) => !wordRe(n).test(help));
if (missingInHelp.length > 0) {
  console.error('--help 缺命令名（' + missingInHelp.length + ' 个）：' + missingInHelp.join(', '));
  exitCode = 1;
}
// 反向：--help 里出现的顶级命令（[x] 小节头 + atlas-engine <cmd> 用法行）必须在契约出现。
const helpCommands = new Set([
  ...[...help.matchAll(/^\[([a-z][a-z0-9_-]*)\]/gm)].map((m) => m[1]),
  ...[...help.matchAll(/^atlas-engine ([a-z][a-z0-9_-]*)/gm)].map((m) => m[1]),
]);
const noContract = [...helpCommands].filter((n) => !wordRe(n).test(contract));
if (noContract.length > 0) {
  console.error('--help 命令在 command-contract.md 无对应章节（' + noContract.length + ' 个）：' + noContract.join(', '));
  exitCode = 1;
}

// ---------- b) 错误码 ↔ 附录 A ----------
// 代码有而附录缺 = exit 1（新码必须入契约，防实现先走契约后补的漂移）。
const codeMissingInAppendix = [...emitted].filter((c) => !appendixCodes.has(c)).sort();
if (codeMissingInAppendix.length > 0) {
  console.error('代码字面错误码在契约附录 A 缺失（' + codeMissingInAppendix.length + ' 个）：');
  for (const c of codeMissingInAppendix) console.error('  ' + c);
  exitCode = 1;
}
// 附录有而代码无 = warning 不阻断（历史码宽容：旧码已不发射时先警告，不误伤）。
const staleAppendix = [];
for (const code of appendixCodes) {
  if (code.includes('<')) continue; // 模板行（如 gate_<stage>）无对应字面量，跳过。
  if (!literals.has(code)) staleAppendix.push(code);
}
for (const c of staleAppendix.sort()) console.warn('warning：附录 A 有而代码无字面量：' + c + '（历史码宽容，不阻断）');

// ---------- c) 预算对账（批一#4：命令数/旗标总数硬顶，超限强制显式决定） ----------
if (COMMANDS.length > COMMAND_BUDGET) {
  console.error(`预算超限=强制一次显式决定:提预算或退一个命令（命令数 ${COMMANDS.length} > 硬顶 ${COMMAND_BUDGET}）`);
  exitCode = 1;
}
if (uniqueFlags.size > FLAG_BUDGET) {
  console.error(`预算超限=强制一次显式决定:提预算或退一个旗标（全仓唯一旗标 ${uniqueFlags.size} > 硬顶 ${FLAG_BUDGET}）`);
  exitCode = 1;
}

// ---------- d) 旗标三向对账（批一#2/#4：flags ⊆ usage ∪ 契约节，防白名单私加旗标绕文档） ----------
// 契约节按 "## N. 命令名" 标题切分（附录/治理等无编号标题归 null，不并入任何命令节）；宽松字面匹配 = 子串出现即算提及。
const sections = new Map();
let current = null;
for (const line of contract.split('\n')) {
  if (line.startsWith('## ')) {
    const m = line.match(/^## (\d+)\. ([a-z][a-z0-9_-]*)/);
    current = m ? m[2] : null;
    continue;
  }
  if (current) {
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current).push(line);
  }
}
const flagDocDrift = [];
for (const c of COMMANDS) {
  const usageText = (c.usage || []).join('\n');
  const sectionText = (sections.get(c.name) || []).join('\n');
  for (const f of c.flags) {
    if (!usageText.includes(f) && !sectionText.includes(f)) {
      flagDocDrift.push(c.name + ':' + f);
    }
  }
}
if (flagDocDrift.length > 0) {
  console.error('注册表 flags 白名单在 usage 与契约节均未提及（' + flagDocDrift.length + ' 个，防白名单私加旗标绕文档）：');
  for (const f of flagDocDrift) console.error('  ' + f);
  exitCode = 1;
}

// ---------- 汇总 ----------
if (exitCode !== 0) {
  console.error(`contract-freshness fail：help/契约、错误码/附录 A、预算或旗标文档对账不一致（详见上）`);
  process.exit(exitCode);
}
console.log(`contract-freshness ok：${COMMANDS.length} 命令双向一致；附录 A 覆盖全部 ${emitted.size} 个代码字面错误码；预算 ${COMMANDS.length}/${COMMAND_BUDGET} 命令、${uniqueFlags.size}/${FLAG_BUDGET} 全仓唯一旗标；flags⊆usage∪契约节 三向一致${staleAppendix.length > 0 ? '；' + staleAppendix.length + ' 个附录历史码无代码字面量（warning 已列）' : ''}`);
