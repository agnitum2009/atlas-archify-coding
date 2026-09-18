// gate（command-contract.md §7）：串行三闸 validate → deliver → visual-check，全绿才 pass。
// 诚实纪律：任一闸非零退出、或成功退出但**回执不合内核契约**，即 fail，绝不伪装成功。
//
// 2026-09-15（缺陷7）：旧实现只看子进程 exit code——假内核（如脚本 `console.log('{"status":"failed"}')`
// 后 exit 0、不产 HTML）能让 gate 判 final=pass，旧产物也能冒充本次成功。现在每闸都做两件事：
//   ① 有界执行（超时可诊断，不开无限挂起）；
//   ② 内核回执契约校验 + 产物本轮归属校验（见 validate/deliver/visual-check 各自的 receipt 面）。
// 回执契约取自本机 archify（<home>/.agents/skills/archify，v2.16）实读源码，不是推测：
//   validate      ：exit 0 ⇒ {schemaVersion:1, ok:true, command:'validate', input:<绝对路径>, checks[], composition}
//                   —— 注意**该回执没有顶层 status 字段**（不得统一按 status==='pass' 判，否则误伤）。
//   deliver       ：exit 0 ⇒ {schemaVersion:1, ok:true, command:'deliver', input, output,
//                    specification:{sha256,bytes}, artifact:{sha256,bytes}, validation:{checksPassed,checkCount,...}}
//   visual-check  ：exit 0 ⇒ status:'pass' + ok:true；exit 1=overflow/capture 失败；exit 2=Chrome 不可用
//                   且 status:'skipped'。回执恒带 visualReview:'pending'——**自动证据不得声称视觉复核已过**，
//                   gate 由此保留人工 visualReview 边界（本文件只转述，绝不改写该字段）。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveArchify } from './resolve-archify.mjs';
import { resolveAtlasContext, appendJsonl } from './atlas-data.mjs';
import { gitRepoRootOf, gitSync } from './evidence.mjs';

/** 三闸名（逐闸历史与回执的稳定键序） */
export const GATE_NAMES = Object.freeze(['validate', 'deliver', 'visual_check']);

// 单闸有界执行：默认 10 分钟（archify 渲染 + Chrome visual-check 在 690KB 级产物上可达数十秒），
// ARCHIFY_GATE_TIMEOUT_MS 可覆盖。超时 = 可诊断失败（stage 停在当前闸，tail 明写毫秒数与处置）。
const DEFAULT_STAGE_TIMEOUT_MS = 600000;

function stageTimeoutMs() {
  const v = Number(process.env.ARCHIFY_GATE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_STAGE_TIMEOUT_MS;
}

export function diagramTypeOf(specPath) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (e) {
    const err = new Error('图件 spec 不可读或非合法 JSON：' + specPath + '（' + e.message + '）');
    err.code = 'gate_bad_diagram';
    throw err;
  }
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
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return '内核执行超时（ARCHIFY_GATE_TIMEOUT_MS 可调；被 SIGKILL 终止，可能仍在部分写入产物）：' + resolvedNote;
  }
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

// ---------- 回执契约校验（缺陷7 的核心：成功退出不等于成功交付） ----------

function parseReceipt(res) {
  try {
    const parsed = JSON.parse(String(res.stdout || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 成功回执的公共面：schemaVersion=1 / ok=true / command=<闸名> / input 指向本次输入。
// 注意：validate 成功回执**没有顶层 status**，故此处一律不查 status（只查 ok 与 command）。
function receiptContractIssue(receipt, { command, inputPath }) {
  if (!receipt) return '内核成功退出但 stdout 不是 JSON 回执（无法确认这是 archify 的成功交付）';
  if (receipt.schemaVersion !== 1) return '内核回执 schemaVersion=' + JSON.stringify(receipt.schemaVersion) + '（期望 1）';
  if (receipt.ok !== true) return '内核回执 ok=' + JSON.stringify(receipt.ok) + '（期望 true——假内核/失败回执以 exit 0 冒充成功即在此拦下）';
  if (receipt.command !== command) return '内核回执 command=' + JSON.stringify(receipt.command) + '（期望 ' + JSON.stringify(command) + '）';
  if (inputPath !== undefined) {
    const got = typeof receipt.input === 'string' ? path.resolve(receipt.input) : null;
    if (got !== path.resolve(inputPath)) return '内核回执 input=' + JSON.stringify(receipt.input) + '（期望本次输入 ' + path.resolve(inputPath) + '）';
  }
  return null;
}

// 产物「本轮归属」判据（缺陷7 第②条；**防误不防恶**——可信本地内核下有效，不声称能防恶意重放）：
//   ① 回执自洽：schemaVersion/ok/command/input(本次 spec) 全对；
//   ② 输入绑定：回执 specification.{sha256,bytes} 必须等于**本次 spec 文件**的摘要（内核回执只认本次输入）；
//   ③ 输出绑定：回执 output 必须就是本次请求的产物路径；
//   ④ 内容绑定：回执 artifact.{sha256,bytes} 必须等于磁盘上目标文件的实际摘要；
//   ⑤ 新鲜度：目标文件的 mtime 必须落在本闸运行窗口内（旧产物原样躺在那儿 + 抄旧回执 = fail）；
//   ⑥ 视觉闸后复检：visual-check 跑完再算一次 HTML 摘要，证明视觉检查未改写产物。
// 不做私有 staging 提交链（visual-check 会在产物旁写 4 张截图 + 联络表 + 回执，逐个改名提交的代价
// 与失败半途残留风险高于收益）；上述 5 条 + ①的边界由契约明载。
function fileDigest(file) {
  try {
    const st = fs.statSync(file);
    const buf = fs.readFileSync(file);
    return {
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.byteLength,
      ino: st.ino || 0,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
  } catch {
    return null;
  }
}

// 内核回执自带的 validate 面：checks[] 非空且逐项明确通过 + composition 明确 pass / errors=0。
// 只看 exit code 会放过「ok:true 但子项失败」的回执（假内核/内核自身回归），故逐项判。
function validateReceiptIssue(receipt) {
  const checks = receipt.checks;
  if (!Array.isArray(checks) || checks.length === 0) return '内核回执缺少实际检查项';
  if (checks.some((c) => !c || c.ok !== true)) return '内核回执包含未明确通过的检查项';
  const comp = receipt.composition;
  if (!comp || comp.status !== 'pass') return '内核回执 composition.status 未明确通过（期望 pass）';
  if (!comp.summary || comp.summary.errors !== 0) return '内核回执 composition.summary.errors 未明确为 0';
  return null;
}

// 内核回执自带的 deliver 面：specification 摘要必须对应**本次 spec**，output 必须是**本次请求的产物**。
function deliverReceiptIssue(receipt, { specPath, outPath }) {
  const spec = receipt.specification;
  if (!spec || typeof spec.sha256 !== 'string' || typeof spec.bytes !== 'number') return '内核回执缺少 specification.{sha256,bytes}（无法确认交付的是本次 spec）';
  const specDigest = fileDigest(specPath);
  if (!specDigest) return '本次 spec 不可读（' + specPath + '）——无法核对内核回执的 specification 摘要';
  if (spec.sha256 !== specDigest.sha256 || spec.bytes !== specDigest.bytes) {
    return '内核回执 specification 摘要与本次 spec 不一致：回执=' + String(spec.sha256).slice(0, 12) + '/' + spec.bytes + 'B，本次=' + specDigest.sha256.slice(0, 12) + '/' + spec.bytes + 'B';
  }
  if (typeof receipt.output !== 'string' || path.resolve(receipt.output) !== path.resolve(outPath)) {
    return '内核回执 output=' + JSON.stringify(receipt.output) + '（期望本次产物 ' + path.resolve(outPath) + '）';
  }
  const v = receipt.validation;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!v || !count(v.checkCount) || v.checkCount === 0 || !count(v.checksPassed) || v.checksPassed !== v.checkCount)
    return '内核回执检查计数未全部通过';
  if (v.compositionStatus !== 'pass' || v.errors !== 0) return '内核回执排版校验未明确通过';
  return null;
}

// 内核回执自带的 visual-check 面：四项子状态必须全 pass（status='pass' 只是它们的汇总，
// 假内核可只报汇总），且被检产物 sha256 必须等于交付产物。
function visualCheckReceiptIssue(receipt, { deliveredSha256, deliveredBytes, outPath }) {
  if (receipt.visualReview !== 'pending') return '视觉检查 visualReview 未明确为 pending';
  if (!receipt.artifact || typeof receipt.artifact.path !== 'string' || path.resolve(receipt.artifact.path) !== path.resolve(outPath))
    return '被检产物 path 与本次交付路径不一致';
  if (receipt.artifact.bytes !== deliveredBytes) return '被检产物 bytes 与本次交付字节数不一致';
  const subs = ['containment', 'readability', 'viewerChrome', 'captures'];
  const bad = subs.filter((s) => !receipt[s] || receipt[s].status !== 'pass');
  if (bad.length > 0) {
    const detail = bad.map((s) => s + '=' + (receipt[s] && receipt[s].status ? receipt[s].status : 'missing')).join('、');
    return '视觉检查子项未全 pass：' + detail;
  }
  if (!receipt.artifact || typeof receipt.artifact.sha256 !== 'string') return '回执缺少 artifact.sha256（无法确认被检产物）';
  if (receipt.artifact.sha256 !== deliveredSha256) return '被检产物 sha256=' + String(receipt.artifact.sha256).slice(0, 12) + ' 与本次交付产物 sha256=' + deliveredSha256.slice(0, 12) + ' 不一致';
  return null;
}

function summarizeValidate(receipt) {
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  return {
    checkCount: checks.length,
    checksPassed: checks.filter((c) => c && c.ok === true).length,
    compositionProfile: receipt.composition && receipt.composition.profile ? receipt.composition.profile : null,
    compositionErrors: receipt.composition && receipt.composition.summary ? receipt.composition.summary.errors : null,
    compositionWarnings: receipt.composition && receipt.composition.summary ? receipt.composition.summary.warnings : null,
    input: receipt.input || null,
  };
}

function summarizeDeliver(receipt) {
  const v = receipt.validation || {};
  return {
    checksPassed: v.checksPassed === undefined ? null : v.checksPassed,
    checkCount: v.checkCount === undefined ? null : v.checkCount,
    compositionProfile: v.compositionProfile || null,
    compositionStatus: v.compositionStatus || null,
    specificationSha256: receipt.specification ? receipt.specification.sha256 : null,
    artifactSha256: receipt.artifact ? receipt.artifact.sha256 : null,
    artifactBytes: receipt.artifact ? receipt.artifact.bytes : null,
    output: receipt.output || null,
  };
}

function summarizeVisualCheck(receipt) {
  const sub = (s) => (receipt[s] && receipt[s].status ? receipt[s].status : null);
  return {
    status: receipt.status === undefined ? null : receipt.status,
    visualReview: receipt.visualReview === undefined ? null : receipt.visualReview,
    containment: sub('containment'),
    readability: sub('readability'),
    viewerChrome: sub('viewerChrome'),
    captures: sub('captures'),
    artifactSha256: receipt.artifact ? receipt.artifact.sha256 : null,
    contactSheet: receipt.sidecars ? receipt.sidecars.contactSheet : null,
  };
}

export function runGate(specPath, outPath, archifyBin) {
  const resolved = archifyBin ? { bin: archifyBin, source: 'override' } : resolveArchify();
  const bin = resolved.bin;
  if (!bin || !fs.existsSync(bin)) {
    return { final: 'fail', stage: 'archify-missing', reason: 'archify-missing', results: {}, diagnostic: 'archify CLI 不存在：' + (bin || '未找到（ARCHIFY_BIN / PATH / 内置回退均无；source=' + resolved.source + '）') };
  }
  const timeout = stageTimeoutMs();
  // 前置清点：deliver 之前记录目标文件状态，用于「本轮归属」判定（旧产物不得冒充本次成功）。
  const outAbs = path.resolve(outPath);
  const beforeDeliver = fileDigest(outAbs);
  let type;
  try {
    type = diagramTypeOf(specPath);
  } catch (e) {
    if (e.code === 'gate_bad_diagram') {
      return { final: 'fail', stage: 'diagram', reason: 'bad-diagram', results: {}, diagnostic: e.message };
    }
    throw e;
  }
  const run = (args) => {
    const t0 = Date.now();
    const res = spawnSync(process.execPath, [bin].concat(args), { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
    res.ms = Date.now() - t0; // O5：逐闸耗时入 results（只增字段，判态仍看 status）
    return res;
  };

  const validate = run(['validate', type, specPath, '--quality', 'showcase', '--json']);
  const results = { validate: { exit: validate.status, status: validate.status === 0 ? 'pass' : 'fail', ms: validate.ms } };
  if (validate.status !== 0 || (validate.error && validate.error.code === 'ETIMEDOUT')) {
    const timedOut = Boolean(validate.error && validate.error.code === 'ETIMEDOUT');
    return {
      final: 'fail', stage: 'validate', reason: timedOut ? 'validate-timeout' : 'validate-failed', results,
      tail: failureTail(validate, resolved) + structuredDiagNote(validate),
    };
  }
  const validateReceipt = parseReceipt(validate);
  const validateIssue = receiptContractIssue(validateReceipt, { command: 'validate', inputPath: specPath });
  if (validateIssue) {
    results.validate.status = 'fail';
    return {
      final: 'fail', stage: 'validate', reason: 'validate-receipt', results,
      tail: '内核回执契约不符：' + validateIssue + '\n' + (failureTail(validate, resolved) || '（内核无输出）'),
    };
  }
  const validateFaceIssue = validateReceiptIssue(validateReceipt);
  if (validateFaceIssue) {
    results.validate.status = 'fail';
    return {
      final: 'fail', stage: 'validate', reason: 'validate-receipt', results,
      tail: '内核回执自称成功但校验面不过：' + validateFaceIssue,
    };
  }
  results.validate.receipt = summarizeValidate(validateReceipt);

  const deliverStartedAt = Date.now();
  const deliver = run(['deliver', type, specPath, outPath, '--quality', 'showcase', '--json']);
  const deliverFinishedAt = Date.now();
  results.deliver = { exit: deliver.status, status: deliver.status === 0 ? 'pass' : 'fail', ms: deliver.ms };
  if (deliver.status !== 0 || (deliver.error && deliver.error.code === 'ETIMEDOUT')) {
    const timedOut = Boolean(deliver.error && deliver.error.code === 'ETIMEDOUT');
    return {
      final: 'fail', stage: 'deliver', reason: timedOut ? 'deliver-timeout' : 'deliver-failed', results,
      tail: failureTail(deliver, resolved) + structuredDiagNote(deliver),
    };
  }
  const deliverReceipt = parseReceipt(deliver);
  const deliverIssue = receiptContractIssue(deliverReceipt, { command: 'deliver', inputPath: specPath });
  if (deliverIssue) {
    results.deliver.status = 'fail';
    return {
      final: 'fail', stage: 'deliver', reason: 'deliver-receipt', results,
      tail: '内核回执契约不符：' + deliverIssue + '\n' + (failureTail(deliver, resolved) || '（内核无输出）'),
    };
  }
  // 输入/输出绑定：回执的 specification 摘要必须对应本次 spec，output 必须是本次请求路径。
  const deliverFaceIssue = deliverReceiptIssue(deliverReceipt, { specPath, outPath });
  if (deliverFaceIssue) {
    results.deliver.status = 'fail';
    return {
      final: 'fail', stage: 'deliver', reason: 'deliver-receipt', results,
      tail: '内核回执自称成功但输入/输出绑定不符：' + deliverFaceIssue,
    };
  }
  if (!deliverReceipt.artifact || typeof deliverReceipt.artifact.sha256 !== 'string' || typeof deliverReceipt.artifact.bytes !== 'number') {
    results.deliver.status = 'fail';
    return {
      final: 'fail', stage: 'deliver', reason: 'deliver-receipt', results,
      tail: '内核回执缺少 artifact.{sha256,bytes}——无法确认产物归属（不接受「有退出码就算交付」）',
    };
  }
  // 产物本轮归属：回执声明的 sha256/bytes 必须与磁盘上目标文件一致，且该文件必须在本闸窗口内被（重）写。
  const delivered = fileDigest(outAbs);
  if (!delivered) {
    results.deliver.status = 'fail';
    return {
      final: 'fail', stage: 'deliver', reason: 'deliver-artifact-missing', results,
      tail: '内核回执声称交付成功，但目标产物不存在或不可读：' + outAbs + '（旧产物/假内核不得冒充本次成功）',
    };
  }
  if (delivered.sha256 !== deliverReceipt.artifact.sha256 || delivered.bytes !== deliverReceipt.artifact.bytes) {
    results.deliver.status = 'fail';
    return {
      final: 'fail', stage: 'deliver', reason: 'deliver-artifact-mismatch', results,
      tail: '产物与内核回执不一致：磁盘 sha256=' + delivered.sha256.slice(0, 12) + '/' + delivered.bytes + 'B，回执=' +
        String(deliverReceipt.artifact.sha256).slice(0, 12) + '/' + deliverReceipt.artifact.bytes + 'B（目标 ' + outAbs + '）' +
        (beforeDeliver ? '；交付前该文件已存在（旧产物 sha256=' + beforeDeliver.sha256.slice(0, 12) + '）' : ''),
    };
  }
  // 新鲜度：目标文件的 mtime 必须落在 deliver 启动至结束窗口内（两端容忍 1s 文件系统时间粒度）。
  // 这挡住「旧产物原地不动 + 抄一份旧回执」；不声称能防恶意改动 mtime（防误不防恶，见文件头）。
  if (delivered.mtimeMs < deliverStartedAt - 1000 || delivered.mtimeMs > deliverFinishedAt + 1000) {
    results.deliver.status = 'fail';
    return {
      final: 'fail', stage: 'deliver', reason: 'deliver-artifact-stale', results,
      tail: '目标产物未在本闸运行窗口内被写入（mtime=' + new Date(delivered.mtimeMs).toISOString() +
        (delivered.mtimeMs < deliverStartedAt - 1000 ? ' 早于 deliver 启动 ' + new Date(deliverStartedAt).toISOString() :
          ' 位于未来，晚于 deliver 结束 ' + new Date(deliverFinishedAt).toISOString()) +
        '）：旧产物不得冒充本次成功（目标 ' + outAbs + '）',
    };
  }
  results.deliver.receipt = summarizeDeliver(deliverReceipt);

  const check = run(['visual-check', outPath, '--json']);
  results.visual_check = { exit: check.status, status: check.status === 0 ? 'pass' : 'fail', ms: check.ms };
  if (check.error && check.error.code === 'ETIMEDOUT') {
    return { final: 'fail', stage: 'visual-check', reason: 'visual-check-timeout', results, tail: failureTail(check, resolved) };
  }
  const checkReceipt = parseReceipt(check);
  if (checkReceipt) results.visual_check.receipt = summarizeVisualCheck(checkReceipt);
  // Chrome 不可用（exit 2 / status=skipped）：保持 fail-closed，但给出可诊断的因由（不是把 skipped 当 pass）。
  if (checkReceipt && checkReceipt.status === 'skipped') {
    results.visual_check.status = 'skipped';
    return {
      final: 'fail', stage: 'visual-check', reason: 'visual-check-skipped', results,
      tail: '内核视觉检查被跳过（Chrome/Chromium 不可用）：' + String(checkReceipt.error || '未给出原因').slice(0, 200) +
        '\n处置：装 Chrome/Chromium 或设 ARCHIFY_CHROME 后重跑；本闸 fail-closed，不把 skipped 当 pass。',
    };
  }
  if (check.status !== 0) {
    results.visual_check.status = 'fail';
    return { final: 'fail', stage: 'visual-check', reason: 'visual-check-failed', results, tail: failureTail(check, resolved) + visualCheckNote(check) };
  }
  const checkIssue = receiptContractIssue(checkReceipt, { command: 'visual-check' });
  if (checkIssue || checkReceipt.status !== 'pass' || checkReceipt.ok !== true) {
    results.visual_check.status = 'fail';
    return {
      final: 'fail', stage: 'visual-check', reason: 'visual-check-receipt', results,
      tail: '视觉检查回执契约不符：' + (checkIssue || 'status=' + JSON.stringify(checkReceipt.status)) + '\n' + (failureTail(check, resolved) || '（内核无输出）'),
    };
  }
  // 子项与产物归属：四项子状态须全 pass；被检产物 sha256 须等于本次交付产物（旧产物冒充即在此拦下）。
  const checkFaceIssue = visualCheckReceiptIssue(checkReceipt, { deliveredSha256: delivered.sha256, deliveredBytes: delivered.bytes, outPath: outAbs });
  if (checkFaceIssue) {
    results.visual_check.status = 'fail';
    return {
      final: 'fail', stage: 'visual-check', reason: 'visual-check-artifact-mismatch', results,
      tail: '视觉检查自称成功但归属/子项不符：' + checkFaceIssue,
    };
  }
  // 视觉闸后复检：visual-check 读取并截图产物，跑完再算一次摘要——与交付摘要不同即证明产物被改写，
  // 此时「这份视觉证据」不再对应交付内容，必须 fail（不是 warning）。
  const afterCheck = fileDigest(outAbs);
  if (!afterCheck || afterCheck.sha256 !== delivered.sha256 || afterCheck.bytes !== delivered.bytes) {
    results.visual_check.status = 'fail';
    return {
      final: 'fail', stage: 'visual-check', reason: 'visual-check-artifact-modified', results,
      tail: '视觉检查运行期间产物被改写：交付时 sha256=' + delivered.sha256.slice(0, 12) + '/' + delivered.bytes + 'B，检后=' +
        (afterCheck ? afterCheck.sha256.slice(0, 12) + '/' + afterCheck.bytes + 'B' : '文件已不可读') + '（目标 ' + outAbs + '）',
    };
  }
  // visualReview 恒为 pending：自动证据不声称感知级复核；该字段原样转述，人工边界保留（见契约 §7）。
  return { final: 'pass', stage: null, reason: null, results, visualReview: checkReceipt.visualReview === undefined ? 'pending' : checkReceipt.visualReview };
}

// ---------- O5（2026-09-14 设计件 §2 O5）：逐闸运行历史 append-only ----------
// 立法动机（demo-b 实测）：闸运行历史被覆盖式写 /tmp 销毁，无法回溯「哪次哪个闸红了」；trace 层只记
// gate 成败、不落逐闸 detail。本函数把每次 gate 运行的逐闸结果 append 成一行 JSONL 到
// <atlas>/data/<project>/gate-detail.jsonl（只追加不覆盖，与使用方仓的 gate-history.jsonl 互不冲突）。
// 无 --sidecar / 无 atlas 语境 → 返回 null 不落盘（零副作用）；写失败降级返回 { appended:false, error }，
// 由调用方以回执字段披露，绝不阻断 gate 主结果。fail-fast 保留：已跑闸记 pass/fail，未跑闸记 skip（不丢）。
const DIRHASH_FILE_CAP = 256;
const DIRHASH_BYTE_CAP = 16 * 1024 * 1024;

function hashDirContents(dir) {
  const files = [];
  const walk = (d, rel) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) files.push({ rel: r, abs });
    }
  };
  try { walk(dir, ''); } catch { return null; }
  const h = crypto.createHash('sha256');
  let bytes = 0;
  let count = 0;
  let truncated = false;
  for (const f of files) {
    if (count >= DIRHASH_FILE_CAP || bytes >= DIRHASH_BYTE_CAP) { truncated = true; break; }
    let buf;
    try { buf = fs.readFileSync(f.abs); } catch { continue; }
    bytes += buf.length;
    count += 1;
    h.update(f.rel).update('\0').update(crypto.createHash('sha256').update(buf).digest('hex')).update('\n');
  }
  return { sha256: h.digest('hex'), files: count, truncated };
}

function fileSha256(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

// 图件所在仓的 HEAD（交对账用：这份闸结果是在哪个码状态上跑的）；无 git 仓 → null（不误报）。
function headOf(file) {
  const root = gitRepoRootOf(path.resolve(file));
  if (!root) return null;
  const r = gitSync(['-C', root, 'rev-parse', 'HEAD']);
  const sha = String(r.stdout || '').trim();
  return r.status === 0 && sha ? { repo: root, sha } : null;
}

export function appendGateDetail({ diagram, sidecar }, result) {
  if (!sidecar) return null;
  const ctx = resolveAtlasContext(sidecar, { hintPath: diagram ? path.dirname(path.resolve(diagram)) : null });
  if (!ctx) return null;
  const specDir = path.join(ctx.atlas, 'spec', ctx.project);
  const gates = {};
  for (const name of GATE_NAMES) {
    const r = result && result.results ? result.results[name] : null;
    gates[name] = r ? { status: r.status || (r.exit === 0 ? 'pass' : 'fail'), exit: r.exit === undefined ? null : r.exit, ms: r.ms === undefined ? null : r.ms }
      : { status: 'skip', exit: null, ms: null };
  }
  const entry = {
    ts: new Date().toISOString(),
    command: 'gate',
    atlas: ctx.atlas,
    project: ctx.project,
    projectSource: ctx.projectSource,
    diagram: diagram ? { path: path.resolve(diagram), sha256: fileSha256(diagram) } : null,
    specDir,
    specDirHash: fs.existsSync(specDir) ? hashDirContents(specDir) : null,
    head: diagram ? headOf(diagram) : null,
    gates,
    final: result ? result.final : null,
    stage: result && result.stage ? result.stage : null,
    reason: result && result.reason ? result.reason : null,
    visualReview: result && result.visualReview ? result.visualReview : null,
    totalExit: result && result.final === 'pass' ? 0 : 1,
  };
  try {
    return { path: appendJsonl(ctx.dataDir, 'gate-detail.jsonl', entry), appended: true, project: ctx.project, projectSource: ctx.projectSource };
  } catch (e) {
    return { path: path.join(ctx.dataDir, 'gate-detail.jsonl'), appended: false, error: e.message, project: ctx.project };
  }
}
