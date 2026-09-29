// notice 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { saveSidecar } from './store.mjs';
import { addNotice, listNotices, ackNotices } from './notice.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, sidecarOpFailure, loadSidecarOrFail } from './cli-util.mjs';

// B3（2026-08-15 清单）：notice 命令组——席位间主动通知（list/ack/add）。
export function runNotice(argv) {
  const sub = argv[0] || 'list';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.notice);
  } catch (e) {
    printAndExit(failed('notice.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'notice.' + sub;
  const sidecarPath = sidecarPathOf(args);
  const sidecar = loadSidecarOrFail(cmd, sidecarPath);
  if (!sidecar) return;
  try {
    if (sub === 'list') {
      const notices = listNotices(sidecar, args.seat || null);
      const data = { count: notices.length, notices };
      if (args.seat) {
        data.seat = args.seat;
        data.unreadOnly = true;
      }
      printAndExit(ok(cmd, data), 0);
      return;
    }
    if (sub === 'ack') {
      if (!args.seat) {
        printAndExit(failed(cmd, [diag('bad_seat', 'notice ack 必须带 --seat <席位名>（确认语义具名到席位）', cmd)]), 1);
        return;
      }
      const result = ackNotices(sidecar, args.seat, args.id || null);
      saveSidecar(sidecarPath, sidecar);
      printAndExit(ok(cmd, { seat: args.seat, confirmed: result.confirmed, ids: result.ids }), 0);
      return;
    }
    if (sub === 'add') {
      const missing = ['kind', 'node', 'summary', 'from'].filter((k) => !args[k]);
      if (missing.length > 0) {
        printAndExit(failed(cmd, [diag('bad_args', '缺少必填参数：' + missing.map((k) => '--' + k).join(' '), cmd)]), 1);
        return;
      }
      // settled|blocked 为 settle/block 自动投递专属，手动伪造拒絶（契约 §11）。
      if (args.kind !== 'note') {
        printAndExit(failed(cmd, [diag('bad_kind', 'notice add 只接受 --kind note（settled|blocked 由 settle/block 自动投递）', args.kind)]), 1);
        return;
      }
      const notice = addNotice(sidecar, { kind: args.kind, node: args.node, summary: args.summary, from: args.from });
      saveSidecar(sidecarPath, sidecar);
      printAndExit(ok(cmd, { notice }), 0);
      return;
    }
    printAndExit(failed(cmd, [diag('unknown_subcommand', '未知子命令：' + sub, sub)]), 1);
  } catch (e) {
    if (e.code === 'bad_kind' || e.code === 'empty_summary' || e.code === 'bad_seat' || e.code === 'notice_not_found') {
      printAndExit(failed(cmd, [diag(e.code, e.message, cmd)]), 1);
      return;
    }
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
