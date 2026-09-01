// doctor：环境自检（Node 版本 / archify 内核可用性 / sidecar 可读性 / 可选 atlas 布局校验）。
// 批二（2026-08-15）：增两项 warning 级检查——evidence-resolvability（A1 证据可解析性，原锁在
// report --spec 之后，日常操作面无人听见）+ ledger-size（账本规模阈值，只提示不自动动账）；
// warning 级检查 ok:false 不使整体 failed/exit 1（数据债不该阻断环境自检，契约 §10 写明理由）。
// --stats：账本侧派生度量（需显式 --sidecar），全部单源可算，杜绝手搓度量脚本。

import fs from 'node:fs';
import path from 'node:path';
import { resolveArchify, probeArchifyVersion, isBelowBaseline, ARCHIFY_BASELINE } from './resolve-archify.mjs';
import { validateLayout } from './layout.mjs';
import { parseLocator, anchorState, anchorQuality } from './evidence.mjs';
import { isTruthAdvance } from './truth-receipt.mjs';
import { TRACE_KINDS } from './trace.mjs';

// ledger-size 阈值（契约 §10）：侧车 >1MB 或 trace >1000 条 → warning 提示冷归档 history/ 区。
export const LEDGER_SIZE_BYTES = 1024 * 1024;
export const LEDGER_SIZE_TRACES = 1000;

export function runDoctor(opts) {
  const o = opts || {};
  const checks = [];
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 18;
  checks.push({ name: 'node>=18', ok: nodeOk, detail: 'node ' + process.versions.node });

  const resolved = o.archifyBin ? { bin: o.archifyBin, source: 'override' } : resolveArchify();
  const archifyBin = resolved.bin;
  const archifyOk = Boolean(archifyBin) && fs.existsSync(archifyBin);
  // 0.14.0：版本机检（关闭 2026-08-17 评估记录的「纸面钉版无机器验证」缺口）。
  // 提示级不改 ok/exit——低于基线/版本未知是环境漂移信号，不是环境损坏。
  let versionNote = '';
  if (archifyOk) {
    const version = probeArchifyVersion(archifyBin);
    if (version) {
      versionNote = '；version=' + version;
      if (isBelowBaseline(version)) {
        versionNote += '；warning：低于耦合基线 v' + ARCHIFY_BASELINE + '，三闸行为不保证，建议升级';
      }
    } else {
      versionNote = '；version=未知；warning：无法探测版本（bin 旁无 package.json），是否满足耦合基线 v' + ARCHIFY_BASELINE + ' 不可机检';
    }
  }
  checks.push({ name: 'archify-kernel', ok: archifyOk, detail: archifyOk ? 'source=' + resolved.source + ' → ' + archifyBin + versionNote : '未找到（source=' + resolved.source + '；gate 命令将 fail-closed；设 ARCHIFY_BIN 或安装 archify 技能）' });

  let sidecar = 'absent';
  let sidecarData = null;
  if (o.sidecar) {
    if (fs.existsSync(o.sidecar)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(o.sidecar, 'utf8'));
        sidecar = 'ok';
        sidecarData = parsed;
      } catch {
        sidecar = 'invalid_json';
      }
    }
  }
  const lessonsCount = sidecar === 'ok' && Array.isArray(sidecarData.lessons) ? sidecarData.lessons.length : 0;
  checks.push({ name: 'sidecar', ok: sidecar !== 'invalid_json', detail: o.sidecar ? o.sidecar + ' → ' + sidecar : '未指定（默认 ./atlas-state.json）' });
  // 经验池注入纪律（P3 收尾）：开工前必读——机器可查的教训数。
  checks.push({ name: 'experience-pool', ok: sidecar === 'ok', detail: sidecar === 'ok' ? '经验池 ' + lessonsCount + ' 条（开工必先 lessons list）' : 'sidecar 不可读，经验池未检' });

  // 批二：A1 证据可解析性解锁进 doctor——a/b/c 规则不依赖 spec 却曾锁在 report --spec 之后；
  // 遍历全部节点证据锚跑 lint（文件存在+行界），失效锚由此在日常操作面可闻。
  // 锁口②（2026-08-16）：可解析性升级为三态——broken（文件缺/行越界，语义不变）/ drifted（行都在但内容哈希不匹配）/
  // ok（哈希匹配）；无哈希锚 = unhashed（存量，不算 drifted，容忍不误报）。
  // warning 级：broken/drifted 属数据债，不使 doctor exit 1（数据债不阻断环境自检）。
  let evidenceResolvability = null;
  if (sidecar === 'ok') {
    const anchors = [];
    const brokenNodes = [];
    const driftedNodes = [];
    // 0.8.0（holdout 遗留缺陷2）：三态旁增两类锚质量 warning 计数与同形节点样例——
    // 目标行 trim 后为空（anchor-empty-line）/ 文件疑似二进制（anchor-binary），皆 warning 级绝不升 error。
    const emptyLineNodes = [];
    const binaryNodes = [];
    // 0.10.2（一线席位 一线误读驱动）：上四个节点样例列表此前静默截断在 5 条且无任何汇总，
    // 与 layout 侧 P6「前 5 逐条 + 另有 N 个」体例不一致——一线据此误以为看到了全量漂移节点
    // （2026-08-17 前后对比实例）。现各自另计全量去重节点数，超限时在消息里补 P6 同式汇总。
    // 不加结构字段：实害是读消息时误判，无已知结构化消费方（能力准入五问②：现有手段已足）。
    const NODE_SAMPLE = 5;
    const brokenNodeSet = new Set();
    const driftedNodeSet = new Set();
    const emptyLineNodeSet = new Set();
    const binaryNodeSet = new Set();
    let broken = 0;
    let drifted = 0;
    let unhashed = 0;
    let okCount = 0;
    let emptyLine = 0;
    let binary = 0;
    for (const [id, node] of Object.entries(sidecarData.nodes || {})) {
      if (!node || !Array.isArray(node.evidence)) continue;
      const meta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
      for (const locator of node.evidence) {
        anchors.push(locator);
        const state = anchorState(locator, meta[locator], process.cwd());
        if (state === 'broken') {
          broken += 1;
          // brokenNodes：失效锚所在节点 id 前 5 个（去重，按遍历序）；Set 另记全量供汇总。
          brokenNodeSet.add(id);
          if (brokenNodes.length < NODE_SAMPLE && !brokenNodes.includes(id)) brokenNodes.push(id);
        } else if (state === 'drifted') {
          drifted += 1;
          // driftedNodes：漂移锚所在节点 id 前 5 个（去重，按遍历序，与 brokenNodes 同式）。
          driftedNodeSet.add(id);
          if (driftedNodes.length < NODE_SAMPLE && !driftedNodes.includes(id)) driftedNodes.push(id);
        } else if (state === 'unhashed') {
          unhashed += 1;
        } else {
          okCount += 1;
        }
        // 锚质量（读方 warning，与三态正交：drifted 锚照样可叠质量提示；broken 侧 anchorQuality 返回 [] 不重复发声）。
        for (const w of anchorQuality(locator, process.cwd())) {
          if (w.rule === 'anchor-empty-line') {
            emptyLine += 1;
            emptyLineNodeSet.add(id);
            if (emptyLineNodes.length < NODE_SAMPLE && !emptyLineNodes.includes(id)) emptyLineNodes.push(id);
          } else if (w.rule === 'anchor-binary') {
            binary += 1;
            binaryNodeSet.add(id);
            if (binaryNodes.length < NODE_SAMPLE && !binaryNodes.includes(id)) binaryNodes.push(id);
          }
        }
      }
    }
    evidenceResolvability = { total: anchors.length, ok: okCount, broken, drifted, unhashed, brokenNodes, driftedNodes, emptyLine, binary, emptyLineNodes, binaryNodes };
    // 与 layout.mjs P6 同式：列前 NODE_SAMPLE 个，超出部分以「另有 N 个…共 M 个」汇总，不再静默截断。
    const nodeSample = (list, set) =>
      list.join(',') +
      (set.size > list.length
        ? '；另有 ' + (set.size - list.length) + ' 个节点同类，共 ' + set.size + ' 个；前 ' + list.length + ' 个已逐条列出'
        : '');
    const parts = [];
    if (broken === 0 && drifted === 0 && emptyLine === 0 && binary === 0) {
      // 0.11.2（空态措辞纪律，防模式 #9）：**零锚不得声称「全部可解析」**——无对象可验不等于验过。
      // 旧文案在空账本上会读成「全部节点证据锚 0 条全部可解析」= vacuous green（与第三方工具在无法解析的仓上回报
      // 「复杂度 10.0 满分」同病）。无发现与无对象必须用不同措辞，且不得出现裁决词。
      parts.push(anchors.length === 0
        ? '本账本尚无证据锚（未作可解析性断言；无锚可检 ≠ 已验证）'
        : '全部节点证据锚 ' + anchors.length + ' 条全部可解析（文件存在 + 行号在界' + (unhashed > 0 ? '；unhashed ' + unhashed + ' 条为存量无哈希锚，不计漂移' : '') + '）');
    } else {
      if (broken > 0) {
        parts.push('证据锚 ' + anchors.length + ' 条中 ' + broken + ' 条失效（brokenNodes=' + nodeSample(brokenNodes, brokenNodeSet) + '）；站位无关性提示：锚应为绝对路径，详见 report --spec 的 A1 对账');
      }
      if (drifted > 0) {
        parts.push('drifted ' + drifted + '=锚内容已漂移，须复核后重新 evidence-add（driftedNodes=' + nodeSample(driftedNodes, driftedNodeSet) + '）');
      }
      if (emptyLine > 0) {
        parts.push('emptyLine ' + emptyLine + '=锚目标行 trim 后为空（anchor-empty-line，warning 不阻断；emptyLineNodes=' + nodeSample(emptyLineNodes, emptyLineNodeSet) + '）；建议改锚到实际内容行');
      }
      if (binary > 0) {
        parts.push('binary ' + binary + '=锚目标疑似二进制（anchor-binary，warning 不阻断；binaryNodes=' + nodeSample(binaryNodes, binaryNodeSet) + '）；建议改锚到可读证据行');
      }
    }
    checks.push({
      name: 'evidence-resolvability',
      ok: broken === 0 && drifted === 0 && emptyLine === 0 && binary === 0,
      warning: true,
      detail: parts.join('；'),
    });
  } else {
    checks.push({ name: 'evidence-resolvability', ok: false, warning: true, detail: 'sidecar 不可读，证据锚未检' });
  }

  // 批二：账本规模阈值——只提示，不自动动账（冷归档属人工决定）。
  let sidecarBytes = 0;
  let traceCount = 0;
  if (sidecar === 'ok') {
    try { sidecarBytes = fs.statSync(o.sidecar).size; } catch { /* 读侧车时的 stat 竞态：按 0 处理 */ }
    traceCount = Array.isArray(sidecarData.trace) ? sidecarData.trace.length : 0;
  }
  const ledgerOversize = sidecar === 'ok' && (sidecarBytes > LEDGER_SIZE_BYTES || traceCount > LEDGER_SIZE_TRACES);
  checks.push({
    name: 'ledger-size',
    ok: sidecar === 'ok' ? !ledgerOversize : false,
    warning: true,
    detail: sidecar === 'ok'
      ? (ledgerOversize
          ? '侧车 ' + sidecarBytes + ' 字节 / trace ' + traceCount + ' 条（阈值 ' + LEDGER_SIZE_BYTES + ' 字节 / ' + LEDGER_SIZE_TRACES + ' 条）；考虑冷归档到 history/ 区（仅提示，不自动动账）'
          : '侧车 ' + sidecarBytes + ' 字节 / trace ' + traceCount + ' 条（阈值 ' + LEDGER_SIZE_BYTES + ' 字节 / ' + LEDGER_SIZE_TRACES + ' 条）')
      : 'sidecar 不可读，账本规模未检',
  });

  let layout = null;
  if (o.atlas) {
    // P6（v2 节点前缀纪律）需侧车：--atlas 与 --sidecar 联动，显式给了才验。
    layout = validateLayout(o.atlas, { sidecarPath: o.sidecar || undefined });
    const errors = layout.diagnostics.filter((d) => d.severity === 'error');
    const warnings = layout.diagnostics.length - errors.length;
    checks.push({ name: 'atlas-layout', ok: errors.length === 0, detail: layout.root + ' → ' + errors.length + ' error / ' + warnings + ' warning（详见 data.layout.diagnostics）' });
  }

  // 批二：--stats 派生度量（CLI 已要求显式 --sidecar；sidecar 不可读时 stats=null，随 checks 呈现）。
  const stats = o.stats && sidecar === 'ok' ? computeStats(sidecarData, o.sidecar) : null;

  // warning 级检查 ok:false 不使整体 failed（数据债不阻断环境自检）。
  const result = { ok: checks.every((c) => c.ok || c.warning), checks };
  if (evidenceResolvability) result.evidenceResolvability = evidenceResolvability;
  if (stats) result.stats = stats;
  if (layout) {
    result.layout = { root: layout.root, diagnostics: layout.diagnostics };
    // 诚实披露：机器不可判定的规则逐条具名，不静默跳过。
    result.unchecked = layout.unchecked;
  }
  return result;
}

// 账本侧派生度量（契约 §10）：全部单源可算——nodes/evidence/truthAdvances/history 出自 nodes，
// traceKinds 出自 trace，lessons/notices 出自各自根段，sidecarBytes/revision 出自侧车文件。
// ownedNodes = owner 非空的节点数（账本侧可算）。命名纪律：「座位/seat」一词保留给图账交叉语义
// （A1 对账/审计文书 C4），本字段测的是 owner 指派——2026-08-15 一线席位 A/B 报告抓获同名异义冲突后改名（原名 seatedNodes 未及发布）。
function computeStats(sidecarData, sidecarPath) {
  const nodes = sidecarData.nodes || {};
  const evidence = { total: 0, absolute: 0, relative: 0, hashed: 0 };
  let ownedNodes = 0;
  let truthAdvances = 0;
  const attribution = { historyTotal: 0, withBy: 0, withEngine: 0 };
  for (const node of Object.values(nodes)) {
    if (!node) continue;
    if (node.owner && String(node.owner).trim()) ownedNodes += 1;
    const meta = node.evidenceMeta && typeof node.evidenceMeta === 'object' ? node.evidenceMeta : {};
    for (const locator of node.evidence || []) {
      evidence.total += 1;
      const parsed = parseLocator(locator);
      if (parsed.ok && path.isAbsolute(parsed.file)) evidence.absolute += 1;
      else evidence.relative += 1;
      // 锁口②：hashed=携带行哈希的锚数（存量锚无 evidenceMeta 条目不计；哈希是否匹配属 resolvability 三态，不在此重复）。
      const m = meta[locator];
      if (m && typeof m === 'object' && typeof m.h === 'string' && m.h) evidence.hashed += 1;
    }
    for (const ev of node.history || []) {
      attribution.historyTotal += 1;
      if (ev.by !== undefined && ev.by !== null) attribution.withBy += 1;
      if (ev.engine !== undefined && ev.engine !== null) attribution.withEngine += 1;
      if (ev.axis === 'truth' && isTruthAdvance(ev.from, ev.to)) truthAdvances += 1;
    }
  }
  const traceKinds = {};
  for (const kind of TRACE_KINDS) traceKinds[kind] = 0;
  for (const t of sidecarData.trace || []) {
    if (TRACE_KINDS.includes(t.kind)) traceKinds[t.kind] += 1;
  }
  const lessons = { total: 0, active: 0, retired: 0, hits: 0 };
  for (const l of sidecarData.lessons || []) {
    lessons.total += 1;
    if ((l.status || 'active') === 'retired') lessons.retired += 1;
    else lessons.active += 1;
    lessons.hits += l.hits || 0;
  }
  let sidecarBytes = 0;
  try { sidecarBytes = fs.statSync(sidecarPath).size; } catch { /* stat 竞态：按 0 处理 */ }
  return {
    nodes: Object.keys(nodes).length,
    ownedNodes,
    evidence,
    truthAdvances,
    traceKinds,
    lessons,
    notices: { total: Array.isArray(sidecarData.notices) ? sidecarData.notices.length : 0 },
    attribution,
    sidecarBytes,
    revision: sidecarData.revision === undefined ? 0 : sidecarData.revision,
  };
}
