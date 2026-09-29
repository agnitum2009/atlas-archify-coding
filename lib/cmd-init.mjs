// init 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { scaffoldAtlas } from './init.mjs';
import { parseArgs, diag, printAndExit, sidecarOpFailure } from './cli-util.mjs';

export function runInit(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.init);
  } catch (e) {
    printAndExit(failed('init', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    if (!args.dir || !args.title) {
      printAndExit(failed('init', [diag('bad_args', '需要 --dir 与 --title', 'init')]), 1);
      return;
    }
    const template = args.template || 'minimal';
    if (template !== 'minimal' && template !== 'demo') {
      // fail-loud：未知模板名不得静默降级到缺省；用户输入校验失败按总纲归 exit 1（2026-08-15 裁定，2=internal）。
      printAndExit(failed('init', [diag('unknown_template', '未知模板：' + template + '（可用：minimal | demo）', template)]), 1);
      return;
    }
    const result = scaffoldAtlas(args.dir, {
      title: args.title,
      diagramType: args['diagram-type'] || 'architecture',
      // 0.7.0（holdout 缺陷3）：diagramId 不在这里兜底——scaffoldAtlas 内部缺省 'main' 并用
      // 「显式 --diagram-id 首段 / 缺省 --dir basename」派生项目名（零新旗标），派生结果随回执 data.project 返回。
      diagramId: args['diagram-id'],
      template,
    });
    printAndExit(ok('init', result), 0);
  } catch (e) {
    if (e.code === 'atlas_exists') {
      printAndExit(failed('init', [diag('atlas_exists', e.message, args.dir)]), 1);
      return;
    }
    if (e.code === 'bad_args') {
      // 项目名派生为空（清洗后无 [a-z0-9] 字符）：用户输入校验失败，非 internal。
      printAndExit(failed('init', [diag('bad_args', e.message, args.dir)]), 1);
      return;
    }
    if (sidecarOpFailure('init', e)) return;
    printAndExit(failed('init', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
