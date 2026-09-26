// diff 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import fs from 'node:fs';
import { ok, failed } from './envelope.mjs';
import { loadSidecar } from './store.mjs';
import { diffSpecs, stateTimeline } from './diff.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, sidecarOpFailure } from './cli-util.mjs';

export function runDiff(argv) {
  const sub = argv[0] || 'spec';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.diff);
  } catch (e) {
    printAndExit(failed('diff.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'diff.' + sub;
  try {
    if (sub === 'spec') {
      if (!args.base || !args.head) {
        printAndExit(failed(cmd, [diag('bad_args', '需要 --base 与 --head', cmd)]), 1);
        return;
      }
      let base, head;
      try {
        base = JSON.parse(fs.readFileSync(args.base, 'utf8'));
        head = JSON.parse(fs.readFileSync(args.head, 'utf8'));
      } catch (e) {
        printAndExit(failed(cmd, [diag('bad_input', 'spec 读取或解析失败：' + e.message, cmd)]), 1);
        return;
      }
      const result = diffSpecs(base, head);
      printAndExit(ok(cmd, result), 0);
      return;
    }
    if (sub === 'state') {
      const sidecarPath = sidecarPathOf(args);
      let sidecar;
      try {
        sidecar = loadSidecar(sidecarPath);
      } catch (e) {
        printAndExit(failed(cmd, [diag(e.code || 'sidecar_error', e.message, sidecarPath)]), 1);
        return;
      }
      const rows = stateTimeline(sidecar, args.since || null);
      printAndExit(ok(cmd, { count: rows.length, since: args.since || null, rows }), 0);
      return;
    }
    printAndExit(failed(cmd, [diag('unknown_subcommand', '未知子命令：' + sub, sub)]), 1);
  } catch (e) {
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
