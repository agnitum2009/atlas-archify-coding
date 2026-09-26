// compile 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { compileFiles } from './compile.mjs';
import { parseArgs, diag, printAndExit, autoTrace, sidecarOpFailure } from './cli-util.mjs';

export function runCompile(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.compile);
  } catch (e) {
    printAndExit(failed('compile', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    if (!args.diagram || !args.sidecar || !args.out) {
      printAndExit(failed('compile', [diag('bad_args', '需要 --diagram --sidecar --out', 'compile')]), 1);
      return;
    }
    const result = compileFiles(args.diagram, args.sidecar, args.out, { previousReceiptPath: args['previous-receipt'] ?? null });
    const warn = autoTrace('compile', args, {
      params: { diagram: args.diagram, sidecar: args.sidecar, out: args.out },
      result: { injected: result.injected, sha256: result.sha256 },
      note: 'compile 注入节点数=' + result.injected.tags,
    });
    const receipt = ok('compile', result);
    if (warn) receipt.diagnostics = [warn];
    printAndExit(receipt, 0);
  } catch (e) {
    if (e.code === 'bad_input') {
      const warn = autoTrace('compile', args, {
        params: { diagram: args.diagram, sidecar: args.sidecar, out: args.out },
        result: { error: e.message },
        note: 'compile 失败：' + e.message,
      });
      const diags = [diag('bad_input', e.message, 'compile')];
      if (warn) diags.push(warn);
      printAndExit(failed('compile', diags), 1);
      return;
    }
    if (sidecarOpFailure('compile', e)) return;
    printAndExit(failed('compile', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
