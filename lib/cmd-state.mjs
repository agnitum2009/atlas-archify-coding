// state 命令实现：前奏 + 11 子命令 + 锚根白名单助手（自 lib/commands.mjs 拆出，减法批三；注册表与 --help 仍在 commands.mjs）。
import { FLAGS } from './cli-options.mjs';
import { isAxis, isValidState, validateTransition, ACTIVE_CLASSES, CLASS_STATES } from './state-machine.mjs';
import { checkStateWritePolicy, unresolvableEvidenceDiag } from './state-policy.mjs';
import { checkTruthReceipt, recordTruthReceipt } from './truth-receipt.mjs';
import { ok, failed } from './envelope.mjs';
import { loadSidecar, saveSidecar, findNode, ensureNode, appendHistory } from './store.mjs';
import { lintLocator, absoluteLocator, computeLocatorHash } from './evidence.mjs';
import { parseSpecRef, formatSpecRef } from './spec-id.mjs';
import { loadAnchorRootContext, ensureGrandfatheredExemptions, anchorRootVerdict, ANCHOR_ROOTS_FILE, ANCHOR_EXEMPTIONS_FILE } from './anchor-roots.mjs';
import { bindingStatusFor } from './report.mjs';
import { addNotice } from './notice.mjs';
import { parseArgs, diag, printAndExit, requireArgs, sidecarPathOf, sidecarOpFailure, LESSON_PROMPT } from './cli-util.mjs';
import { loadProjectGate, prefixAllowed, seatAllowed } from './project-gate.mjs';

// O1（2026-09-14 设计件 O1）：写边锚根白名单校验——返回 { ok, diagnostics, rootCtx, exemptions, verdict }。
// 白名单/豁免基建的解析与首跑豁免生成都在此收口，evidence-add / evidence-reanchor / import 共用（勿复制三份）。
// --allow-root 单次追加白名单；首跑对存量账生成 grandfathered 豁免清单（见 lib/anchor-roots.mjs）。
// 配置「已存在但坏」（projects.json / anchor-roots.json 不可解析或形状坏）= fail-loud 结构化 failed（exit 1），
// 不再静默降级为「门未激活」——坏配置不得解除已声明的门；只有「配置不存在」才是 opt-in 不启用。
export function anchorRootCheck(args, sidecar, sidecarPath, locator) {
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
export function evidenceWriteCheck(args, sidecar, sidecarPath, rawLocator, { requireResolvable = false, cwd = process.cwd() } = {}) {
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
export function anchorRootReceipt(rootCtx, exemptions, verdict) {
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

export function anchorRootDeniedDiag(verdict, rootCtx) {
  const roots = rootCtx.roots.map((r) => r.root).join(' | ') || '（白名单为空）';
  return diag(
    'anchor_root_denied',
    (verdict.reason === 'unresolvable-path'
      ? '锚物理路径不可解析（dangling symlink/不可访问的祖先），拒绝按逻辑路径授予许可：' + verdict.file
      : '锚根不在白名单（O1 写边硬校验）：' + verdict.file + ' 不在 [' + roots + ']') +
      '；处置 = 把证据移到登记仓/atlas 根内，或 --allow-root <根>（单次生效），或在 <侧车同目录>/' + ANCHOR_ROOTS_FILE + ' 显式登记该根；存量错根锚走 <侧车同目录>/' + ANCHOR_EXEMPTIONS_FILE + ' 一次性豁免',
    verdict.file
  );
}

// 白名单相关 warning（豁免命中 / --allow-root 被拒），与既有 nearDup/rebless 警告并列，不改变其顺序。
export function anchorRootWarnings(rootCtx, verdict) {
  const out = [];
  if (verdict && verdict.exempted) {
    out.push(diag('anchor_root_grandfathered',
      '该锚在 grandfathered 豁免清单内（' + verdict.exemption.reason + '）：写边放行但不等于根合法——复核后 evidence-reanchor 回白名单内，并从 ' + ANCHOR_EXEMPTIONS_FILE + ' 删除该条目',
      verdict.exemption.path, 'warning',
      ['state evidence-reanchor --node <id> --from ' + verdict.exemption.path + ':<行> --to <白名单内锚>']));
  }
  for (const r of rootCtx.rejected.filter((x) => x.source === 'cli')) {
    out.push(diag('anchor_root_rejected', '--allow-root 被拒（' + r.reason + '）：单次白名单未追加该根', r.root, 'warning',
      ['改用绝对路径且非 dist/.next/临时目录的根']));
  }
  return out;
}

function stateWritePolicy(ctx, parameters) {
  return checkStateWritePolicy({ ...parameters, evidenceCheck: locators => {
    const check = anchorRootCheck(ctx.args, ctx.sidecar, ctx.sidecarPath, null);
    if (!check.ok) return check.diagnostics;
    if (!check.rootCtx.active) return [];
    return locators.flatMap(locator => {
      const verdict = anchorRootVerdict(locator, check.rootCtx, check.exemptions.entries);
      return verdict.ok || verdict.reason === 'bad_locator' ? [] : [anchorRootDeniedDiag(verdict, check.rootCtx)];
    });
  } });
}

// state 前奏：parseArgs → --correction 唯一入口 → 载侧车（显式 --sidecar 的 set 可初始化）→ 项目门 → 席位门。
// 成功返回上下文；任一步失败已打印回执并返回 null。
export function stateContext(argv) {
  const sub = argv[0];
  let args;
  try {
    args = parseArgs(argv.slice(1), FLAGS.state);
  } catch (e) {
    printAndExit(failed('state.' + sub, [diag('bad_args', e.message, ['state', ...argv].join(' '))]), 1);
    return null;
  }

  const cmd = 'state.' + sub;
  // ADD-SPEC §2.4.2 唯一入口（0.22.0）：纠错只豁免 P 族路径规则，且只由 state set 接受——transition 即「严格沿
  // P 族迁移」，其他子命令无路径规则可豁免；静默忽略旗标会让调用方误以为纠错生效。
  if (args.correction && sub !== 'set') {
    printAndExit(failed(cmd, [diag('bad_args', '--correction 只被 state set 接受（ADD-SPEC §2.4.2 纠错唯一入口）；纠错请改用 state set --correction（只豁免路径规则 illegal_transition/settled_requires_event，状态/权限/证据规则不豁免）', ['state', ...argv].join(' '))]), 1);
    return null;
  }
  const sidecarPath = sidecarPathOf(args);
  let sidecar;
  try {
    sidecar = loadSidecar(sidecarPath);
  } catch (e) {
    if (e.code === 'sidecar_missing' && sub === 'set' && args.sidecar) {
      // 首次使用：初始化空 sidecar（set 的「仅限初始化」语义）。审核批 2026-09-18：须显式 --sidecar；
      // 缺省路径（cwd/atlas-state.json）缺失一律 sidecar_missing，不在 cwd 悄悄造幽灵账本（空态绿）。
      sidecar = { schemaVersion: 1, atlas: null, nodes: {} };
    } else {
      printAndExit(failed(cmd, [diag(e.code || 'sidecar_error', e.message, sidecarPath)]), 1);
      return null;
    }
  }

  // L1/L2 越界门禁（0.13.0，负责人令 2026-08-27）：注册表 opt-in（projects.json 条目 sidecar 字段映射本侧车）才激活。
  // 配置「已存在但坏」（不可解析/形状坏）≠ 未激活：坏配置不得解除已声明的门，fail-loud 结构化 failed（exit 1），
  // 不逃逸成顶层 internal/exit 2（上轮审核）。
  // L2 席位门先行（你是谁）；args.owner 缺省时不在北拦截（交给 requireArgs 报 bad_args，诊断序不变）。
  let gate = null;
  if (sub === 'set' || sub === 'transition' || sub === 'settle' || sub === 'block' || sub === 'import') {
    try {
      gate = loadProjectGate(sidecarPath);
    } catch (e) {
      if (e && e.code === 'project_gate_config_invalid') {
        printAndExit(failed(cmd, [diag(e.code, e.message, sidecarPath)]), 1);
        return null;
      }
      throw e;
    }
  }
  if (gate && args.owner !== undefined && !seatAllowed(args.owner, gate.seats)) {
    printAndExit(failed(cmd, [diag('seat_gate', '席位 ' + JSON.stringify(args.owner) + ' 不在本侧车授权席位清单（允许：' + [...gate.seats].join(', ') + '；注册表 ' + gate.registryPath + '）', args.owner)]), 1);
    return null;
  }

  return { sub, args, cmd, sidecarPath, sidecar, gate };
}

function stateSpecRef(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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

function stateActive(ctx) {
  const { args, cmd, sidecar } = ctx;
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
    receipt.diagnostics = [diag('unclassified_nodes',
      '本账有 ' + unclassified.length + ' 个节点无 class 轴（账务分类）且未完成（另有 ' + (unclassifiedTotal - unclassified.length) + ' 个已终态无 class，合计 ' + unclassifiedTotal + ' 个）——它们不进活帐类统计，长期不可见会账实脱节；补救 = state set --node <id> --axis class --value <declared|registry|container|task|debt|batch-gated|trigger-gated>（新节点 O3 起建号即必填 class）',
      'state active', 'warning',
      ['state set --node <id> --axis class --value task|debt|declared|... --reason <r> --owner <o>'])];
  }
  printAndExit(receipt, 0);
  return;
}

function stateGet(ctx) {
  const { args, cmd, sidecar } = ctx;
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

function stateSet(ctx) {
  const { args, cmd, sidecar, gate, sidecarPath: path } = ctx;
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
  // ADD-SPEC §2.4.2：P（A2 表/settled 专用事件）、A（truth 回执门，--correction 不免除）、S、X 全收集；
  // --correction 只滤除 P 族，实际豁免的规则码记入 waivedRules。
  const truthGate = checkTruthReceipt({ axis: args.axis, from: before, to: args.value, receipt: args.receipt });
  const policy = stateWritePolicy(ctx, { before: { ...node }, after: { ...node, [args.axis]: args.value }, operation: 'set', axis: args.axis, correction: !!args.correction, init: !nodeExisted || !axisHadValue, authority: truthGate.ok ? [] : truthGate.diagnostics, nodeId: args.node });
  if (policy.diagnostics.length > 0) {
    printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
    return;
  }
  const corrected = policy.admittedRules.length > 0;
  node[args.axis] = args.value;
  const event = { at: new Date().toISOString(), kind: 'set', axis: args.axis, from: before, to: args.value, reason: args.reason, by: args.owner };
  if (classAssigned) event.class = classAssigned; // O3：建号/补分类的 class 赋值与本轴写入同事件留痕
  if (corrected) {
    event.corrected = true;
    event.waivedRules = policy.admittedRules;
  }
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

function stateEvidenceAdd(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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
    addReceipt.diagnostics = [diag('evidence_near_duplicate',
      '同文件近邻（±3 行）已有本节点锚：' + nearDup.join(', ') + '——若意图是改锚而非加锚，用 state evidence-reanchor',
      abs.locator, 'warning',
      ['state evidence-reanchor --node ' + args.node + ' --from <旧锚> --to ' + abs.locator])];
  }
  if (rebless) {
    addReceipt.diagnostics = [diag('evidence_reblessed',
      '锚已存在于该节点：本次为**重新加持**（刷新 evidenceMeta 哈希' + (h === null ? '失败，锚仍为 unhashed' : '为 ' + h) + '），未重复添加；evidence 仍为 ' + node.evidence.length + ' 条',
      abs.locator, 'warning',
      ['若意图是换锚而非重新加持，用 state evidence-reanchor --from <旧锚> --to <新锚>'])];
  }
  addReceipt.diagnostics = [].concat(addReceipt.diagnostics || [], anchorRootWarnings(rootCheck.rootCtx, rootCheck.verdict));
  if (addReceipt.diagnostics.length === 0) delete addReceipt.diagnostics;
  printAndExit(addReceipt, 0);
  return;
}

// 0.6.0（一线席位 一线实战反馈）：evidence-add 是追加语义——改锚/删锚此前只能手改侧车 JSON，
// 即绕过 CLI 的 CAS/锁/公理治理面。以下两子命令把锚生命周期写路径补齐进治理面。
function stateEvidenceRemove(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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
  const policy = stateWritePolicy(ctx, { before: node, after: { ...node, evidence: evidence.filter((_, i) => i !== idx) }, operation: 'evidence-remove', nodeId: args.node });
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
function stateEvidenceReanchor(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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

function stateTransition(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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
  // 取值域/未知轴属输入校验，先行短路；违表（illegal_transition）归 P 族，与 A/S/X 一并收集（§2.4.2）。
  const verdict = validateTransition(args.axis, args.from, args.to);
  if (!verdict.ok && verdict.diagnostics[0].rule !== 'illegal_transition') {
    printAndExit(failed(cmd, verdict.diagnostics), 1);
    return;
  }
  const truthGate = checkTruthReceipt({ axis: args.axis, from: args.from, to: args.to, receipt: args.receipt });
  const policy = stateWritePolicy(ctx, { before: { ...node, [args.axis]: args.from }, after: { ...node, [args.axis]: args.to }, operation: 'transition', axis: args.axis, authority: truthGate.ok ? [] : truthGate.diagnostics, nodeId: args.node });
  if (policy.diagnostics.length > 0) {
    printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
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

function stateSettle(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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
  const policy = stateWritePolicy(ctx, { before: node, after: { ...node, progress: 'verified', ledger: 'settled' }, operation: 'settle', nodeId: args.node });
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

function stateImport(ctx) {
  const { args, cmd, sidecar, gate, sidecarPath: path } = ctx;
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
  const policy = stateWritePolicy(ctx, { before: existing, after: { ...node, progress: 'verified', ledger: 'settled' }, operation: 'import', nodeId: args.node });
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

function stateBlock(ctx) {
  const { args, cmd, sidecar, sidecarPath: path } = ctx;
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
  if (args.withBacklog && node.ledger !== 'clean') {
    printAndExit(failed(cmd, [diag('illegal_transition', '--with-backlog 要求 ledger=clean，当前为 ' + node.ledger, args.node)]), 1);
    return;
  }
  const after = { ...node, progress: 'blocked', ...(args.withBacklog ? { ledger: 'backlog' } : {}) };
  const policy = stateWritePolicy(ctx, { before: node, after, operation: 'block', nodeId: args.node });
  if (policy.diagnostics.length > 0) {
    printAndExit(failed(cmd, policy.diagnostics, { lessonPrompt: LESSON_PROMPT }), 1);
    return;
  }
  const before = { progress: node.progress, ledger: node.ledger };
  node.progress = after.progress;
  node.ledger = after.ledger;
  appendHistory(node, { at: new Date().toISOString(), kind: 'block', from: before, to: { progress: node.progress, ledger: node.ledger }, reason: args.reason, by: args.owner });
  // B3（2026-08-15 清单）：block 成功同次写入自动投递一条席位通知（from=--owner，summary=--reason）。
  addNotice(sidecar, { from: args.owner, kind: 'blocked', node: args.node, summary: args.reason });
  saveSidecar(path, sidecar);
  printAndExit(ok(cmd, { node: args.node, from: before, to: { progress: node.progress, ledger: node.ledger }, receipt: { rule: 'A2-cross-axis-block', status: 'ok' } }), 0);
  return;
}

const STATE_SUBCOMMANDS = {
  'spec-ref': stateSpecRef,
  'active': stateActive,
  'get': stateGet,
  'set': stateSet,
  'evidence-add': stateEvidenceAdd,
  'evidence-remove': stateEvidenceRemove,
  'evidence-reanchor': stateEvidenceReanchor,
  'transition': stateTransition,
  'settle': stateSettle,
  'import': stateImport,
  'block': stateBlock,
};

export function runState(argv) {
  const ctx = stateContext(argv);
  if (ctx === null) return;
  const { sub, cmd } = ctx;
  try {
    // hasOwnProperty：sub 为 constructor/__proto__ 等原型链名时不得命中。
    if (Object.prototype.hasOwnProperty.call(STATE_SUBCOMMANDS, sub)) {
      STATE_SUBCOMMANDS[sub](ctx);
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
