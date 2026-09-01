// 命令注册表（D4 重构 2026-08-15：从 bin 迁入的命令分发逻辑 + 帮助文本单一来源）。
// 约定：每命令一条 { name, usage（帮助行数组，--help 拼装源）, flags（合法旗标白名单，批一#2 机器校验源）, run(argv) }；
// run 收到的 argv = 去除顶级命令名后的剩余参数。帮助文本只由此处 usage 字段生成（防 help 与实现漂移复发）。
// 0.10.0：十命令——evidence 顶层命令与 lessons hit 子命令按两段式废弃政策第二阶段物理移除（承诺见 0.9.0；
// 理由与替代路径入 RELEASES [0.10.0] Breaking 节；hits 字段与既有数据保留，只删写入口）。

// 旗标白名单（增长控制开发规范批一#2，2026-08-15）：合法旗标的机器可校验单一来源——usage 文本给人看，flags 给机器查。
// 粒度 = 命令组统一并集（state/diff/trace/lessons/notice 的子命令共用命令组白名单；契约「治理」节写明）。
// parseArgs 第二参逐命令传入；契约保鲜门禁对账：命令数 ≤11（当前 10）（0.10.0 移除 evidence 后由 11 收回）、全仓唯一旗标 ≤50、flags ⊆ usage ∪ 契约节。
const FLAGS = {
  init: ['dir', 'title', 'template', 'diagram-type', 'diagram-id'],
  state: ['node', 'axis', 'value', 'reason', 'owner', 'receipt', 'correction', 'sidecar', 'locator', 'from', 'to', 'with-backlog', 'kind'],
  diff: ['base', 'head', 'sidecar', 'since'],
  compile: ['diagram', 'sidecar', 'out', 'no-trace'],
  report: ['slice', 'sidecar', 'root', 'verify', 'code-sha', 'spec-sha', 'spec', 'replay', 'brief', 'no-trace'],
  gate: ['diagram', 'out', 'sidecar', 'no-trace'],
  trace: ['kind', 'actor', 'note', 'node', 'sidecar', 'since'],
  lessons: ['lesson', 'rule', 'source', 'sidecar', 'all', 'recent', 'id'],
  notice: ['seat', 'id', 'sidecar', 'kind', 'node', 'summary', 'from'],
  doctor: ['sidecar', 'atlas', 'stats'],
};

import fs from 'node:fs';
import path from 'node:path';
import { isAxis, isValidState, validateTransition, validateSetWrite } from './state-machine.mjs';
import { checkTruthReceipt, recordTruthReceipt } from './truth-receipt.mjs';
import { ok, failed } from './envelope.mjs';
import { loadSidecar, saveSidecar, findNode, ensureNode, appendHistory } from './store.mjs';
import { lintLocator, absoluteLocator, computeLocatorHash } from './evidence.mjs';
import { scaffoldAtlas } from './init.mjs';
import { diffSpecs, stateTimeline } from './diff.mjs';
import { compileFiles } from './compile.mjs';
import { buildReport } from './report.mjs';
import { runGate } from './gate.mjs';
import { addTrace, listTraces, replayNode, parseSince } from './trace.mjs';
import { addLesson, listLessons, retireLesson } from './lessons.mjs';
import { addNotice, listNotices, ackNotices } from './notice.mjs';
import { runDoctor } from './doctor.mjs';
import { parseArgs, diag, printAndExit, requireArgs, sidecarPathOf, autoTrace, sidecarOpFailure, loadSidecarOrFail, LESSON_PROMPT, SET_A2_SUGGEST } from './cli-util.mjs';
import { loadProjectGate, prefixAllowed, seatAllowed } from './project-gate.mjs';

function runInit(argv) {
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

function runState(argv) {
  const sub = argv[0];
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.state);
  } catch (e) {
    printAndExit(failed('state.' + sub, [diag('bad_args', e.message, ['state', ...argv].join(' '))]), 1);
    return;
  }

  const cmd = 'state.' + sub;
  const path = sidecarPathOf(args);
  let sidecar;
  try {
    sidecar = loadSidecar(path);
  } catch (e) {
    if (e.code === 'sidecar_missing') {
      // 首次使用：初始化空 sidecar（set 的「仅限初始化」语义）。
      sidecar = { schemaVersion: 1, atlas: null, nodes: {} };
    } else {
      printAndExit(failed(cmd, [diag(e.code || 'sidecar_error', e.message, path)]), 1);
      return;
    }
  }

  // L1/L2 越界门禁（0.13.0，负责人令 2026-08-27）：注册表 opt-in（projects.json 条目 sidecar 字段映射本侧车）才激活。
  // L2 席位门先行（你是谁）；args.owner 缺省时不在北拦截（交给 requireArgs 报 bad_args，诊断序不变）。
  const gate = (sub === 'set' || sub === 'transition' || sub === 'settle' || sub === 'block') ? loadProjectGate(path) : null;
  if (gate && args.owner !== undefined && !seatAllowed(args.owner, gate.seats)) {
    printAndExit(failed(cmd, [diag('seat_gate', '席位 ' + JSON.stringify(args.owner) + ' 不在本侧车授权席位清单（允许：' + [...gate.seats].join(', ') + '；注册表 ' + gate.registryPath + '）', args.owner)]), 1);
    return;
  }

  try {
    if (sub === 'get') {
      requireArgs(args, ['node']);
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      printAndExit(ok(cmd, { node: args.node, owner: node.owner, truth: node.truth, progress: node.progress, ledger: node.ledger, evidenceCount: (node.evidence || []).length, historyCount: (node.history || []).length }), 0);
      return;
    }

    if (sub === 'set') {
      requireArgs(args, ['node', 'axis', 'value', 'reason', 'owner']);
      if (!isAxis(args.axis)) {
        printAndExit(failed(cmd, [diag('unknown_axis', 'axis 必须是 truth|progress|ledger', args.axis)]), 1);
        return;
      }
      if (!isValidState(args.axis, args.value)) {
        printAndExit(failed(cmd, [diag('invalid_state_value', args.value + ' 不在 ' + args.axis + ' 状态集', args.axis)]), 1);
        return;
      }
      // 提案④（2026-08-15 裁定）：set 不再架空 A2——先判节点是否已存在（初始化例外需在 ensureNode 之前探知），
      // 已存在节点的轴值变更同样过迁移表；--correction 为显式纠错通道（history 带 corrected:true 留痕）。
      const existing = findNode(sidecar, args.node);
      const nodeExisted = existing !== null;
      // 0.15.0（边入账，负责人令 2026-09-01）：--kind meta 在建号时把节点标为账务/元节点——
      // report 的 a1-unmatched-account 已有豁免通道（kind='meta' 跳过），此前 CLI 无入口，
      // 活账里的 9 个 meta 节点全是手工写账（绕过 CLI = 绕过 CAS/锁/公理），此旗标补上正规通道。
      // 只拦：值仅接受 'meta'；已存在节点不可改 kind（身份即历史，改了 A1 豁免语义就变了）。
      if (args.kind !== undefined) {
        if (args.kind !== 'meta') {
          printAndExit(failed(cmd, [diag('bad_args', '--kind 仅接受 meta（账务/元节点），收到 ' + JSON.stringify(args.kind), 'state')]), 1);
          return;
        }
        if (nodeExisted && existing.kind !== 'meta') {
          printAndExit(failed(cmd, [diag('bad_args', 'kind 不可改：节点已存在（kind=' + JSON.stringify(existing.kind || 'default') + '），--kind 仅在建号时有效', args.node)]), 1);
          return;
        }
      }
      // 0.12.0（实战反馈档-2026-08-23 P1-4 之建号校验，交叉验证双席复现）：新建节点 id 白名单——
      // 此前管道符/换行/任意字符可静默建号且无删除原语（误建号永久留账）。
      // 只拦新建：既存畸形 id 节点仍可读可改（否则存量清理都做不了）。
      if (!nodeExisted && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(args.node)) {
        printAndExit(failed(cmd, [diag('invalid_node_id', '非法节点 id：' + JSON.stringify(args.node) + '（建号白名单 ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$：字母数字开头，仅允许 . _ -，≤128 字符）', args.node)]), 1);
        return;
      }
      // L1 前缀门（0.13.0）：新建节点 id 必须以本侧车项目前缀开头（共享侧车取并集）；只拦新建，存量 grandfather。
      if (gate && !nodeExisted && !prefixAllowed(args.node, gate.prefixes)) {
        printAndExit(failed(cmd, [diag('project_prefix_gate', '新节点 id ' + JSON.stringify(args.node) + ' 不以本侧车项目前缀开头（允许前缀：' + gate.prefixes.join(' | ') + '（形如 <项目名>-*）；存量节点不受限；注册表 ' + gate.registryPath + '）', args.node)]), 1);
        return;
      }
      const axisHadValue = nodeExisted && existing[args.axis] !== undefined && existing[args.axis] !== null;
      const node = ensureNode(sidecar, args.node, args.owner);
      if (!nodeExisted && args.kind === 'meta') node.kind = 'meta';
      if (node.owner !== args.owner) {
        printAndExit(failed(cmd, [diag('owner_mismatch', '节点属主为 ' + node.owner + '，写入者 ' + args.owner + ' 无权（A4 单一真相拥有者）', args.node)]), 1);
        return;
      }
      const before = node[args.axis];
      // A2 门禁置于 truth 回执门禁之前（与 transition 同序）：违表先报 illegal_transition。
      const a2 = validateSetWrite(args.axis, before, args.value, { correction: !!args.correction, init: !nodeExisted || !axisHadValue });
      if (!a2.ok) {
        printAndExit(failed(cmd, [diag(a2.diagnostics[0].rule, a2.diagnostics[0].evidence + SET_A2_SUGGEST, args.node)]), 1);
        return;
      }
      // 提案③门禁：truth 前进写入（含 set 快捷路径）必须有负责人本地回执文件；--correction 不免除本门禁。
      const truthGate = checkTruthReceipt({ axis: args.axis, from: before, to: args.value, receipt: args.receipt });
      if (!truthGate.ok) {
        printAndExit(failed(cmd, truthGate.diagnostics), 1);
        return;
      }
      node[args.axis] = args.value;
      const event = { at: new Date().toISOString(), kind: 'set', axis: args.axis, from: before, to: args.value, reason: args.reason, by: args.owner };
      if (a2.admittedCorrection) {
        event.corrected = true; // 纠错通道留痕：真实绕过 A2 表的写入才打标
      }
      if (truthGate.receipt) {
        event.receipt = truthGate.receipt;
        recordTruthReceipt(node, args.value, truthGate.receipt, event.at);
      }
      appendHistory(node, event);
      saveSidecar(path, sidecar);
      const a2Rule = (!nodeExisted || !axisHadValue) ? 'A2-init' : (a2.admittedCorrection ? 'A2-correction' : 'A2');
      printAndExit(ok(cmd, { node: args.node, axis: args.axis, from: before, to: args.value, receipt: { rule: a2Rule, status: 'ok' } }), 0);
      return;
    }

    if (sub === 'evidence-add') {
      requireArgs(args, ['node', 'locator']);
      // 批二（2026-08-15）：写入形态绝对化——格式校验（parseLocator 同正则，契约 §5）通过后按 cwd
      // path.resolve 存绝对形态（已是绝对的原样）；旧相对锚仍被读方按 --root 解析，读方无感。
      const abs = absoluteLocator(args.locator, process.cwd());
      if (!abs.ok) {
        printAndExit(failed(cmd, [abs.diagnostic]), 1);
        return;
      }
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      node.evidence = node.evidence || [];
      // 0.11.0（自嗣狗食发现）：同 locator 重复落锚 **幂等**——只刷新 evidenceMeta 哈希（重新加持），不往数组再塞一条。
      // 修复前会真的重复插入，而 drifted 诊断消息自己写着「须复核后重新 evidence-add」
      // ——照官方推荐的补救路径做，每修一次漂移就往账本里塞一条重复锚。
      const rebless = node.evidence.includes(abs.locator);
      // 0.12.0（实战反馈档-2026-08-23 P3-8）：同文件近邻（±3 行）已有本节点锚 → 大概率是
      // 「想 reanchor 却用了 add」，warning 提示不拦截（写边不拦是既有语义）。
      let nearDup = [];
      if (!rebless) {
        const m = abs.locator.match(/^(.*):(\d+)$/);
        if (m) {
          nearDup = node.evidence
            .map((l) => l.match(/^(.*):(\d+)$/))
            .filter((mm) => mm && mm[1] === m[1] && Math.abs(Number(mm[2]) - Number(m[2])) <= 3)
            .map((mm) => mm[0]);
        }
      }
      if (!rebless) node.evidence.push(abs.locator);
      // 锁口②（2026-08-16）：落锚同时读目标行算哈希写 evidenceMeta（可选增量字段，snapshot-policy §5.2 登记）。
      // 行读取失败不阻断落锚——锚已过格式校验，哈希缺失即 unhashed（读方容忍）。
      const h = computeLocatorHash(abs.locator, process.cwd());
      if (h !== null) {
        node.evidenceMeta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
        node.evidenceMeta[abs.locator] = { h, at: new Date().toISOString() };
      }
      appendHistory(node, { at: new Date().toISOString(), kind: 'evidence-add', locator: abs.locator, rebless: rebless || undefined });
      saveSidecar(path, sidecar);
      const addReceipt = ok(cmd, { node: args.node, evidence: node.evidence, receipt: { rule: 'A3', status: 'ok' } });
      if (nearDup.length > 0) {
        addReceipt.diagnostics = [{
          rule: 'evidence_near_duplicate',
          severity: 'warning',
          subject: abs.locator,
          evidence: '同文件近邻（±3 行）已有本节点锚：' + nearDup.join(', ') + '——若意图是改锚而非加锚，用 state evidence-reanchor',
          supportedFixes: ['state evidence-reanchor --node ' + args.node + ' --from <旧锚> --to ' + abs.locator],
        }];
      }
      if (rebless) {
        addReceipt.diagnostics = [{
          rule: 'evidence_reblessed',
          severity: 'warning',
          subject: abs.locator,
          evidence: '锚已存在于该节点：本次为**重新加持**（刷新 evidenceMeta 哈希' + (h === null ? '失败，锚仍为 unhashed' : '为 ' + h) + '），未重复添加；evidence 仍为 ' + node.evidence.length + ' 条',
          supportedFixes: ['若意图是换锚而非重新加持，用 state evidence-reanchor --from <旧锚> --to <新锚>'],
        }];
      }
      printAndExit(addReceipt, 0);
      return;
    }

    // 0.6.0（一线席位 一线实战反馈）：evidence-add 是追加语义——改锚/删锚此前只能手改侧车 JSON，
    // 即绕过 CLI 的 CAS/锁/公理治理面。以下两子命令把锚生命周期写路径补齐进治理面。
    if (sub === 'evidence-remove') {
      requireArgs(args, ['node', 'locator']);
      // 输入锚按 evidence-add 同法绝对化后匹配（落账形态=绝对；传当初落账的同一形态最稳）。
      const abs = absoluteLocator(args.locator, process.cwd());
      if (!abs.ok) {
        printAndExit(failed(cmd, [abs.diagnostic]), 1);
        return;
      }
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      const evidence = node.evidence || [];
      const idx = evidence.indexOf(abs.locator);
      if (idx === -1) {
        printAndExit(failed(cmd, [diag('locator_not_found', '锚不在节点 evidence 数组中：' + abs.locator + '（evidence-add 落账即绝对化，须传当初落账的同一形态）', args.node)]), 1);
        return;
      }
      // A3 守卫：声称对齐实相（progress=verified / ledger=settled / truth∈{effective,closed}，与 report A1 声称判定同语义）
      // 的节点移锚后证据归零 = 声称失去全部证据——拒绝；出路：先 evidence-add 新锚再移除，或 evidence-reanchor 原子替换。
      const claimsAlignment = node.progress === 'verified' || node.ledger === 'settled' || node.truth === 'effective' || node.truth === 'closed';
      if (claimsAlignment && evidence.length - 1 === 0) {
        printAndExit(failed(cmd, [diag('verified_requires_evidence', 'A3：移除会使声称对齐节点失去全部证据（A3）；请先 evidence-add 新锚再移除，或用 evidence-reanchor 原子替换', args.node)], { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      evidence.splice(idx, 1);
      // 同步删除 evidenceMeta 对应键——「孤儿 evidenceMeta」已知边界（0.4.0 已知边界表）由此关闭。
      if (node.evidenceMeta && typeof node.evidenceMeta === 'object') {
        delete node.evidenceMeta[abs.locator];
      }
      appendHistory(node, { at: new Date().toISOString(), kind: 'evidence-remove', locator: abs.locator });
      saveSidecar(path, sidecar);
      printAndExit(ok(cmd, { node: args.node, removed: abs.locator, remaining: evidence.length }), 0);
      return;
    }

    // drifted 处置的规范路径：复核后确认声称仍成立 → reanchor 一步到位（先验后改，任何一步失败零写入）。
    if (sub === 'evidence-reanchor') {
      requireArgs(args, ['node', 'from', 'to']);
      // ① 旧锚必须存在（绝对化匹配；格式坏 = bad_locator）。
      const fromAbs = absoluteLocator(args.from, process.cwd());
      if (!fromAbs.ok) {
        printAndExit(failed(cmd, [fromAbs.diagnostic]), 1);
        return;
      }
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      const evidence = node.evidence || [];
      const idx = evidence.indexOf(fromAbs.locator);
      if (idx === -1) {
        printAndExit(failed(cmd, [diag('locator_not_found', '旧锚不在节点 evidence 数组中：' + fromAbs.locator + '（evidence-add 落账即绝对化，须传当初落账的同一形态）', args.node)]), 1);
        return;
      }
      // ② 新锚过 evidence-add 同款校验 + 行存在/行界 lint——比 evidence-add 写边更严：改锚即 drifted 处置，
      //    新锚必须真实可解析，否则处置落空为 broken/unhashed。校验全在变更之前（先验后改，失败零写入）。
      const toAbs = absoluteLocator(args.to, process.cwd());
      if (!toAbs.ok) {
        printAndExit(failed(cmd, [toAbs.diagnostic]), 1);
        return;
      }
      const linted = lintLocator(toAbs.locator, process.cwd());
      if (!linted.ok) {
        printAndExit(failed(cmd, [linted.diagnostic]), 1);
        return;
      }
      // ③ 一次 save 内完成「移除旧锚（含其 meta）+ 追加新锚（含新哈希）」——中途绝不出现证据为零的瞬间，
      //    故 A3 天然不受威胁（无需额外守卫；设计理由见契约 §2）。from===to 时按刷新哈希处理（evidence 数组不动）。
      if (fromAbs.locator !== toAbs.locator) {
        evidence.splice(idx, 1);
        // 新锚已在 evidence 中（to≠from）视为合并去重：移除旧锚，不重复追加，新锚哈希刷新。
        if (evidence.indexOf(toAbs.locator) === -1) {
          evidence.push(toAbs.locator);
        }
      }
      if (node.evidenceMeta && typeof node.evidenceMeta === 'object') {
        delete node.evidenceMeta[fromAbs.locator];
      }
      const h = computeLocatorHash(toAbs.locator, process.cwd());
      if (h !== null) {
        node.evidenceMeta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
        node.evidenceMeta[toAbs.locator] = { h, at: new Date().toISOString() };
      }
      // ④ history 记 kind='evidence-reanchor' 事件（含 from/to）。
      appendHistory(node, { at: new Date().toISOString(), kind: 'evidence-reanchor', from: fromAbs.locator, to: toAbs.locator });
      saveSidecar(path, sidecar);
      printAndExit(ok(cmd, { node: args.node, from: fromAbs.locator, to: toAbs.locator, hash: h }), 0);
      return;
    }

    if (sub === 'transition') {
      requireArgs(args, ['node', 'axis', 'from', 'to', 'reason', 'owner']);
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      if (node.owner !== args.owner) {
        printAndExit(failed(cmd, [diag('owner_mismatch', '节点属主为 ' + node.owner + '，写入者 ' + args.owner + ' 无权（A4）', args.node)]), 1);
        return;
      }
      const verdict = validateTransition(args.axis, args.from, args.to);
      if (!verdict.ok) {
        printAndExit(failed(cmd, verdict.diagnostics), 1);
        return;
      }
      if (args.axis === 'progress' && args.to === 'verified' && (node.evidence || []).length < 1) {
        printAndExit(failed(cmd, [diag('verified_requires_evidence', 'A3：progress 迁移到 verified 必须至少 1 条 Evidence（先 state evidence-add）', args.node)], { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      // 提案③门禁：truth 前进写入必须有负责人本地回执文件（置于 A2/A3 之后，非法迁移仍先报 illegal_transition）。
      const truthGate = checkTruthReceipt({ axis: args.axis, from: args.from, to: args.to, receipt: args.receipt });
      if (!truthGate.ok) {
        printAndExit(failed(cmd, truthGate.diagnostics), 1);
        return;
      }
      node[args.axis] = args.to;
      const event = { at: new Date().toISOString(), kind: 'transition', axis: args.axis, from: args.from, to: args.to, reason: args.reason, by: args.owner };
      if (truthGate.receipt) {
        event.receipt = truthGate.receipt;
        recordTruthReceipt(node, args.to, truthGate.receipt, event.at);
      }
      appendHistory(node, event);
      saveSidecar(path, sidecar);
      printAndExit(ok(cmd, { node: args.node, axis: args.axis, from: args.from, to: args.to, receipt: { rule: 'A2', status: 'ok' } }), 0);
      return;
    }

    if (sub === 'settle') {
      requireArgs(args, ['node', 'reason', 'owner']);
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      if (node.owner !== args.owner) {
        printAndExit(failed(cmd, [diag('owner_mismatch', '节点属主为 ' + node.owner + '，写入者 ' + args.owner + ' 无权（A4）', args.node)]), 1);
        return;
      }
      if (node.progress !== 'in_progress') {
        printAndExit(failed(cmd, [diag('illegal_transition', '销账要求 progress=in_progress，当前为 ' + node.progress, args.node)]), 1);
        return;
      }
      if (node.ledger === 'settled') {
        printAndExit(failed(cmd, [diag('already_settled', '账务轴已是 settled 终态', args.node)]), 1);
        return;
      }
      if ((node.evidence || []).length < 1) {
        printAndExit(failed(cmd, [diag('verified_requires_evidence', 'A3：销账（verified）必须至少 1 条 Evidence', args.node)], { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      const before = { progress: node.progress, ledger: node.ledger };
      node.progress = 'verified';
      node.ledger = 'settled';
      appendHistory(node, { at: new Date().toISOString(), kind: 'settle', from: before, to: { progress: 'verified', ledger: 'settled' }, reason: args.reason, by: args.owner });
      // B3（2026-08-15 清单）：settle 成功同次写入自动投递一条席位通知（from=--owner，summary=--reason）。
      addNotice(sidecar, { from: args.owner, kind: 'settled', node: args.node, summary: args.reason });
      saveSidecar(path, sidecar);
      // 实战缺口（实战反馈档（2026-08-15） 三）：销账五动作第 4 步 report 曾整批漏做——成功回执携带下一步提示（纯增字段，非破坏）。
      const next = '销账五动作第4步：atlas-engine report --sidecar ' + path + ' 生成销账回执';
      printAndExit(ok(cmd, { node: args.node, from: before, to: { progress: 'verified', ledger: 'settled' }, next, lessonPrompt: LESSON_PROMPT, receipt: { rule: 'A2-cross-axis-settle', status: 'ok', dualWrite: true } }), 0);
      return;
    }

    if (sub === 'block') {
      requireArgs(args, ['node', 'reason', 'owner']);
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      if (node.owner !== args.owner) {
        printAndExit(failed(cmd, [diag('owner_mismatch', '节点属主为 ' + node.owner + '，写入者 ' + args.owner + ' 无权（A4）', args.node)]), 1);
        return;
      }
      if (node.progress !== 'in_progress') {
        printAndExit(failed(cmd, [diag('illegal_transition', '阻塞要求 progress=in_progress，当前为 ' + node.progress, args.node)]), 1);
        return;
      }
      const before = { progress: node.progress, ledger: node.ledger };
      node.progress = 'blocked';
      if (args.withBacklog) {
        if (node.ledger !== 'clean') {
          printAndExit(failed(cmd, [diag('illegal_transition', '--with-backlog 要求 ledger=clean，当前为 ' + node.ledger, args.node)]), 1);
          return;
        }
        node.ledger = 'backlog';
      }
      appendHistory(node, { at: new Date().toISOString(), kind: 'block', from: before, to: { progress: node.progress, ledger: node.ledger }, reason: args.reason, by: args.owner });
      // B3（2026-08-15 清单）：block 成功同次写入自动投递一条席位通知（from=--owner，summary=--reason）。
      addNotice(sidecar, { from: args.owner, kind: 'blocked', node: args.node, summary: args.reason });
      saveSidecar(path, sidecar);
      printAndExit(ok(cmd, { node: args.node, from: before, to: { progress: node.progress, ledger: node.ledger }, receipt: { rule: 'A2-cross-axis-block', status: 'ok' } }), 0);
      return;
    }

    printAndExit(failed(cmd, [diag('unknown_subcommand', '未知子命令：' + sub, sub)]), 1);
  } catch (e) {
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}

function runDiff(argv) {
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
      const sidecarPath = args.sidecar || 'atlas-state.json';
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

function runCompile(argv) {
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
    const result = compileFiles(args.diagram, args.sidecar, args.out);
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

function runReport(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.report);
  } catch (e) {
    printAndExit(failed('report', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    const sidecarPath = args.sidecar || 'atlas-state.json';
    let sidecar;
    try {
      sidecar = loadSidecar(sidecarPath);
    } catch (e) {
      printAndExit(failed('report', [diag(e.code || 'sidecar_error', e.message, sidecarPath)]), 1);
      return;
    }
    let verify = null;
    if (args.verify) {
      try {
        verify = JSON.parse(fs.readFileSync(args.verify, 'utf8'));
      } catch (e) {
        printAndExit(failed('report', [diag('bad_verify', 'verify 文件不可读或非 JSON：' + e.message, args.verify)]), 1);
        return;
      }
    }
    // --spec 可重复：聚合全部 archify spec 后启用 A1 图码对账；未传则行为与现状完全一致。
    const specs = [];
    if (args.spec !== undefined) {
      for (const file of [].concat(args.spec)) {
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
          printAndExit(failed('report', [diag('bad_spec', 'spec 读取或解析失败：' + file + '：' + e.message, file)]), 1);
          return;
        }
        specs.push(parsed);
      }
    }
    const report = buildReport(sidecar, { slice: args.slice || null, root: args.root || '.', verify, codeSha: args['code-sha'] || null, specSha: args['spec-sha'] || null, specs, replays: args.replay === undefined ? [] : [].concat(args.replay), brief: !!args.brief });
    // B1：report 原为只读命令，现默认向侧车留痕（CAS revision 推进；契约 §6 语义变化明示）；--slice 时锚定该节点。
    // A3：--brief 时 warnings 降为计数，取数兼容。
    const warnCount = Array.isArray(report.warnings) ? report.warnings.length : report.warnings;
    const traceEntry = {
      params: { slice: args.slice || '*', specs: specs.length },
      result: { errors: report.errors.length, warnings: warnCount },
      node: args.slice || null,
      note: 'report errors=' + report.errors.length + ' warnings=' + warnCount,
    };
    if (report.errors.length > 0) {
      const warn = autoTrace('report', args, traceEntry, sidecar);
      if (warn) report.errors.push(warn);
      // 失败信封仍携带 a1 小节（检查范围/计数/nonClaims），不伪装成功。
      // A3：--brief 时失败信封同样携带计数摘要（与成功路径同形，data 只出计数+error，不重复 warning 明细）。
      const failData = args.brief ? report : (report.a1 ? { a1: report.a1 } : undefined);
      printAndExit(failed('report', report.errors, failData), 1);
      return;
    }
    const warn = autoTrace('report', args, traceEntry, sidecar);
    const receipt = ok('report', report);
    if (warn) receipt.diagnostics = [warn];
    printAndExit(receipt, 0);
  } catch (e) {
    if (sidecarOpFailure('report', e)) return;
    printAndExit(failed('report', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}

// gate --out 落点提示（0.10.0，holdout #2 P0）：--out 父目录正好是某 atlas 的 artifacts/<项目>/ 根
// （祖父目录名==artifacts 且图谱根下有 spec/<项目>/）时，gate 与 visual-check 的全部生成物直落项目根，
// doctor --atlas 立刻报布局 P2 error——照官方快乐路径做会把自家 atlas 打成 failed 而 gate 全程零提示。
// 处置 = 回执 diagnostics 追加 warning（建议落点 artifacts/<项目>/<模块>-<YYMMDD>/，日期取当天），
// 不阻断、不改退出码、不自动移动文件（移动用户指定的输出路径太越权）。
function gateOutPlacementDiag(outPath) {
  const parent = path.dirname(path.resolve(outPath));
  const grand = path.dirname(parent);
  if (path.basename(grand) !== 'artifacts') return null;
  const project = path.basename(parent);
  if (project === 'artifacts') return null; // 直落 artifacts/ 根本身是另一形态，P2 校验已咬
  const atlasRoot = path.dirname(grand);
  if (!fs.existsSync(path.join(atlasRoot, 'spec', project))) return null; // 非 atlas 项目根（路径撞名）不报
  const now = new Date();
  const stamp = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  return {
    rule: 'gate_out_placement',
    severity: 'warning',
    subject: outPath,
    evidence: '--out 直落 atlas 的 artifacts/' + project + '/ 项目根——gate 与 visual-check 生成物散置项目根会触发布局 P2（doctor --atlas 判 error）；建议落点 artifacts/' + project + '/<模块>-' + stamp + '/（模块目录 <模块>-<YYMMDD>，日期取当天）',
    supportedFixes: ['把 --out 改到 artifacts/' + project + '/<模块>-' + stamp + '/ 下（如 artifacts/' + project + '/main-' + stamp + '/out.html）'],
  };
}

function runGateCli(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.gate);
  } catch (e) {
    printAndExit(failed('gate', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    if (!args.diagram || !args.out) {
      printAndExit(failed('gate', [diag('bad_args', '需要 --diagram --out', 'gate')]), 1);
      return;
    }
    const result = runGate(args.diagram, args.out);
    const gates = {};
    for (const [k, v] of Object.entries(result.results || {})) gates[k] = v.exit;
    const traceEntry = {
      params: { diagram: args.diagram, out: args.out },
      result: { final: result.final, stage: result.stage, gates },
      note: 'gate final=' + result.final + (result.stage ? ' stage=' + result.stage : ''),
    };
    if (result.final === 'pass') {
      const warn = autoTrace('gate', args, traceEntry);
      const receipt = ok('gate', result);
      const diags = [];
      if (warn) diags.push(warn);
      const placement = gateOutPlacementDiag(args.out);
      if (placement) diags.push(placement);
      if (diags.length > 0) receipt.diagnostics = diags;
      printAndExit(receipt, 0);
    } else {
      const warn = autoTrace('gate', args, traceEntry);
      const diags = [diag('gate_' + result.stage, '三闸停在 ' + result.stage + '：' + (result.tail || result.diagnostic || ''), result.stage)];
      if (warn) diags.push(warn);
      const placement = gateOutPlacementDiag(args.out);
      if (placement) diags.push(placement);
      // B4：gate fail 回执附回写提示（纯增 data 字段）。
      printAndExit(failed('gate', diags, { lessonPrompt: LESSON_PROMPT }), 1);
    }
  } catch (e) {
    if (sidecarOpFailure('gate', e)) return;
    printAndExit(failed('gate', [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}

function runTrace(argv) {
  const sub = argv[0] || 'add';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.trace);
  } catch (e) {
    printAndExit(failed('trace.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'trace.' + sub;
  const sidecarPath = args.sidecar || 'atlas-state.json';
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
    if (e.code === 'bad_kind') {
      printAndExit(failed(cmd, [diag('bad_kind', e.message, cmd)]), 1);
      return;
    }
    if (sidecarOpFailure(cmd, e)) return;
    printAndExit(failed(cmd, [diag('internal', e.message, String(e.stack || '').split('\n')[0])]), 2);
  }
}

function runLessons(argv) {
  const sub = argv[0] || 'add';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.lessons);
  } catch (e) {
    printAndExit(failed('lessons.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'lessons.' + sub;
  const sidecarPath = args.sidecar || 'atlas-state.json';
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

// B3（2026-08-15 清单）：notice 命令组——席位间主动通知（list/ack/add）。
function runNotice(argv) {
  const sub = argv[0] || 'list';
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.notice);
  } catch (e) {
    printAndExit(failed('notice.' + sub, [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  const cmd = 'notice.' + sub;
  const sidecarPath = args.sidecar || 'atlas-state.json';
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

function runDoctorCli(argv) {
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

// ---------- 命令注册表（名称=分发键；usage=--help 拼装源，单一来源） ----------
// 0.10.0：两段式废弃第二阶段——evidence 顶层命令与 lessons hit 子命令物理移除（0.9.0 标记时承诺 v0.10.0 移除；
// 替代路径 = state evidence-add（写）/ doctor（读）；hits 字段与既有数据保留），deprecated_command 诊断码随之退役。

const COMMANDS = [
  {
    name: 'init',
    flags: FLAGS.init,
    usage: [
      '[init] 初始化 v3 版式图谱目录（七区 + spec|evidence|data|artifacts 下 <项目>/ 子目录 + state/projects.json 注册表；--template minimal=缺省骨架 | demo=额外播种演示图全环）',
      'atlas-engine init --dir <目录> --title <标题> [--template minimal|demo] [--diagram-type architecture|workflow|sequence|dataflow|lifecycle] [--diagram-id <id>]',
    ],
    run: runInit,
  },
  {
    name: 'state',
    flags: FLAGS.state,
    usage: [
      '[state] 三轴状态机（truth/progress/ledger）',
      'atlas-engine state get --node <id> [--sidecar <path>]',
      'atlas-engine state set --node <id> --axis truth|progress|ledger --value <v> --reason <text> --owner <o> [--receipt <回执文件>] [--correction] [--kind meta] [--sidecar <path>]',
      'atlas-engine state transition --node <id> --axis truth|progress|ledger --from <s> --to <t> --reason <text> --owner <o> [--receipt <回执文件>] [--sidecar <path>]',
      'atlas-engine state evidence-add --node <id> --locator <文件:行号> [--sidecar <path>]',
      'atlas-engine state evidence-remove --node <id> --locator <锚> [--sidecar <path>]（移除+A3 守卫）｜ state evidence-reanchor --node <id> --from <旧锚> --to <新锚> [--sidecar <path>]（drifted 处置规范路径：原子改锚；锚改删禁手改 JSON）',
      'atlas-engine state settle --node <id> --reason <text> --owner <o> [--sidecar <path>]',
      'atlas-engine state block --node <id> --reason <text> --owner <o> [--with-backlog] [--sidecar <path>]',
      '  set/transition：truth 轴前进写入必填 --receipt <负责人本地回执文件>（机器只校验存在性不校验语义，提案③ 2026-08-15）；set 对已存在节点轴值变更同过 A2 迁移表（2026-08-15 裁定④，不再架空），初始化/该轴首写免表，违表=exit 1 illegal_transition，确属纠错加 --correction（history 事件 corrected:true 留痕；不免除 truth 回执）',
    ],
    run: runState,
  },
  {
    name: 'diff',
    flags: FLAGS.diff,
    usage: [
      '[diff] 双 spec 差异 + 状态时间线',
      'atlas-engine diff spec --base <a.json> --head <b.json>',
      'atlas-engine diff state [--sidecar <path>] [--since <version>]',
    ],
    run: runDiff,
  },
  {
    name: 'compile',
    flags: FLAGS.compile,
    usage: [
      '[compile] sidecar 状态注入 spec（tag + 焦点章节）；运行后自动向侧车留痕 kind=command（--no-trace 关闭）',
      'atlas-engine compile --diagram <spec.json> --sidecar <state.json> --out <compiled.json> [--no-trace]',
    ],
    run: runCompile,
  },
  {
    name: 'report',
    flags: FLAGS.report,
    usage: [
      '[report] 销账回执汇总（--spec 可重复；传入即启用 A1 图码对账；--replay 可重复，内联焦点节点时间线摘要；--brief 只出计数+error 摘要）；运行后自动留痕（CAS revision 推进，--no-trace 关闭）',
      'atlas-engine report [--slice <id>] [--sidecar <path>] [--root <dir>] [--verify <results.json>] [--code-sha <sha>] [--spec-sha <sha>] [--spec <archify-spec.json>] [--replay <节点id>] [--brief] [--no-trace]',
    ],
    run: runReport,
  },
  {
    name: 'gate',
    flags: FLAGS.gate,
    usage: [
      '[gate] 串行三闸（archify validate → deliver → visual-check）；给 --sidecar 时运行后自动留痕（--no-trace 关闭）',
      'atlas-engine gate --diagram <compiled.json> --out <out.html> [--sidecar <path>] [--no-trace]',
    ],
    run: runGateCli,
  },
  {
    name: 'trace',
    flags: FLAGS.trace,
    usage: [
      '[trace] 轨迹锚定（list/replay 支持 --since <ISO8601> 截窗，含边界；格式非法=exit 1 bad_args）',
      'atlas-engine trace add --kind tool_call|decision|diagram_diff|evidence|ruling|command [--actor <name>] [--note <text>] [--node <id>] [--sidecar <path>]',
      'atlas-engine trace list [--node <id>] [--since <ISO8601>] [--sidecar <path>] ｜ trace replay --node <id> [--since <ISO8601>] [--sidecar <path>]',
    ],
    run: runTrace,
  },
  {
    name: 'lessons',
    flags: FLAGS.lessons,
    usage: [
      '[lessons] 经验池（retire=置 retired 幂等；list 缺省只列 active，--all 含 retired；hits 字段保留为存量只读计数——写入口 lessons hit 已于 v0.10.0 移除）',
      'atlas-engine lessons add --lesson <text> [--rule <code>] [--source <id>] [--sidecar <path>]',
      'atlas-engine lessons retire --id <lesson-id> [--sidecar <path>] ｜ lessons list [--recent <N>] [--rule <code>] [--all] [--sidecar <path>]',
    ],
    run: runLessons,
  },
  {
    name: 'notice',
    flags: FLAGS.notice,
    usage: [
      '[notice] 席位间主动通知（一等数据非侧信道；settle/block 成功自动投递 kind=settled|blocked）',
      'atlas-engine notice list [--seat <名>（只列未读）] ｜ notice ack --seat <名> [--id <id>（缺省=全部未读）] ｜ notice add --kind note --node <id> --summary <text> --from <名> [--sidecar <path>]',
    ],
    run: runNotice,
  },
  {
    name: 'doctor',
    flags: FLAGS.doctor,
    usage: [
      '[doctor] 环境自检（6 检查；--stats 需 --sidecar：账本侧派生度量；evidence-resolvability/ledger-size 为 warning 级，不使 exit 1）',
      'atlas-engine doctor [--sidecar <path>] [--atlas <图谱目录>] [--stats]',
    ],
    run: runDoctorCli,
  },
];

// ---------- 帮助文本拼装（骨架固定，命令行全部取自注册表 usage 字段） ----------
const USAGE_HEADER = 'atlas-engine — ADD 图谱驱动研发体系 L2 状态机层 CLI（统一 JSON 回执信封，契约见 specs/command-contract.md）';
const USAGE_TRACE_DISCIPLINE = '自动留痕纪律：gate/compile/report 成败均记；state 写命令不记（history 已覆盖）；留痕失败降级为 diagnostics warning 不阻断主结果';
const USAGE_FOOTER = '退出码：0=ok · 1=failed（校验/约束失败）· 2=内部错误；archify 解析顺序 ARCHIFY_BIN → PATH → 内置回退';

export function buildUsage() {
  const blocks = new Map(COMMANDS.map((c) => [c.name, c.usage.join('\n')]));
  return [
    USAGE_HEADER, '',
    blocks.get('init'), '',
    blocks.get('state'), '',
    blocks.get('diff'), '',
    blocks.get('compile'), '',
    blocks.get('report'), '',
    blocks.get('gate'), '',
    blocks.get('trace'), '',
    blocks.get('lessons'), '',
    blocks.get('notice'), '',
    USAGE_TRACE_DISCIPLINE, '',
    blocks.get('doctor'), '',
    USAGE_FOOTER,
  ].join('\n');
}

export { COMMANDS };
