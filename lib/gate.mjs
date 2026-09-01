// gate（command-contract.md §7）：串行三闸 validate → deliver → visual-check，全绿才 pass。
// 诚实纪律：任一闸非零退出即 fail，绝不伪装成功。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { resolveArchify } from './resolve-archify.mjs';

export function diagramTypeOf(specPath) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  return spec.diagram_type || 'architecture';
}

// 失败诊断尾部（0.8.0 修复，holdout 遗留缺陷1：坏内核只盯 stdout——node 对非 JS 文件把错误打到 stderr，
// tail 为空，用户面对「三闸停在 validate：」冒号后一片空白）。规则：
// - stdout 与 stderr 尾部各截断（保尾部=最新错误行），合计 ≤900 字符（含注记行，见下）；
// - 两者皆空 → 明写「内核无输出」+ 已解析路径（来源 → 路径），绝不给空白消息。
// 0.10.0（holdout #2 P2a，二进制内核场景可行动化）：
// - tail 生成时过滤不可打印字节——保留 \n\t，其余非打印字符替换为 · 并注明「已过滤 N 个不可打印字节」
//   （ARCHIFY_BIN=/bin/ls 实测 918 字符里 23% 是 ELF 不可打印字节 + node 栈，消息不可读）；
// - 无条件附已解析路径与来源（env/path/fallback/override）——不再只在输出全空时才提示。
const NON_PRINTABLE_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
function sanitizeStream(s) {
  let n = 0;
  const text = s.replace(NON_PRINTABLE_RE, () => { n += 1; return '·'; });
  return { text, n };
}

function failureTail(res, resolved) {
  const out = sanitizeStream(String(res.stdout || '').trim());
  const err = sanitizeStream(String(res.stderr || '').trim());
  const resolvedNote = '已解析路径=' + resolved.source + ' → ' + resolved.bin;
  if (!out.text && !err.text) {
    let msg = '内核无输出（可能不是 archify 可执行文件），' + resolvedNote;
    if (res.error) msg += '；spawn 错误=' + res.error.message;
    return msg;
  }
  const notes = [];
  const filteredTotal = out.n + err.n;
  if (filteredTotal > 0) notes.push('（已过滤 ' + filteredTotal + ' 个不可打印字节）');
  notes.push(resolvedNote);
  const notesText = notes.join('\n');
  // 截断预算动态让位给注记行：两流合计 + 标签换行 + 注记 ≤900 字符（0.10.0 起注记也计入预算）。
  const streamBudget = Math.max(200, 900 - notesText.length - 22);
  const budget = out.text && err.text ? Math.floor(streamBudget / 2) : streamBudget;
  const clip = (s) => (s.length > budget ? '…（截断）' + s.slice(-budget) : s);
  const parts = [];
  if (out.text) parts.push('[stdout] ' + clip(out.text));
  if (err.text) parts.push('[stderr] ' + clip(err.text));
  return parts.join('\n') + '\n' + notesText;
}

// 0.14.0（archify 2.16 新守卫适配）：失败尾追加内核结构化诊断的可操作摘要。
// validate/deliver 以 --json 运行，失败时 stdout 是含 diagnostics[] 的回执；旧版 failureTail
// 只能截断 JSON 原文，新守卫的处置建议（如 labelAt/labelDx/labelDy、缩短文案/拆图）会淹在字节里。
// 提示级纯增：解析失败/无诊断返回空串（stub 文本内核零影响），无新规则码不改退出语义。
function structuredDiagNote(res) {
  try {
    const parsed = JSON.parse(String(res.stdout || ''));
    const diags = parsed && Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
    // 无 code 的诊断不摘要（诚实缺省：不造兜底码）
    const d0 = diags.find((d) => d && typeof d.code === 'string' && d.code);
    if (!d0) return '';
    const msg = String(d0.message || d0.evidence || '').trim();
    const fixes = Array.isArray(d0.supportedFixes) ? d0.supportedFixes.length : 0;
    let note = '\n内核诊断[' + d0.code + '] ' + msg.slice(0, 180);
    if (diags.length > 1) note += '（另 ' + (diags.length - 1) + ' 条诊断）';
    if (fixes > 0) note += '\n处置建议（' + fixes + ' 条）：' + String(d0.supportedFixes[0]).slice(0, 160);
    return note;
  } catch {
    return '';
  }
}

// 0.14.1（交叉审核 glm 席 b① 发现）：visual-check 回执形状与 validate/deliver 不同——
// 无 diagnostics[]，失败状态分置 containment/readability/viewerChrome/captures 子项。
// 此函数解析子项状态，把失败的视觉检查项提到失败尾（同纯增纪律：解析失败/全 pass 返空串）。
function visualCheckNote(res) {
  try {
    const parsed = JSON.parse(String(res.stdout || ''));
    if (!parsed || typeof parsed !== 'object') return '';
    const subs = ['containment', 'readability', 'viewerChrome', 'captures'];
    const failed = subs.filter((s) => parsed[s] && parsed[s].status === 'fail');
    if (failed.length === 0) return '';
    return '\n内核诊断[visual-check] 视觉检查失败项：' + failed.join('、') +
      '（证据见 sidecars 联络表/回执：' + String((parsed.sidecars && parsed.sidecars.contactSheet) || 'N/A').slice(0, 120) + '）';
  } catch {
    return '';
  }
}

export function runGate(specPath, outPath, archifyBin) {
  const resolved = archifyBin ? { bin: archifyBin, source: 'override' } : resolveArchify();
  const bin = resolved.bin;
  if (!bin || !fs.existsSync(bin)) {
    return { final: 'fail', stage: 'archify-missing', results: {}, diagnostic: 'archify CLI 不存在：' + (bin || '未找到（ARCHIFY_BIN / PATH / 内置回退均无；source=' + resolved.source + '）') };
  }
  const type = diagramTypeOf(specPath);
  const run = (args) => spawnSync(process.execPath, [bin].concat(args), { encoding: 'utf8' });

  const validate = run(['validate', type, specPath, '--quality', 'showcase', '--json']);
  const results = { validate: { exit: validate.status } };
  if (validate.status !== 0) {
    return { final: 'fail', stage: 'validate', results, tail: failureTail(validate, resolved) + structuredDiagNote(validate) };
  }
  const deliver = run(['deliver', type, specPath, outPath, '--quality', 'showcase', '--json']);
  results.deliver = { exit: deliver.status };
  if (deliver.status !== 0) {
    return { final: 'fail', stage: 'deliver', results, tail: failureTail(deliver, resolved) + structuredDiagNote(deliver) };
  }
  const check = run(['visual-check', outPath, '--json']);
  results.visual_check = { exit: check.status };
  if (check.status !== 0) {
    return { final: 'fail', stage: 'visual-check', results, tail: failureTail(check, resolved) + visualCheckNote(check) };
  }
  return { final: 'pass', stage: null, results };
}

