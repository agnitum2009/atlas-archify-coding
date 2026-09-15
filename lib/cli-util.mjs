// CLI 共享助手（D4 重构 2026-08-15：从 bin 迁出，单一来源，不复制代码）。
// 服务对象：bin 薄壳 + lib/commands.mjs 全部命令 run。

import { ok, failed } from './envelope.mjs';
import { loadSidecar, saveSidecar, canonicalSidecarPath } from './store.mjs';
import { addTrace } from './trace.mjs';
import { ENGINE_VERSION } from './version.mjs';
import { OPTIONS } from './cli-options.mjs';

// 保留既有读方导出；类型和键名统一取自 cli-options.mjs。
export { BOOLEAN_FLAGS } from './cli-options.mjs';

// 旗标白名单 fail-loud；命令注册表的 flags 与解析类型都从 OPTIONS 派生。
// '--' 开头的一切 token 必须先过白名单：未登记 = 抛错（命令层转 exit 1 bad_args，消息带未知旗标名 + 该命令合法旗标清单），
// 杜绝 typo（如 --sidcar）静默新建平行账本；白名单未列的布尔旗标同样被拒（如 init --no-trace）。
export function parseArgs(argv, allowedFlags) {
  const allowed = allowedFlags ? new Set(allowedFlags) : null;
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error('无法识别的参数：' + token);
    }
    const key = token.slice(2);
    if (allowed && !allowed.has(key)) {
      throw new Error('未知旗标：--' + key + '；该命令合法旗标：' + [...allowed].map((f) => '--' + f).join(' '));
    }
    const option = Object.prototype.hasOwnProperty.call(OPTIONS, key) ? OPTIONS[key] : null;
    if (option?.type === 'boolean') {
      const explicit = option.legacyBooleanValue && ['true', 'false'].includes(argv[i + 1]);
      args[option.key] = explicit ? argv[++i] === 'true' : true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('缺少参数值：--' + key);
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      // 可重复参数（如 report --spec a --spec b）：重复出现聚合为数组；单次传入保持字符串。
      args[key] = [].concat(args[key], value);
    } else {
      args[key] = value;
    }
    i += 1;
    continue;
  }
  return args;
}

export function sidecarPathOf(args) {
  // 唯一入口：所有命令经此取侧车路径，且一律取规范化真实路径（symlink 侧车不因 rename 断链、
  // 门禁/配置/锁与写入指向同一文件；见 store.canonicalSidecarPath 的边界说明）。
  return canonicalSidecarPath(args.sidecar || 'atlas-state.json');
}

export function printAndExit(receipt, exitCode) {
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  process.exitCode = exitCode;
}

export function requireArgs(args, names) {
  for (const name of names) {
    if (!args[name]) {
      const error = new Error('缺少必填参数：--' + name);
      error.code = 'bad_args';
      throw error;
    }
  }
}

export function diag(rule, message, subject) {
  return { rule, severity: 'error', subject, evidence: message, supportedFixes: [] };
}

// B4（2026-08-15 清单）：settle 成功 / A3 拦截失败 / gate fail 回执附回写提示（与 data.next 同模式纯增字段）。
export const LESSON_PROMPT = '本刀有无新教训？有则 lessons add 回写（S5a 欠账教训）';

// 提案④（2026-08-15 裁定）：set 违 A2 表失败消息固定后缀——注明 set 现过 A2 校验并给纠错出口。
export const SET_A2_SUGGEST = '；set 现过 A2 校验（2026-08-15 裁定④）；确属纠错请加 --correction';

// B1 自动留痕（2026-08-15 清单，demo-harness 启示=工具调用零成本留痕）：gate/compile/report 运行后（成败均记）
// 向侧车追加一条 kind='command' 事件，detail={ command, params, result }。
// state set/transition/evidence-add/settle/block 不自动记——history 账已覆盖，重复会污染 replay 三源合并（契约 §8）。
// 降级纪律：--no-trace 关闭；无 --sidecar 且无预载侧车不记（保持原行为）；留痕失败只回 warning 诊断，绝不阻断主结果。
export function autoTrace(command, args, entry, preloaded) {
  if (args.noTrace) return null;
  const sidecarPath = args.sidecar ? canonicalSidecarPath(args.sidecar) : null;
  if (!preloaded && !sidecarPath) return null;
  try {
    const sc = preloaded || loadSidecar(sidecarPath);
    addTrace(sc, {
      kind: 'command',
      actor: 'atlas-engine',
      note: entry.note || command,
      node: entry.node || null,
      detail: { engine: ENGINE_VERSION, command, params: entry.params || {}, result: entry.result || {} },
    });
    saveSidecar(preloaded ? (sidecarPath || 'atlas-state.json') : sidecarPath, sc);
    return null;
  } catch (e) {
    return { rule: 'trace_degraded', severity: 'warning', subject: command, evidence: '自动留痕失败（降级不阻断主结果）：' + e.message, supportedFixes: [] };
  }
}

// 可操作运行态（契约附录 A）：CAS 冲突 / 写锁超时 / 只读拒写 / 写失败 / 已提交耐久未知不是 internal——
// exit 1 failed、rule=自身错误码；已打印则返回 true。提交边界随回执机器可读下发
// （data.commit = {committed, revision, durability, path}；data.holder = 锁持有者诊断），调用方不必解析文案。
const SIDECAR_OP_CODES = new Set([
  'sidecar_conflict',
  'sidecar_locked',
  'sidecar_readonly',
  'sidecar_write_failed',
  'sidecar_lock_failed',
  'sidecar_commit_unknown',
  'sidecar_path_unresolvable',
  'sidecar_hardlinked',
]);

export function sidecarOpFailure(cmd, e) {
  if (!e || !SIDECAR_OP_CODES.has(e.code)) return false;
  const data = {};
  if (e.committed === true || e.committed === false) {
    data.commit = {
      committed: e.committed,
      revision: e.revision === undefined ? null : e.revision,
      durability: e.durability === undefined ? null : e.durability,
      path: e.path === undefined ? null : e.path,
    };
  }
  if (e.holder !== undefined) data.holder = e.holder;
  printAndExit(failed(cmd, [diag(e.code, e.message, cmd)], Object.keys(data).length > 0 ? data : undefined), 1);
  return true;
}

export function loadSidecarOrFail(cmd, path) {
  try {
    return loadSidecar(path);
  } catch (e) {
    // 0.12.0（实战反馈档-2026-08-23 P0-1，glm/reviewer-B 交叉验证双席背书）：sidecar_missing 不再静默造空账。
    // 修复前此处对 trace/lessons/notice 凭空返回空账本（且契约附录 A 曾成文该行为）——实战后果：
    // 112 条经验 + 59 条未读通知被隐藏整个战役周期（vacuous green 家族：凭空造账比空态措辞更糟）。
    // 不取缺省解析链方案：向上搜索会静默挂上错误账本（父项目侧车），错账污染 > 空账不可见。
    const fixes = e.code === 'sidecar_missing'
      ? ['显式传 --sidecar <path> 指向真实账本', '新账本用 atlas-engine init 创建']
      : [];
    const d = diag(e.code || 'sidecar_error', e.message, path);
    d.supportedFixes = fixes;
    printAndExit(failed(cmd, [d]), 1);
    return null;
  }
}
