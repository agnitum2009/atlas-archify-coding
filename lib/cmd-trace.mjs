// trace 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
// 0.24.0 增 import / order：轨迹回溯只读派生，不写侧车；harness 原始日志经 scripts/ 转换器规整后导入。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { saveSidecar } from './store.mjs';
import { addTrace, listTraces, replayNode, parseSince } from './trace.mjs';
import { importEvents, readEvents, projectRepo, gitCommits } from './trajectory.mjs';
import { discoverRepos, computeWorkspaceOrder, briefOrder } from './trajectory-workspace.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, sidecarOpFailure, loadSidecarOrFail } from './cli-util.mjs';

const TRAJECTORY_CODES = new Set(['trajectory_source_unreadable', 'trajectory_bad_event', 'trajectory_no_atlas', 'project_source_missing', 'project_source_not_git']);

function traceImport(cmd, args, sidecarPath) {
  if (!args.source) {
    printAndExit(failed(cmd, [diag('bad_args', '需要 --source <规整事件 JSONL>（harness 原始日志先经 scripts/ 下转换器规整）', cmd)]), 1);
    return;
  }
  printAndExit(ok(cmd, importEvents(sidecarPath, args.source)), 0);
}

function traceOrder(cmd, args, sidecarPath, sidecar) {
  const sinceErr = parseSince(args.since);
  if (sinceErr) {
    printAndExit(failed(cmd, [diag('bad_args', sinceErr, cmd)]), 1);
    return;
  }
  if (args.node && !Object.prototype.hasOwnProperty.call(sidecar.nodes || {}, args.node)) {
    printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
    return;
  }
  const sourceRoot = projectRepo(sidecarPath);
  // 参与仓由证据锚推出（sourcePath 内的顶层 + 嵌套仓）；每仓提交一律取全史，--since 只在计算内收窄输出。
  const repos = discoverRepos(sourceRoot, sidecar).map((r) => ({ ...r, commits: gitCommits(r.root, null) }));
  const since = args.since ? Date.parse(args.since) : null;
  const events = readEvents(sidecarPath).filter((e) => since === null || Date.parse(e.at) >= since);
  const data = computeWorkspaceOrder({ sidecar, sourceRoot, repos, events, focusNode: args.node || null, sinceIso: args.since || null });
  printAndExit(ok(cmd, args.brief ? briefOrder(data) : data), 0);
}

export function runTrace(argv) {
  const sub = argv[0] || 'add';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.trace);
  } catch (e) {
    printAndExit(failed('trace.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'trace.' + sub;
  const sidecarPath = sidecarPathOf(args);
  const sidecar = loadSidecarOrFail(cmd, sidecarPath);
  if (!sidecar) return;
  try {
    if (sub === 'import') return traceImport(cmd, args, sidecarPath);
    if (sub === 'order') return traceOrder(cmd, args, sidecarPath, sidecar);
    if (sub === 'add') {
      if (!args.kind) {
        printAndExit(failed(cmd, [diag('bad_args', '需要 --kind（tool_call|decision|diagram_diff|evidence|ruling|command）', cmd)]), 1);
        return;
      }
      const event = addTrace(sidecar, { kind: args.kind, actor: args.actor, note: args.note, node: args.node || null });
      saveSidecar(sidecarPath, sidecar);
      printAndExit(ok(cmd, { event, anchors: { node: event.node, relation: 'anchors' } }), 0);
      return;
    }
    if (sub === 'list') {
      const sinceErr = parseSince(args.since);
      if (sinceErr) {
        printAndExit(failed(cmd, [diag('bad_args', sinceErr, cmd)]), 1);
        return;
      }
      const events = listTraces(sidecar, args.node || null, args.since || null);
      printAndExit(ok(cmd, { count: events.length, events }), 0);
      return;
    }
    if (sub === 'replay') {
      if (!args.node) {
        printAndExit(failed(cmd, [diag('bad_args', '需要 --node', cmd)]), 1);
        return;
      }
      const sinceErr = parseSince(args.since);
      if (sinceErr) {
        printAndExit(failed(cmd, [diag('bad_args', sinceErr, cmd)]), 1);
        return;
      }
      const timeline = replayNode(sidecar, args.node, args.since || null);
      if (!timeline) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      printAndExit(ok(cmd, timeline), 0);
      return;
    }
    printAndExit(failed(cmd, [diag('unknown_subcommand', '未知子命令：' + sub, sub)]), 1);
  } catch (e) {
    if (e.code === 'bad_kind' || e.code === 'node_not_found' || TRAJECTORY_CODES.has(e.code)) {
      printAndExit(failed(cmd, [diag(e.code, e.message, cmd)]), 1);
      return;
    }
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
