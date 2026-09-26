// trace 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { saveSidecar } from './store.mjs';
import { addTrace, listTraces, replayNode, parseSince } from './trace.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, sidecarOpFailure, loadSidecarOrFail } from './cli-util.mjs';

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
    if (e.code === 'bad_kind' || e.code === 'node_not_found') {
      printAndExit(failed(cmd, [diag(e.code, e.message, cmd)]), 1);
      return;
    }
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
