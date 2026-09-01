#!/usr/bin/env node
// atlas-engine CLI — P2 第一刀：state 命令（三轴状态机 + 五公理硬门禁）。
// D4（2026-08-15 清单）：本文件收敛为薄壳——命令分发与帮助文本单一来源 = lib/commands.mjs 注册表
// （{ name, usage, run }；帮助行与实现同处，防 help 与实现漂移复发）；共享助手 = lib/cli-util.mjs。
// 主体职责：--help 短路 + 注册表查找 + 顶层 catch（内部错误 fail-loud）。
// 0.10.0（holdout #2 P2b）：未知顶层命令 = 用户输入校验失败，exit 1 / rule=unknown_subcommand（复用既有码），
// 不再悬 internal/exit 2（用户拼错被归「内部错误」属归类错误；破坏性类型 (b)——改变既有退出码语义，RELEASES 如实标注）。

import { COMMANDS, buildUsage } from '../lib/commands.mjs';
import { ok, failed } from '../lib/envelope.mjs';
import { diag, printAndExit, sidecarOpFailure } from '../lib/cli-util.mjs';

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(buildUsage() + '\n');
    return;
  }
  const [group] = argv;
  const entry = COMMANDS.find((c) => c.name === group);
  if (!entry) {
    printAndExit(failed('atlas-engine', [diag('unknown_subcommand', '未知命令：' + group + '（当前支持 ' + COMMANDS.map((c) => c.name).join('/') + '；用法见 --help）', group)]), 1);
    return;
  }
  entry.run(argv.slice(1));
}

try {
  main();
} catch (e) {
  // 顶层 catch 无函数包裹，不能 return：仅当非可操作运行态时才悬 internal。
  if (!sidecarOpFailure('atlas-engine', e)) {
    printAndExit(failed('atlas-engine', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}
