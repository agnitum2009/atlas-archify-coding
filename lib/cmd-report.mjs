// report 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ok, failed } from './envelope.mjs';
import { loadSidecar } from './store.mjs';
import { buildReport } from './report.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, autoTrace, sidecarOpFailure } from './cli-util.mjs';

export function runReport(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.report);
  } catch (e) {
    printAndExit(failed('report', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    const sidecarPath = sidecarPathOf(args);
    let sidecar;
    try {
      sidecar = loadSidecar(sidecarPath);
    } catch (e) {
      printAndExit(failed('report', [diag(e.code || 'sidecar_error', e.message, sidecarPath)]), 1);
      return;
    }
    let verify = null;
    if (args.verify) {
      try {
        verify = JSON.parse(fs.readFileSync(args.verify, 'utf8'));
      } catch (e) {
        printAndExit(failed('report', [diag('bad_verify', 'verify 文件不可读或非 JSON：' + e.message, args.verify)]), 1);
        return;
      }
    }
    // --spec 可重复：聚合全部 archify spec 后启用 A1 图码对账；未传则行为与现状完全一致。
    // specNames（图名=basetname 去扩展名）随 spec 一起传入：diagram-nonaccounts.json 的分组键与 specRefs 的
    // 图限定都按图名解析（缺陷4：跨图同局部 ID 误豁免）。
    const specs = [];
    const specNames = [];
    if (args.spec !== undefined) {
      for (const file of [].concat(args.spec)) {
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
          printAndExit(failed('report', [diag('bad_spec', 'spec 读取或解析失败：' + file + '：' + e.message, file)]), 1);
          return;
        }
        specs.push(parsed);
        specNames.push(path.basename(String(file)).replace(/\.json$/, ''));
      }
    }
    // 非账本实体声明与侧车同目录（同 projects.json 模式）：<侧车目录>/diagram-nonaccounts.json，无文件=零破坏。
    const nonAccountsPath = sidecarPath.replace(/[^/]*$/, '') + 'diagram-nonaccounts.json';
    const report = buildReport(sidecar, { slice: args.slice || null, root: args.root || '.', verify, codeSha: args['code-sha'] || null, specSha: args['spec-sha'] || null, specs, specNames, replays: args.replay === undefined ? [] : [].concat(args.replay), brief: !!args.brief, nonAccountsPath });
    // B1：report 原为只读命令，现默认向侧车留痕（CAS revision 推进；契约 §6 语义变化明示）；--slice 时锚定该节点。
    // A3：--brief 时 warnings 降为计数，取数兼容。
    const warnCount = Array.isArray(report.warnings) ? report.warnings.length : report.warnings;
    const traceEntry = {
      params: { slice: args.slice || '*', specs: specs.length },
      result: { errors: report.errors.length, warnings: warnCount },
      node: args.slice || null,
      note: 'report errors=' + report.errors.length + ' warnings=' + warnCount,
    };
    if (report.errors.length > 0) {
      const warn = autoTrace('report', args, traceEntry, sidecar);
      const diagnostics = warn ? [...report.errors, warn] : report.errors;
      if (warn) {
        if (Array.isArray(report.warnings)) report.warnings.push(warn);
        else report.warnings += 1;
      }
      // 失败信封仍携带 a1 小节（检查范围/计数/nonClaims），不伪装成功。
      // A3：--brief 时失败信封同样携带计数摘要（与成功路径同形，data 只出计数+error，不重复 warning 明细）。
      // O2（2026-09-14）：失败信封必须同时携带 evidenceHead——HEAD 不一致本就是失败因由之一，
      // 恰在出错时藏明细会重演 0.4.0「详见 data.layout.diagnostics 但 data 不存在」的缺陷。
      // 0.21.1：非 brief 失败信封补 warnings 全文——存量统计仪器（cross_axis_unlisted 等）恰在
      // 账本不健康时最需要可见，失败时吞明细会重演 0.4.0「藏明细」缺陷（evidenceHead 已修同型问题）；
      const failData = args.brief ? report : Object.assign(
        report.a1 ? { a1: report.a1 } : {},
        { evidenceHead: report.evidenceHead, warnings: report.warnings }
      );
      printAndExit(failed('report', diagnostics, failData), 1);
      return;
    }
    const warn = autoTrace('report', args, traceEntry, sidecar);
    const receipt = ok('report', report);
    if (warn) receipt.diagnostics = [warn];
    printAndExit(receipt, 0);
  } catch (e) {
    if (sidecarOpFailure('report', e)) return;
    printAndExit(failed('report', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
