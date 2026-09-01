// L1/L2 越界门禁（0.13.0，负责人令 2026-08-27：atlas-engine 出域多项目使用前防跨项目误写）。
// 直接动机：并行席位 2026-08-27 实际案例——同机会话把 demo-b 工单当主线执行，P6 仅有 doctor warning，
// 写路径零拦截。本模块把「账本隔离靠纪律」升级为「注册表 opt-in 的机器硬门」。
//
// 激活条件（opt-in，零破坏）：侧车同目录存在 projects.json，且其中某条目的 sidecar 字段 === 本侧车
// 文件名。init 产物与任意自由侧车不写 sidecar 字段 → 门不激活（demo-a 等历史行为不变）。
//
// L1 前缀门（project_prefix_gate）：state set 新建节点 id 必须 === 项目名 或以 项目名- 开头
//   （项目集合 = 映射到本侧车的全部注册表条目；共享侧车取并集，如 atlas-state.json = demo-a|add）。
//   只拦新建：存量节点 grandfather（P6 doctor warning 继续负责存量提示，写路径不拦——否则历史
//   diagram-*/meta 节点全部写死）。
// L2 席位门（seat_gate）：state set/transition/settle/block 的 --owner 必须 ∈ 映射条目 seats 并集；
//   条目无 seats 字段 = 该条目不设限（出域部署逐步启用，不锁死旧用法）。
//
// 信任模型：防误不防恶（恶意本地用户本就有一切文件权限，加密/RBAC 属安全剧场）；
// 注册表单一真相源；诊断 fail-loud exit 1。零依赖，纯读注册表（engine 对注册表只读）。
import fs from 'node:fs';
import path from 'node:path';

// 解析侧车的项目门禁上下文；未激活返回 null（调用方跳过校验，绝不噪音）。
export function loadProjectGate(sidecarPath) {
  const dir = path.dirname(path.resolve(sidecarPath));
  const regPath = path.join(dir, 'projects.json');
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  } catch {
    return null; // 无注册表/不可解析 → 门不激活（layout.registry 的 warning 归 doctor --atlas 属地）
  }
  const base = path.basename(sidecarPath);
  const entries = Array.isArray(reg.projects)
    ? reg.projects.filter((e) => e && typeof e === 'object' && e.sidecar === base)
    : [];
  if (entries.length === 0) return null;
  const prefixes = entries.map((e) => e.project).filter((p) => typeof p === 'string' && p);
  if (prefixes.length === 0) return null;
  const seats = new Set();
  let seatLimited = false;
  for (const e of entries) {
    if (Array.isArray(e.seats)) {
      seatLimited = true;
      for (const s of e.seats) if (typeof s === 'string' && s) seats.add(s);
    }
  }
  return { prefixes, seats: seatLimited ? seats : null, registryPath: regPath };
}

// L1：节点 id 是否落在允许前缀集合内（=== 项目名 或 项目名- 开头）。
export function prefixAllowed(nodeId, prefixes) {
  return prefixes.some((p) => nodeId === p || nodeId.startsWith(p + '-'));
}

// L2：席位是否被授权（seats=null 表示注册表未启用席位限制，全放行）。
export function seatAllowed(owner, seats) {
  return seats === null || seats.has(owner);
}
