// doctor 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { runDoctor } from './doctor.mjs';
import { parseArgs, diag, printAndExit } from './cli-util.mjs';

export function runDoctorCli(argv) {
  let dargs;
  try {
    dargs = parseArgs(argv, FLAGS.doctor);
  } catch (e) {
    printAndExit(failed('doctor', [diag('bad_args', e.message, ['doctor', ...argv].join(' '))]), 1);
    return;
  }
  // 批二：--stats 需显式 --sidecar（度量全部派生自账本侧车，无侧车无账可统计）。
  if (dargs.stats && !dargs.sidecar) {
    printAndExit(failed('doctor', [diag('bad_args', '--stats 需要 --sidecar <path>（派生度量全部来自账本侧车）', 'doctor --stats')]), 1);
    return;
  }
  const result = runDoctor({ sidecar: dargs.sidecar || null, atlas: dargs.atlas || null, stats: !!dargs.stats });
  // warning 级检查（evidence-resolvability / ledger-size）ok:false 不使 doctor exit 1——
  // 数据债不阻断环境自检（契约 §10）；failed 信封 diagnostics 只列 error 级不通过的检查。
  const failing = result.checks.filter((c) => !c.ok && !c.warning);
  if (failing.length === 0) {
    printAndExit(ok('doctor', result), 0);
  } else {
    // 0.7.0（holdout 缺陷2）：失败路径把 data 传进 failed()——0.4.0 起信封已支持可选 data 参数，
    // 此前没传，atlas-layout 的「详见 data.layout.diagnostics」在失败时指向不存在位置（恰在出错时藏明细）。
    printAndExit(failed('doctor', failing, result), 1);
  }
}
