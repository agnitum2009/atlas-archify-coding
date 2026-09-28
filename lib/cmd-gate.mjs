// gate 命令实现（含 --out 落点诊断）（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ok, failed } from './envelope.mjs';
import { runGate, appendGateDetail, gateNamesFor } from './gate.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, autoTrace, sidecarOpFailure, LESSON_PROMPT } from './cli-util.mjs';

// gate --out 落点提示（0.10.0，holdout #2 P0）：--out 父目录正好是某 atlas 的 artifacts/<项目>/ 根
// （祖父目录名==artifacts 且图谱根下有 spec/<项目>/）时，gate 与 visual-check 的全部生成物直落项目根，
// doctor --atlas 立刻报布局 P2 error——照官方快乐路径做会把自家 atlas 打成 failed 而 gate 全程零提示。
// 处置 = 回执 diagnostics 追加 warning（建议落点 artifacts/<项目>/<模块>-<YYMMDD>/，日期取当天），
// 不阻断、不改退出码、不自动移动文件（移动用户指定的输出路径太越权）。
export function gateOutPlacementDiag(outPath) {
  const parent = path.dirname(path.resolve(outPath));
  const grand = path.dirname(parent);
  if (path.basename(grand) !== 'artifacts') return null;
  const project = path.basename(parent);
  if (project === 'artifacts') return null; // 直落 artifacts/ 根本身是另一形态，P2 校验已咬
  const atlasRoot = path.dirname(grand);
  if (!fs.existsSync(path.join(atlasRoot, 'spec', project))) return null; // 非 atlas 项目根（路径撞名）不报
  const now = new Date();
  const stamp = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  return diag('gate_out_placement',
    '--out 直落 atlas 的 artifacts/' + project + '/ 项目根——gate 与 visual-check 生成物散置项目根会触发布局 P2（doctor --atlas 判 error）；建议落点 artifacts/' + project + '/<模块>-' + stamp + '/（模块目录 <模块>-<YYMMDD>，日期取当天）',
    outPath, 'warning',
    ['把 --out 改到 artifacts/' + project + '/<模块>-' + stamp + '/ 下（如 artifacts/' + project + '/main-' + stamp + '/out.html）']);
}

export function runGateCli(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.gate);
  } catch (e) {
    printAndExit(failed('gate', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    if (!args.diagram || !args.out) {
      printAndExit(failed('gate', [diag('bad_args', '需要 --diagram --out', 'gate')]), 1);
      return;
    }
    const result = runGate(args.diagram, args.out);
    // O5（2026-09-14 设计件 §2 O5）：逐闸 detail 落 <atlas>/data/<project>/gate-detail.jsonl
    // （append-only，成败均落）；--no-trace 关闭（与自动留痕同开关）；无 --sidecar / 非 atlas 语境 → null。
    const detailLog = args.noTrace ? null : appendGateDetail({ diagram: args.diagram, sidecar: args.sidecar ? sidecarPathOf(args) : null }, result);
    const gates = {};
    const gateDetail = {};
    for (const [k, v] of Object.entries(result.results || {})) {
      gates[k] = v.exit;
      // O5：逐闸 detail 同时入 trace（kind=command 的 detail.result，纯增字段；JSONL 才是 append-only 主账）。
      gateDetail[k] = { status: v.status, exit: v.exit, ms: v.ms === undefined ? null : v.ms };
    }
    for (const name of gateNamesFor(result.kernel ? result.kernel.profile : null)) {
      if (!gateDetail[name]) gateDetail[name] = { status: 'skip', exit: null, ms: null };
    }
    const traceEntry = {
      params: { diagram: args.diagram, out: args.out },
      result: { final: result.final, stage: result.stage, gates, gateDetail, detailLog: detailLog ? detailLog.path : null },
      note: 'gate final=' + result.final + (result.stage ? ' stage=' + result.stage : ''),
    };
    if (result.final === 'pass') {
      const trace = autoTrace('gate', args, traceEntry);
      const receipt = ok('gate', Object.assign({}, result, detailLog ? { detailLog } : {}));
      const diags = [];
      if (trace) diags.push(trace);
      const placement = gateOutPlacementDiag(args.out);
      if (placement) diags.push(placement);
      if (diags.length > 0) receipt.diagnostics = diags;
      printAndExit(receipt, 0);
    } else {
      const trace = autoTrace('gate', args, traceEntry);
      // 机读因由（缺陷7）：失败细分因由进规则码（gate_<reason>）与 data，不只停在 stage——
      // 「内核退出码失败 / 回执契约不符 / 超时 / 产物归属不符 / Chrome 不可用」形状各异，规则码须可分辨。
      const reason = result.reason || result.stage;
      const diags = [diag('gate_' + reason, '三闸停在 ' + result.stage + '：' + (result.tail || result.diagnostic || ''), result.stage)];
      if (trace) diags.push(trace);
      const placement = gateOutPlacementDiag(args.out);
      if (placement) diags.push(placement);
      // B4：gate fail 回执附回写提示（纯增 data 字段）；O5：逐闸历史落点一并披露（写失败降级不阻断）。
      const failData = Object.assign(
        { lessonPrompt: LESSON_PROMPT, final: result.final, stage: result.stage, reason: result.reason || null },
        detailLog ? { detailLog } : {},
      );
      printAndExit(failed('gate', diags, failData), 1);
    }
  } catch (e) {
    if (sidecarOpFailure('gate', e)) return;
    printAndExit(failed('gate', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
