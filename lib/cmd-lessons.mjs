// lessons 命令实现（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { ok, failed } from './envelope.mjs';
import { saveSidecar } from './store.mjs';
import { addLesson, listLessons, retireLesson } from './lessons.mjs';
import { parseArgs, diag, printAndExit, sidecarPathOf, sidecarOpFailure, loadSidecarOrFail } from './cli-util.mjs';

export function runLessons(argv) {
  const sub = argv[0] || 'add';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.lessons);
  } catch (e) {
    printAndExit(failed('lessons.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'lessons.' + sub;
  const sidecarPath = sidecarPathOf(args);
  const sidecar = loadSidecarOrFail(cmd, sidecarPath);
  if (!sidecar) return;
  try {
    if (sub === 'add') {
      const item = addLesson(sidecar, { lesson: args.lesson, rule: args.rule || null, source: args.source || null });
      saveSidecar(sidecarPath, sidecar);
      printAndExit(ok(cmd, { item }), 0);
      return;
    }
    if (sub === 'list') {
      const lessons = listLessons(sidecar, { includeRetired: !!args.all, recent: args.recent === undefined ? null : Number(args.recent), rule: args.rule || null });
      // A1：total 报全量（含 retired，D3），filtered=返回列表是否被截断/过滤；缺省无 retired 时行为与既有一致。
      const total = (sidecar.lessons || []).length;
      printAndExit(ok(cmd, { count: lessons.length, total, filtered: lessons.length < total, lessons }), 0);
      return;
    }
    if (sub === 'retire') {
      if (!args.id) {
        printAndExit(failed(cmd, [diag('bad_args', '需要 --id', cmd)]), 1);
        return;
      }
      // D3（2026-08-15 清单）：置 retired，幂等；回执 data.item 含新状态；未知 id = lesson_not_found。
      const item = retireLesson(sidecar, args.id);
      saveSidecar(sidecarPath, sidecar);
      printAndExit(ok(cmd, { item }), 0);
      return;
    }
    printAndExit(failed(cmd, [diag('unknown_subcommand', '未知子命令：' + sub, sub)]), 1);
  } catch (e) {
    if (e.code === 'empty_lesson' || e.code === 'lesson_not_found' || e.code === 'bad_args') {
      printAndExit(failed(cmd, [diag(e.code, e.message, cmd)]), 1);
      return;
    }
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
