// 命令注册表（D4 重构 2026-08-15：从 bin 迁入的命令分发逻辑 + 帮助文本单一来源）。
// 约定：每命令一条 { name, usage（帮助行数组，--help 拼装源）, flags（合法旗标白名单，批一#2 机器校验源）, run(argv) }；
// run 收到的 argv = 去除顶级命令名后的剩余参数。帮助文本只由此处 usage 字段生成（防 help 与实现漂移复发）。
// 0.10.0：十命令——evidence 顶层命令与 lessons hit 子命令按两段式废弃政策第二阶段物理移除（承诺见 0.9.0；
// 理由与替代路径入 RELEASES [0.10.0] Breaking 节；hits 字段与既有数据保留，只删写入口）。

// 命令登记与解析器共享 cli-options.mjs 的旗标声明（命令 ≤11、唯一旗标 ≤50）。
import { FLAGS } from './cli-options.mjs';

import fs from 'node:fs';
import path from 'node:path';
import { isAxis, isValidState, validateTransition, validateSetWrite, ACTIVE_CLASSES, CLASS_STATES } from './state-machine.mjs';
import { checkStateWritePolicy, unresolvableEvidenceDiag } from './state-policy.mjs';
import { checkTruthReceipt, recordTruthReceipt } from './truth-receipt.mjs';
import { ok, failed } from './envelope.mjs';
import { loadSidecar, saveSidecar, findNode, ensureNode, appendHistory } from './store.mjs';
import { lintLocator, absoluteLocator, computeLocatorHash } from './evidence.mjs';
import { parseSpecRef, formatSpecRef } from './spec-id.mjs';
import { loadAnchorRootContext, ensureGrandfatheredExemptions, anchorRootVerdict, ANCHOR_ROOTS_FILE, ANCHOR_EXEMPTIONS_FILE } from './anchor-roots.mjs';
import { scaffoldAtlas } from './init.mjs';
import { diffSpecs, stateTimeline } from './diff.mjs';
import { compileFiles } from './compile.mjs';
import { buildReport, bindingStatusFor } from './report.mjs';
import { runGate, appendGateDetail, GATE_NAMES } from './gate.mjs';
import { addTrace, listTraces, replayNode, parseSince } from './trace.mjs';
import { addLesson, listLessons, retireLesson } from './lessons.mjs';
import { addNotice, listNotices, ackNotices } from './notice.mjs';
import { runDoctor } from './doctor.mjs';
import { ENGINE_VERSION } from './version.mjs';
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

// O1（2026-09-14 设计件 O1）：写边锚根白名单校验——返回 { ok, diagnostics, rootCtx, exemptions, verdict }。
// 白名单/豁免基建的解析与首跑豁免生成都在此收口，evidence-add / evidence-reanchor / import 共用（勿复制三份）。
// --allow-root 单次追加白名单；首跑对存量账生成 grandfathered 豁免清单（见 lib/anchor-roots.mjs）。
// 配置「已存在但坏」（projects.json / anchor-roots.json 不可解析或形状坏）= fail-loud 结构化 failed（exit 1），
// 不再静默降级为「门未激活」——坏配置不得解除已声明的门；只有「配置不存在」才是 opt-in 不启用。
function anchorRootCheck(args, sidecar, sidecarPath, locator) {
  let rootCtx;
  let exemptions;
  let verdict = null;
  try {
    rootCtx = loadAnchorRootContext(sidecarPath, { allowRoots: args['allow-root'] });
    exemptions = ensureGrandfatheredExemptions(sidecarPath, sidecar, rootCtx);
    verdict = locator ? anchorRootVerdict(locator, rootCtx, exemptions.entries) : null;
  } catch (e) {
    if (e && e.code === 'anchor_roots_config_invalid') {
      return { ok: false, diagnostics: [diag(e.code, e.message, sidecarPath)] };
    }
    throw e;
  }
  if (verdict && !verdict.ok) {
    return { ok: false, diagnostics: [anchorRootDeniedDiag(verdict, rootCtx)], rootCtx, exemptions, verdict };
  }
  return { ok: true, diagnostics: [], rootCtx, exemptions, verdict };
}

// 证据写边统一校验（evidence-add / evidence-reanchor / import 共用，勿复制三份）：
//   ① locator 格式（半角冒号 文件:行号）→ ② 绝对化（落账形态）→ ③ requireResolvable 时校验「文件存在 + 行界」
//   → ④ 锚根白名单（O1）+ grandfathered 豁免。
// requireResolvable 的取值口径（缺陷3）：**声称对齐的写边**（import/settle 及 set/transition → verified）
// 必须可解析——「锚已过格式校验」不足以支撑完成声称（指向不存在的文件同样通过格式校验）；
// evidence-add / evidence-reanchor 的 to 维持「lint 属读方」的既有语义（只登记锚，不拦不可解析目标）。
function evidenceWriteCheck(args, sidecar, sidecarPath, rawLocator, { requireResolvable = false, cwd = process.cwd() } = {}) {
  const abs = absoluteLocator(rawLocator, cwd);
  if (!abs.ok) return { ok: false, diagnostics: [abs.diagnostic] };
  if (requireResolvable) {
    const linted = lintLocator(abs.locator, cwd);
    if (!linted.ok) {
      return { ok: false, diagnostics: [unresolvableEvidenceDiag([{ locator: abs.locator, diagnostic: linted.diagnostic }], args.node || abs.locator)] };
    }
  }
  const rootCheck = anchorRootCheck(args, sidecar, sidecarPath, abs.locator);
  if (!rootCheck.ok) return { ok: false, diagnostics: rootCheck.diagnostics };
  return { ok: true, locator: abs.locator, rootCheck };
}

// 回执纯增字段（设计件 O1 接口草案 anchorRoot: { matched, exempted }）+ 白名单外拒写的诊断文案。
function anchorRootReceipt(rootCtx, exemptions, verdict) {
  const receipt = {
    gate: rootCtx.active ? 'active' : 'inactive',
    matched: verdict ? verdict.matched : null,
    exempted: verdict ? verdict.exempted === true : false,
    source: verdict ? verdict.source : null,
  };
  if (rootCtx.active) {
    receipt.roots = rootCtx.roots.map((r) => r.root);
    if (rootCtx.rejected.length > 0) receipt.rejected = rootCtx.rejected;
    if (exemptions.existed || exemptions.created) receipt.exemptionsPath = exemptions.path;
    if (exemptions.created) receipt.exemptionsGenerated = exemptions.entries.length;
  }
  return receipt;
}

function anchorRootDeniedDiag(verdict, rootCtx) {
  const roots = rootCtx.roots.map((r) => r.root).join(' | ') || '（白名单为空）';
  return diag(
    'anchor_root_denied',
    '锚根不在白名单（O1 写边硬校验）：' + verdict.file + ' 不在 [' + roots + ']；处置 = 把证据移到登记仓/atlas 根内，或 --allow-root <根>（单次生效），或在 <侧车同目录>/' + ANCHOR_ROOTS_FILE + ' 显式登记该根；存量错根锚走 <侧车同目录>/' + ANCHOR_EXEMPTIONS_FILE + ' 一次性豁免',
    verdict.file
  );
}

// 白名单相关 warning（豁免命中 / --allow-root 被拒），与既有 nearDup/rebless 警告并列，不改变其顺序。
function anchorRootWarnings(rootCtx, verdict) {
  const out = [];
  if (verdict && verdict.exempted) {
    out.push({
      rule: 'anchor_root_grandfathered',
      severity: 'warning',
      subject: verdict.exemption.path,
      evidence: '该锚在 grandfathered 豁免清单内（' + verdict.exemption.reason + '）：写边放行但不等于根合法——复核后 evidence-reanchor 回白名单内，并从 ' + ANCHOR_EXEMPTIONS_FILE + ' 删除该条目',
      supportedFixes: ['state evidence-reanchor --node <id> --from ' + verdict.exemption.path + ':<行> --to <白名单内锚>'],
    });
  }
  for (const r of rootCtx.rejected.filter((x) => x.source === 'cli')) {
    out.push({
      rule: 'anchor_root_rejected',
      severity: 'warning',
      subject: r.root,
      evidence: '--allow-root 被拒（' + r.reason + '）：单次白名单未追加该根',
      supportedFixes: ['改用绝对路径且非 dist/.next/临时目录的根'],
    });
  }
  return out;
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
    if (e.code === 'sidecar_missing' && sub === 'set' && args.sidecar) {
      // 首次使用：初始化空 sidecar（set 的「仅限初始化」语义）。审核批 2026-09-18：须显式 --sidecar；
      // 缺省路径（cwd/atlas-state.json）缺失一律 sidecar_missing，不在 cwd 悄悄造幽灵账本（空态绿）。
      sidecar = { schemaVersion: 1, atlas: null, nodes: {} };
    } else {
      printAndExit(failed(cmd, [diag(e.code || 'sidecar_error', e.message, path)]), 1);
      return;
    }
  }

  // L1/L2 越界门禁（0.13.0，负责人令 2026-08-27）：注册表 opt-in（projects.json 条目 sidecar 字段映射本侧车）才激活。
  // 配置「已存在但坏」（不可解析/形状坏）≠ 未激活：坏配置不得解除已声明的门，fail-loud 结构化 failed（exit 1），
  // 不逃逸成顶层 internal/exit 2（上轮审核）。
  // L2 席位门先行（你是谁）；args.owner 缺省时不在北拦截（交给 requireArgs 报 bad_args，诊断序不变）。
  let gate = null;
  if (sub === 'set' || sub === 'transition' || sub === 'settle' || sub === 'block' || sub === 'import') {
    try {
      gate = loadProjectGate(path);
    } catch (e) {
      if (e && e.code === 'project_gate_config_invalid') {
        printAndExit(failed(cmd, [diag(e.code, e.message, path)]), 1);
        return;
      }
      throw e;
    }
  }
  if (gate && args.owner !== undefined && !seatAllowed(args.owner, gate.seats)) {
    printAndExit(failed(cmd, [diag('seat_gate', '席位 ' + JSON.stringify(args.owner) + ' 不在本侧车授权席位清单（允许：' + [...gate.seats].join(', ') + '；注册表 ' + gate.registryPath + '）', args.owner)]), 1);
    return;
  }

  try {
    if (sub === 'spec-ref') {
      // A3（2026-09-10）：节点显式**认领**图件 id（含图内局部 id）——认领后 A1 不再报"图件未入账" ✓
      requireArgs(args, ['node', 'ref']);
      const refNode = findNode(sidecar, args.node);
      if (!refNode) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      const parsedRef = parseSpecRef(args.ref);
      if (args.diagram !== undefined) {
        const diagram = String(args.diagram).trim();
        if (parsedRef.diagram !== null) {
          printAndExit(failed(cmd, [diag('bad_args', '--ref 已自带图限定「' + parsedRef.diagram + '/' + parsedRef.id + '」，不要再传 --diagram（避免二次限定）', args.node)]), 1);
          return;
        }
        if (diagram === '' || diagram.includes('/')) {
          printAndExit(failed(cmd, [diag('bad_args', '--diagram 必须是非空图名（不含量词分隔符 /），收到 ' + JSON.stringify(args.diagram), args.node)]), 1);
          return;
        }
      }
      // 图作用域化（缺陷4）：带 --diagram 时落账为 `<图名>/<图内id>`，只在该图内认领；不带则维持
      // 「未限图」旧语义（跨图生效，report 计入 a1.unscopedRefs 如实披露）。
      const ref = args.diagram === undefined ? String(args.ref).trim() : formatSpecRef(String(args.diagram).trim(), parsedRef.id);
      if (ref.length === 0 || parsedRef.id.trim().length === 0) {
        printAndExit(failed(cmd, [diag('bad_args', '--ref 不能为空', args.node)]), 1);
        return;
      }
      const existingRefs = Array.isArray(refNode.specRefs) ? refNode.specRefs : [];
      const isRemove = args.remove === true;
      if (isRemove) {
        const nextRefs = existingRefs.filter((x) => x !== ref);
        if (nextRefs.length === existingRefs.length) {
          printAndExit(failed(cmd, [diag('spec_ref_not_found', '该节点未认领 ' + ref, args.node)]), 1);
          return;
        }
        refNode.specRefs = nextRefs;
        appendHistory(refNode, { at: new Date().toISOString(), kind: 'spec-ref-remove', ref });
        saveSidecar(path, sidecar);
        printAndExit(ok(cmd, { node: args.node, ref, removed: true, specRefs: refNode.specRefs }), 0);
        return;
      }
      if (existingRefs.includes(ref)) {
        printAndExit(ok(cmd, { node: args.node, ref, specRefs: existingRefs, note: '已认领（幂等）' }), 0);
        return;
      }
      refNode.specRefs = [...existingRefs, ref];
      appendHistory(refNode, { at: new Date().toISOString(), kind: 'spec-ref-add', ref });
      saveSidecar(path, sidecar);
      printAndExit(ok(cmd, { node: args.node, ref, specRefs: refNode.specRefs }), 0);
      return;
    }

    if (sub === 'active') {
      // 活帐视图（2026-09-10 增）："还有多少任务没完成"的机检答案。
      // 默认只列 class ∈ {task,debt,batch-gated,trigger-gated}；--all 按 class 全列（含未分类）。
      // O3（2026-09-14 设计件 §2 O3）：无 class 节点单列（unclassified）并计入 count——修
      // 「state active 默认视图静默漏出未分类节点」（demo-b 实测 2 条：活帐看不到它们，账实脱节无人发现）。
      const all = args.all === true || args.all === 'true';
      const rows = Object.entries(sidecar.nodes || {}).map(([id, n]) => ({
        id,
        className: n.class || 'unclassified',
        progress: n.progress,
        ledger: n.ledger,
        owner: n.owner,
      }));
      const active = rows.filter(
        (r) => ACTIVE_CLASSES.includes(r.className) && r.progress !== 'verified' && r.progress !== 'cancelled'
      );
      const unclassified = rows.filter(
        (r) => r.className === 'unclassified' && r.progress !== 'verified' && r.progress !== 'cancelled'
      );
      const unclassifiedTotal = rows.filter((r) => r.className === 'unclassified').length;
      const byClass = {};
      for (const r of rows) byClass[r.className] = (byClass[r.className] || 0) + 1;
      const shown = all ? rows : active.concat(unclassified);
      const pendingSettlement = rows.filter((r) => r.progress === 'verified' && r.ledger === 'backlog')
        .sort((a, b) => a.id.localeCompare(b.id));
      const receipt = ok(cmd, {
        count: shown.length,
        activeCount: active.length,
        pendingSettlement: { count: pendingSettlement.length, nodes: pendingSettlement },
        unclassifiedCount: unclassified.length,
        unclassifiedTotal,
        unclassified,
        byClass,
        activeClasses: [...ACTIVE_CLASSES],
        criterion: 'class ∈ 活帐类 且 progress ∉ {verified, cancelled}；未分类且未完成节点单列计入 count（O3 不静默漏出）',
        nodes: shown.sort((a, b) => a.id.localeCompare(b.id)),
        ...(all ? {} : { note: '默认列活帐类 + 未分类未完成节点（unclassified 单列）；--all 列全部含未分类' }),
      });
      if (unclassified.length > 0) {
        receipt.diagnostics = [{
          rule: 'unclassified_nodes',
          severity: 'warning',
          subject: 'state active',
          evidence: '本账有 ' + unclassified.length + ' 个节点无 class 轴（账务分类）且未完成（另有 ' + (unclassifiedTotal - unclassified.length) + ' 个已终态无 class，合计 ' + unclassifiedTotal + ' 个）——它们不进活帐类统计，长期不可见会账实脱节；补救 = state set --node <id> --axis class --value <declared|registry|container|task|debt|batch-gated|trigger-gated>（新节点 O3 起建号即必填 class）',
          supportedFixes: ['state set --node <id> --axis class --value task|debt|declared|... --reason <r> --owner <o>'],
        }];
      }
      printAndExit(receipt, 0);
      return;
    }

    if (sub === 'get') {
      requireArgs(args, ['node']);
      const node = findNode(sidecar, args.node);
      if (!node) {
        printAndExit(failed(cmd, [diag('node_not_found', '节点不存在：' + args.node, args.node)]), 1);
        return;
      }
      const lastEvent = (node.history && node.history.length > 0) ? node.history[node.history.length - 1] : null
      printAndExit(ok(cmd, {
        // 可选 class（O3 账务分类）：原样取 node.class——无该字段时 JSON.stringify 自然省略，
        // 显式 null/空串/未来未知值一律原样返回（读方自行判读，不在此处归一或补默认值）。读命令，不写账。
        node: args.node, class: node.class, owner: node.owner, truth: node.truth, progress: node.progress,
        ledger: node.ledger, evidenceCount: (node.evidence || []).length, historyCount: (node.history || []).length,
        ...(lastEvent ? { lastHistory: { kind: lastEvent.kind, at: lastEvent.at, reason: (lastEvent.reason || '').slice(0, 120) } } : {}),
      }), 0);
      return;
    }

    if (sub === 'set') {
      requireArgs(args, ['node', 'axis', 'value', 'reason', 'owner']);
      if (!isAxis(args.axis)) {
        printAndExit(failed(cmd, [diag('unknown_axis', 'axis 必须是 truth|progress|ledger|class（O3 起 class 为建号必填轴）', args.axis)]), 1);
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
      // O3（2026-09-14 设计件 §2 O3）：class 轴建号必填——新建节点的首个写入须带 class
      // （--axis class 或 --class <值> 二选一；demo-b 实测 2 条无 class 节点被 state active 默认视图
      // 静默漏出）。只约束**新建**：存量节点（含本刀之前的无 class 节点）照常可写可改，不追溯补分类。
      // --class 与 --kind meta 同模式：建号/补分类通道，不改写已有分类（改写须走 --axis class 独立事件留痕）。
      const classFlag = args.class;
      let classAssigned = null;
      if (classFlag !== undefined) {
        if (!isValidState('class', classFlag)) {
          printAndExit(failed(cmd, [diag('invalid_state_value', classFlag + ' 不在 class 状态集（' + CLASS_STATES.join('|') + '）', 'class')]), 1);
          return;
        }
        if (args.axis === 'class' && classFlag !== args.value) {
          printAndExit(failed(cmd, [diag('bad_args', '--class 与 --axis class 的 --value 冲突（' + classFlag + ' vs ' + args.value + '）', args.node)]), 1);
          return;
        }
        if (nodeExisted && typeof existing.class === 'string' && existing.class !== classFlag) {
          printAndExit(failed(cmd, [diag('bad_args', '--class 不改写已有分类（现值 ' + existing.class + '）：改分类请用 state set --axis class --value ' + classFlag + '（独立事件留痕）', args.node)]), 1);
          return;
        }
      }
      if (!nodeExisted && args.axis !== 'class' && classFlag === undefined) {
        printAndExit(failed(cmd, [diag('class_required', '新建节点必须先声明 class 轴（账务分类，O3/2026-09-14）：加 --axis class --value <declared|registry|container|task|debt|batch-gated|trigger-gated>，或在本次写入带 --class <同类值>；存量节点（含历史无 class 节点）不受本约束', args.node)], { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      const axisHadValue = nodeExisted && existing[args.axis] !== undefined && existing[args.axis] !== null;
      const node = ensureNode(sidecar, args.node, args.owner);
      if (!nodeExisted && args.kind === 'meta') node.kind = 'meta';
      // O3：--class 在建号/补分类时赋 class（同一 history 事件内以 event.class 留痕，不另起事件）；
      // 已有分类不在此改写（上方已拦），--axis class 路径由下方 node[args.axis]=args.value 自然落值。
      if (classFlag !== undefined && node.class !== classFlag && args.axis !== 'class') {
        node.class = classFlag;
        classAssigned = classFlag;
      }
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
      const policy = checkStateWritePolicy({ before: node, after: { ...node, [args.axis]: args.value }, operation: 'set', axis: args.axis, correction: !!args.correction, nodeId: args.node });
      if (policy.diagnostics.length > 0) {
        printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      const corrected = a2.admittedCorrection || policy.admittedRules.length > 0;
      node[args.axis] = args.value;
      const event = { at: new Date().toISOString(), kind: 'set', axis: args.axis, from: before, to: args.value, reason: args.reason, by: args.owner };
      if (classAssigned) event.class = classAssigned; // O3：建号/补分类的 class 赋值与本轴写入同事件留痕
      if (corrected) event.corrected = true;
      if (truthGate.receipt) {
        event.receipt = truthGate.receipt;
        recordTruthReceipt(node, args.value, truthGate.receipt, event.at);
      }
      appendHistory(node, event);
      saveSidecar(path, sidecar);
      const a2Rule = corrected ? 'A2-correction' : ((!nodeExisted || !axisHadValue) ? 'A2-init' : 'A2');
      printAndExit(ok(cmd, { node: args.node, axis: args.axis, from: before, to: args.value, ...(classAssigned ? { classAssigned } : {}), receipt: { rule: a2Rule, status: 'ok' } }), 0);
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
      // O1：锚根白名单硬校验（error 非 warning）——门未激活（自由侧车）不拦任何写，旧调用零硬 fail；
      // 配置「已存在但坏」= fail-loud 结构化 failed（见 anchorRootCheck）。evidence-add 维持「lint 属读方」：
      // 目标文件不存在不阻断登记，但该锚不可能支撑完成声称（settle/import/report 三道守卫会拦，见缺陷3）。
      const rootCheck = anchorRootCheck(args, sidecar, path, abs.locator);
      if (!rootCheck.ok) {
        printAndExit(failed(cmd, rootCheck.diagnostics), 1);
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
      appendHistory(node, { at: new Date().toISOString(), kind: 'evidence-add', locator: abs.locator, rebless: rebless || undefined, ...(args.reason ? { reason: args.reason } : {}) });
      saveSidecar(path, sidecar);
      const addReceipt = ok(cmd, { node: args.node, evidence: node.evidence, anchorRoot: anchorRootReceipt(rootCheck.rootCtx, rootCheck.exemptions, rootCheck.verdict), receipt: { rule: 'A3', status: 'ok' } });
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
      addReceipt.diagnostics = [].concat(addReceipt.diagnostics || [], anchorRootWarnings(rootCheck.rootCtx, rootCheck.verdict));
      if (addReceipt.diagnostics.length === 0) delete addReceipt.diagnostics;
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
      const policy = checkStateWritePolicy({ before: node, after: { ...node, evidence: evidence.filter((_, i) => i !== idx) }, operation: 'evidence-remove', nodeId: args.node });
      if (policy.diagnostics.length > 0) {
        printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
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
      // O1：新锚同样过锚根白名单（旧锚 from 不校验——坏的存量锚必须能改出去，不能被困死）；
      // 配置已存在但坏 = fail-loud（见 anchorRootCheck）。
      const rootCheck = anchorRootCheck(args, sidecar, path, toAbs.locator);
      if (!rootCheck.ok) {
        printAndExit(failed(cmd, rootCheck.diagnostics), 1);
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
      appendHistory(node, { at: new Date().toISOString(), kind: 'evidence-reanchor', from: fromAbs.locator, to: toAbs.locator, ...(args.reason ? { reason: args.reason } : {}) });
      saveSidecar(path, sidecar);
      const reanchorReceipt = ok(cmd, { node: args.node, from: fromAbs.locator, to: toAbs.locator, hash: h, anchorRoot: anchorRootReceipt(rootCheck.rootCtx, rootCheck.exemptions, rootCheck.verdict) });
      const reanchorDiags = anchorRootWarnings(rootCheck.rootCtx, rootCheck.verdict);
      if (reanchorDiags.length > 0) reanchorReceipt.diagnostics = reanchorDiags;
      printAndExit(reanchorReceipt, 0);
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
      // truth 缺失/null 视为 candidate（契约 §2 truth 回执门禁同口径），存量节点不因字段缺失卡死。
      const current = args.axis === 'truth' && node.truth == null ? 'candidate' : node[args.axis];
      if (current !== args.from) {
        printAndExit(failed(cmd, [diag('transition_from_mismatch', 'transition 的 from 必须等于节点当前 ' + args.axis + ' 状态：当前为 ' + current + '，收到 ' + args.from, args.node)]), 1);
        return;
      }
      const verdict = validateTransition(args.axis, args.from, args.to);
      if (!verdict.ok) {
        printAndExit(failed(cmd, verdict.diagnostics), 1);
        return;
      }
      const policy = checkStateWritePolicy({ before: node, after: { ...node, [args.axis]: args.to }, operation: 'transition', axis: args.axis, correction: !!args.correction, nodeId: args.node });
      // Existing progress/ledger guards precede the receipt gate; new truth evidence
      // diagnostics follow it so missing/invalid receipts keep their priority.
      if (args.axis !== 'truth' && policy.diagnostics.length > 0) {
        printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      // 提案③门禁：truth 前进写入必须有负责人本地回执文件（置于 A2/A3 之后，非法迁移仍先报 illegal_transition）。
      const truthGate = checkTruthReceipt({ axis: args.axis, from: args.from, to: args.to, receipt: args.receipt });
      if (!truthGate.ok) {
        printAndExit(failed(cmd, truthGate.diagnostics), 1);
        return;
      }
      if (policy.diagnostics.length > 0) {
        printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      const corrected = policy.admittedRules.length > 0;
      node[args.axis] = args.to;
      const event = { at: new Date().toISOString(), kind: 'transition', axis: args.axis, from: args.from, to: args.to, reason: args.reason, by: args.owner };
      if (corrected) event.corrected = true;
      if (truthGate.receipt) {
        event.receipt = truthGate.receipt;
        recordTruthReceipt(node, args.to, truthGate.receipt, event.at);
      }
      appendHistory(node, event);
      saveSidecar(path, sidecar);
      printAndExit(ok(cmd, { node: args.node, axis: args.axis, from: args.from, to: args.to, receipt: { rule: corrected ? 'A2-correction' : 'A2', status: 'ok' } }), 0);
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
      const canSettleProgress = ['in_progress', 'verified'].includes(node.progress);
      const canSettleLedger = ['clean', 'backlog'].includes(node.ledger);
      if (!canSettleProgress) {
        printAndExit(failed(cmd, [diag('illegal_transition', '销账要求 progress∈{in_progress,verified}，当前为 ' + node.progress, args.node)]), 1);
        return;
      }
      if (node.ledger === 'settled') {
        printAndExit(failed(cmd, [diag('already_settled', '账务轴已是 settled 终态', args.node)]), 1);
        return;
      }
      if (!canSettleLedger) {
        printAndExit(failed(cmd, [diag('illegal_transition', '销账要求 ledger∈{clean,backlog}，当前为 ' + node.ledger, args.node)]), 1);
        return;
      }
      const policy = checkStateWritePolicy({ before: node, after: { ...node, progress: 'verified', ledger: 'settled' }, operation: 'settle', nodeId: args.node });
      if (policy.diagnostics.length > 0) {
        printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
        return;
      }
      // 图绑定的计算时点（上轮审核）：放在 commit **之前**——save 之后再算，一旦映射/spec 读取异常，
      // 失败就发生在已提交之后（账已落、回执却失败）；且本计算整体非阻断（任何异常 → unavailable 诊断）。
      let graphBinding;
      try {
        graphBinding = bindingStatusFor(args.node, node.specRefs, path, sidecar.nodes);
      } catch (e) {
        graphBinding = { verdict: 'unavailable', diagrams: [], checked: 0, error: e.message };
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
      // P1 余项（2026-09-11）：图账绑定入销账链——销账回执直接携带该节点的图绑定状态；
      // 未分类且未绑定 ⇒ 提示（结构性节点该上图，或用 state spec-ref 认领）。纯增字段，不阻断销账。
      const settleReceipt = { rule: 'A2-cross-axis-settle', status: 'ok', dualWrite: true, graphBinding };
      if (graphBinding.verdict === 'unbound') {
        if (typeof node.class !== 'string') {
          settleReceipt.diagnostics = [diag('a1-settle-unbound', '销账节点未绑定任何图且未分类——若为结构性节点应上图；否则用 state spec-ref 认领或归入 class', args.node, 'warning')];
        }
      }
      printAndExit(ok(cmd, { node: args.node, from: before, to: { progress: 'verified', ledger: 'settled' }, next, lessonPrompt: LESSON_PROMPT, receipt: settleReceipt }), 0);
      return;
    }

    if (sub === 'import') {
      // 历史/迁移导入的唯一合法跨轴写（0.17.0，路线一裁定；蓝本 = Liquibase MARK_RAN：
      // 与 settle 并列的独立事件类型，绝非 settle 别名）——原子双写 progress=verified + ledger=settled，
      // 强制 ≥1 条证据锚（写边同 evidence-add 校验+哈希），history kind='import' 携带 source/cutoff 溯源；
      // 只登记新节点或零执行史节点（progress=planned 且 ledger=clean），执行闭环请用 state settle。
      requireArgs(args, ['node', 'reason', 'owner', 'locator']);
      const existing = findNode(sidecar, args.node);
      // 建号校验与 set 同则（0.12.0 id 白名单 + 0.13.0 L1 前缀门）：只拦新建，存量 grandfather。
      if (!existing && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(args.node)) {
        printAndExit(failed(cmd, [diag('invalid_node_id', '非法节点 id：' + JSON.stringify(args.node) + '（建号白名单 ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$：字母数字开头，仅允许 . _ -，≤128 字符）', args.node)]), 1);
        return;
      }
      if (gate && !existing && !prefixAllowed(args.node, gate.prefixes)) {
        printAndExit(failed(cmd, [diag('project_prefix_gate', '新节点 id ' + JSON.stringify(args.node) + ' 不以本侧车项目前缀开头（允许前缀：' + gate.prefixes.join(' | ') + '（形如 <项目名>-*）；存量节点不受限；注册表 ' + gate.registryPath + '）', args.node)]), 1);
        return;
      }
      if (existing) {
        if (existing.owner !== args.owner) {
          printAndExit(failed(cmd, [diag('owner_mismatch', '节点属主为 ' + existing.owner + '，写入者 ' + args.owner + ' 无权（A4）', args.node)]), 1);
          return;
        }
        if (existing.ledger === 'settled') {
          printAndExit(failed(cmd, [diag('already_settled', '账务轴已是 settled 终态', args.node)]), 1);
          return;
        }
        const progressMoved = existing.progress !== undefined && existing.progress !== null && existing.progress !== 'planned';
        const ledgerMoved = existing.ledger !== undefined && existing.ledger !== null && existing.ledger !== 'clean';
        if (progressMoved || ledgerMoved) {
          printAndExit(failed(cmd, [diag('import_conflict', 'import 只登记零执行史节点的历史闭环（新节点或 progress=planned 且 ledger=clean）；该节点 progress=' + existing.progress + ' ledger=' + existing.ledger + '——执行闭环请用 state settle', args.node)]), 1);
          return;
        }
      }
      const classFlag = args.class;
      if (classFlag !== undefined) {
        if (!isValidState('class', classFlag)) {
          printAndExit(failed(cmd, [diag('invalid_state_value', classFlag + ' 不在 class 状态集（' + CLASS_STATES.join('|') + '）', 'class')]), 1);
          return;
        }
        if (existing && typeof existing.class === 'string' && existing.class !== classFlag) {
          printAndExit(failed(cmd, [diag('bad_args', '--class 不改写已有分类（现值 ' + existing.class + '）：改分类请用 state set --axis class --value ' + classFlag + '（独立事件留痕）', args.node)]), 1);
          return;
        }
      }
      // 证据写边统一校验（缺陷2：import 此前完全绕过锚根白名单——evidence-add 根外拒写，import 却能 verified+settled）；
      // requireResolvable=true（缺陷3：import 即完成声称，锚必须可解析——文件存在 + 行号在界）。
      const writeCheck = evidenceWriteCheck(args, sidecar, path, args.locator, { requireResolvable: true });
      if (!writeCheck.ok) {
        printAndExit(failed(cmd, writeCheck.diagnostics), 1);
        return;
      }
      const node = ensureNode(sidecar, args.node, args.owner);
      node.evidence = node.evidence || [];
      if (!node.evidence.includes(writeCheck.locator)) node.evidence.push(writeCheck.locator);
      // 与 evidence-add 同款落锚哈希（锁口②）：锚行内容哈希入 evidenceMeta，读方三态判定 ok/drifted/unhashed。
      const h = computeLocatorHash(writeCheck.locator, process.cwd());
      if (h !== null) {
        node.evidenceMeta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
        node.evidenceMeta[writeCheck.locator] = { h, at: new Date().toISOString() };
      }
      const policy = checkStateWritePolicy({ before: existing, after: { ...node, progress: 'verified', ledger: 'settled' }, operation: 'import', nodeId: args.node });
      if (policy.diagnostics.length > 0) {
        printAndExit(failed(cmd, policy.diagnostics), 1);
        return;
      }
      const before = { progress: node.progress, ledger: node.ledger };
      node.progress = 'verified';
      node.ledger = 'settled';
      const event = { at: new Date().toISOString(), kind: 'import', from: before, to: { progress: 'verified', ledger: 'settled' }, reason: args.reason, by: args.owner, locator: writeCheck.locator };
      if (classFlag !== undefined) {
        node.class = classFlag;
        event.class = classFlag;
      }
      event.source = args.source === undefined ? null : String(args.source);
      event.cutoff = args.cutoff === undefined ? null : String(args.cutoff);
      appendHistory(node, event);
      // 与 settle 同款自动投递（B3）：kind 枚举限 settled|blocked|note，导入即销账通知，summary 带 [import] 前缀以便席位区分。
      addNotice(sidecar, { from: args.owner, kind: 'settled', node: args.node, summary: '[import] ' + args.reason });
      saveSidecar(path, sidecar);
      const next = '销账五动作第4步：atlas-engine report --sidecar ' + path + ' 生成销账回执';
      printAndExit(ok(cmd, { node: args.node, from: before, to: { progress: 'verified', ledger: 'settled' }, next, lessonPrompt: LESSON_PROMPT, receipt: { rule: 'A2-cross-axis-import', status: 'ok', dualWrite: true, provenance: 'imported', anchorRoot: anchorRootReceipt(writeCheck.rootCheck.rootCtx, writeCheck.rootCheck.exemptions, writeCheck.rootCheck.verdict) } }), 0);
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
    if (e.code === 'bad_args') {
      printAndExit(failed(cmd, [diag('bad_args', e.message, cmd)]), 1);
      return;
    }
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

function runReport(argv) {
  let args;
  try {
    args = parseArgs(argv, FLAGS.report);
  } catch (e) {
    printAndExit(failed('report', [diag('bad_args', e.message, argv.join(' '))]), 1);
    return;
  }
  try {
    const sidecarPath = sidecarPathOf(args);
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
    // specNames（图名=basetname 去扩展名）随 spec 一起传入：diagram-nonaccounts.json 的分组键与 specRefs 的
    // 图限定都按图名解析（缺陷4：跨图同局部 ID 误豁免）。
    const specs = [];
    const specNames = [];
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
        specNames.push(path.basename(String(file)).replace(/\.json$/, ''));
      }
    }
    // 非账本实体声明与侧车同目录（同 projects.json 模式）：<侧车目录>/diagram-nonaccounts.json，无文件=零破坏。
    const nonAccountsPath = sidecarPath.replace(/[^/]*$/, '') + 'diagram-nonaccounts.json';
    const report = buildReport(sidecar, { slice: args.slice || null, root: args.root || '.', verify, codeSha: args['code-sha'] || null, specSha: args['spec-sha'] || null, specs, specNames, replays: args.replay === undefined ? [] : [].concat(args.replay), brief: !!args.brief, nonAccountsPath });
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
      // O2（2026-09-14）：失败信封必须同时携带 evidenceHead——HEAD 不一致本就是失败因由之一，
      // 恰在出错时藏明细会重演 0.4.0「详见 data.layout.diagnostics 但 data 不存在」的缺陷。
      const failData = args.brief ? report : Object.assign(
        report.a1 ? { a1: report.a1 } : {},
        { evidenceHead: report.evidenceHead }
      );
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
    // O5（2026-09-14 设计件 §2 O5）：逐闸 detail 落 <atlas>/data/<project>/gate-detail.jsonl
    // （append-only，成败均落）；--no-trace 关闭（与自动留痕同开关）；无 --sidecar / 非 atlas 语境 → null。
    const detailLog = args.noTrace ? null : appendGateDetail({ diagram: args.diagram, sidecar: args.sidecar ? sidecarPathOf(args) : null }, result);
    const gates = {};
    const gateDetail = {};
    for (const [k, v] of Object.entries(result.results || {})) {
      gates[k] = v.exit;
      // O5：逐闸 detail 同时入 trace（kind=command 的 detail.result，纯增字段；JSONL 才是 append-only 主账）。
      gateDetail[k] = { status: v.status, exit: v.exit, ms: v.ms === undefined ? null : v.ms };
    }
    for (const name of GATE_NAMES) {
      if (!gateDetail[name]) gateDetail[name] = { status: 'skip', exit: null, ms: null };
    }
    const traceEntry = {
      params: { diagram: args.diagram, out: args.out },
      result: { final: result.final, stage: result.stage, gates, gateDetail, detailLog: detailLog ? detailLog.path : null },
      note: 'gate final=' + result.final + (result.stage ? ' stage=' + result.stage : ''),
    };
    if (result.final === 'pass') {
      const trace = autoTrace('gate', args, traceEntry);
      const receipt = ok('gate', Object.assign({}, result, detailLog ? { detailLog } : {}));
      const diags = [];
      if (trace) diags.push(trace);
      const placement = gateOutPlacementDiag(args.out);
      if (placement) diags.push(placement);
      if (diags.length > 0) receipt.diagnostics = diags;
      printAndExit(receipt, 0);
    } else {
      const trace = autoTrace('gate', args, traceEntry);
      // 机读因由（缺陷7）：失败细分因由进规则码（gate_<reason>）与 data，不只停在 stage——
      // 「内核退出码失败 / 回执契约不符 / 超时 / 产物归属不符 / Chrome 不可用」形状各异，规则码须可分辨。
      const reason = result.reason || result.stage;
      const diags = [diag('gate_' + reason, '三闸停在 ' + result.stage + '：' + (result.tail || result.diagnostic || ''), result.stage)];
      if (trace) diags.push(trace);
      const placement = gateOutPlacementDiag(args.out);
      if (placement) diags.push(placement);
      // B4：gate fail 回执附回写提示（纯增 data 字段）；O5：逐闸历史落点一并披露（写失败降级不阻断）。
      const failData = Object.assign(
        { lessonPrompt: LESSON_PROMPT, final: result.final, stage: result.stage, reason: result.reason || null },
        detailLog ? { detailLog } : {},
      );
      printAndExit(failed('gate', diags, failData), 1);
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
      'atlas-engine state spec-ref --node <id> --ref <图件id> [--remove [true|false]] [--diagram <图名>] [--sidecar <path>]（A3：显式认领图件 id；--diagram 落账为 <图名>/<图内id> 限定该图生效，不带则全图生效——认领后 A1 不再报图件未入账）',
      'atlas-engine state active [--all] [--sidecar <path>]（活帐视图：默认列未完成活跃分类及未分类节点；--all 列全部；pendingSettlement 独立列出 verified/backlog 待销账节点）',
      'atlas-engine state get --node <id> [--sidecar <path>]（读属主与三轴当前值；回执含可选 class=账务分类——节点有则原样列出，无则省略）',
      'atlas-engine state set --node <id> --axis truth|progress|ledger|class --value <v> --reason <text> --owner <o> [--receipt <回执文件>] [--correction] [--kind meta] [--class <账务分类>] [--sidecar <path>]（class=账务分类：declared|registry|container|task|debt|batch-gated|trigger-gated；O3 起新建节点必须带 class——--axis class 或 --class <同类值>，否则 exit 1 class_required；--class 不改写已有分类）',
      'atlas-engine state transition --node <id> --axis truth|progress|ledger|class --from <s> --to <t> --reason <text> --owner <o> [--receipt <回执文件>] [--sidecar <path>]',
      'atlas-engine state evidence-add --node <id> --locator <文件:行号> [--reason <text>] [--allow-root <根>] [--sidecar <path>]（O1 锚根白名单：<侧车同目录>/projects.json 的 sourcePath ∪ atlas 根 ∪ anchor-roots.json ∪ --allow-root；根外锚 exit 1，存量走 anchor-root-exemptions.json 一次性豁免；--reason 记入 history 事件）',
      'atlas-engine state evidence-remove --node <id> --locator <锚> [--sidecar <path>]（移除+A3 守卫）｜ state evidence-reanchor --node <id> --from <旧锚> --to <新锚> [--reason <text>] [--allow-root <根>] [--sidecar <path>]（drifted 处置规范路径：原子改锚；新锚同过 O1 锚根白名单；锚改删禁手改 JSON）',
      'atlas-engine state settle --node <id> --reason <text> --owner <o> [--sidecar <path>]（progress 为 in_progress/verified 且 ledger 为 clean/backlog 时，一次事件写 verified+settled）',
      'atlas-engine state import --node <id> --reason <text> --owner <o> --locator <文件:行号> [--class <分类>] [--source <来源系统>] [--cutoff <截止日期>] [--sidecar <path>]（0.17.0：历史/迁移导入的唯一合法跨轴写——原子双写 verified+settled，强制证据锚，history kind=import 带溯源；只登记新节点或零执行史节点）',
      'atlas-engine state block --node <id> --reason <text> --owner <o> [--with-backlog] [--sidecar <path>]',
      '  set/transition：truth 轴前进写入必填 --receipt <负责人本地回执文件>（缺失/null 初态按 candidate；机器只校验普通文件，不校验语义）；set 对已存在节点轴值变更同过 A2 迁移表（2026-08-15 裁定④，不再架空），初始化/该轴首写免表，违表=exit 1 illegal_transition，确属纠错加 --correction（实际豁免规则时 history 事件 corrected:true 留痕；不免除 truth 回执与证据）；证据守卫：verified 与 truth effective/closed 要求非空可解析锚，cancelled 要求非空（含首次写）、set ledger→settled=settled_requires_event（只能经 settle/import 事件；同值原地写不拦；既有 --correction 通道保留；仅 set 可初始化缺失账本）',
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
      'atlas-engine compile --diagram <spec.json> --sidecar <state.json> --out <compiled.json> [--previous-receipt <compile-receipt.json>] [--no-trace]',
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
      '[gate] 串行三闸（archify validate → deliver → visual-check）；给 --sidecar 时运行后自动留痕（--no-trace 关闭）且逐闸 detail 落 <atlas>/data/<项目>/gate-detail.jsonl（append-only 历史）',
      'atlas-engine gate --diagram <compiled.json> --out <out.html> [--sidecar <path>] [--no-trace]（--no-trace 同时关闭 gate-detail.jsonl 落盘）',
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
      '[doctor] 环境自检（8 检查；--stats 需 --sidecar：账本侧派生度量；evidence-resolvability/ledger-size/head-anchor-consistency 为 warning 级，不使 exit 1）',
      'atlas-engine doctor [--sidecar <path>] [--atlas <图谱目录>] [--stats]',
    ],
    run: runDoctorCli,
  },
];

// ---------- 帮助文本拼装（骨架固定，命令行全部取自注册表 usage 字段） ----------
// 版本印在首行而非独立 --version 旗标（2026-09-18 裁定：旗标预算 50/50 已满，需求只是「看到版本」）。
const USAGE_HEADER = 'atlas-engine ' + ENGINE_VERSION + ' — ADD 图谱驱动研发体系 L2 状态机层 CLI（统一 JSON 回执信封，契约见 specs/command-contract.md）';
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
