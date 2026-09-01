// atlas-state.json sidecar load/save (zero-dep).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENGINE_VERSION } from './version.mjs';

export function loadSidecar(sidecarPath) {
  if (!fs.existsSync(sidecarPath)) {
    const err = new Error('sidecar 不存在：' + sidecarPath);
    err.code = 'sidecar_missing';
    throw err;
  }
  let raw;
  try {
    raw = fs.readFileSync(sidecarPath, 'utf8');
  } catch (cause) {
    const err = new Error('sidecar 读取失败：' + cause.message);
    err.code = 'sidecar_unreadable';
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('sidecar 不是合法 JSON：' + sidecarPath);
    err.code = 'sidecar_invalid_json';
    throw err;
  }
  if (parsed.schemaVersion !== 1) {
    const err = new Error('sidecar schemaVersion 必须为 1');
    err.code = 'sidecar_bad_schema';
    throw err;
  }
  if (typeof parsed.nodes !== 'object' || parsed.nodes === null) {
    const err = new Error('sidecar 缺少 nodes 对象');
    err.code = 'sidecar_bad_shape';
    throw err;
  }
  // 旧侧车兼容：无 revision 字段按 0 处理（schemaVersion 仍为 1）。
  if (parsed.revision === undefined) {
    parsed.revision = 0;
  } else {
    parsed.revision = normalizeRevision(parsed.revision);
  }
  // 旧侧车兼容（2026-08-15 清单 B3）：无 notices 字段按空数组处理（schemaVersion 仍为 1）；
  // 存在则必须为数组，否则形状坏 fail-loud（与 nodes 校验同码）。
  if (parsed.notices === undefined) {
    parsed.notices = [];
  } else if (!Array.isArray(parsed.notices)) {
    const err = new Error('sidecar notices 必须为数组');
    err.code = 'sidecar_bad_shape';
    throw err;
  }
  return parsed;
}

function normalizeRevision(v) {
  if (v === undefined) return 0;
  if (!Number.isInteger(v) || v < 0) {
    const err = new Error('sidecar revision 必须为非负整数，实际：' + JSON.stringify(v));
    err.code = 'sidecar_bad_revision';
    throw err;
  }
  return v;
}

// 多席位安全：O_EXCL 锁文件（内容 JSON {pid, at, token}，pid 死亡或锁龄超限视为陈旧可接管）
// + 持锁重读磁盘做 CAS 版本号校验；写原子（tmp+rename）。单写者由文件本身强制。
// 接管闭环（TOCTOU 加固）：判陈旧→unlink→O_EXCL 重新抢→抢到后回读自己的锁文件核对随机 token，
// 一致才算真持有；不一致（unlink→重抢窗口内他席位已另立新锁）按争用继续等，绝不双持锁写入。
// 残余风险：pid 复用（pid 死亡后 OS 把同号 pid 分给无关进程）可令死锁看似存活；30s 锁龄兜底为接受的有界风险。
const STALE_LOCK_MS = 30000;

function syncSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 随机锁 token：每吹 saveSidecar 独立生成，用于抢锁后回读核对「路径上仍是我方锁」。
function randomLockToken() {
  return crypto.randomBytes(16).toString('hex');
}

// 读路径上锁文件的 token（缺失/损坏返回 null，视作不匹配）。
function readLockToken(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return parsed && typeof parsed.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

function readLockInfo(lockPath) {
  let pid = null;
  let at = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (Number.isInteger(parsed.pid) && parsed.pid > 0) pid = parsed.pid;
      if (typeof parsed.at === 'number' && parsed.at > 0) at = parsed.at;
    }
  } catch { /* 锁内容缺失或损坏：退回 mtime 判锁龄 */ }
  if (at === null) {
    try { at = fs.statSync(lockPath).mtimeMs; } catch { return { pid: null, at: null }; }
  }
  return { pid, at };
}

function isStaleLock(lockPath) {
  const info = readLockInfo(lockPath);
  if (info.pid !== null) {
    try {
      process.kill(info.pid, 0); // 信号 0 仅探测存在性
    } catch (e) {
      if (e.code === 'ESRCH') return true; // 持有者进程已死 → 陈旧
      return false; // EPERM 等：进程存在但无权限 → 视为持有中
    }
  }
  return info.at !== null && Date.now() - info.at > STALE_LOCK_MS;
}

function readDiskRevision(sidecarPath) {
  let raw;
  try {
    raw = fs.readFileSync(sidecarPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return 0; // 全新文件视为 revision 0
    const err = new Error('sidecar 冲突检测重读失败：' + e.message);
    err.code = 'sidecar_unreadable';
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('sidecar 冲突检测重读：磁盘文件不是合法 JSON：' + sidecarPath);
    err.code = 'sidecar_invalid_json';
    throw err;
  }
  return normalizeRevision(parsed.revision);
}

export function saveSidecar(sidecarPath, sidecar, options = {}) {
  const lockTimeoutMs = typeof options.lockTimeoutMs === 'number' ? options.lockTimeoutMs : (Number(process.env.ATLAS_LOCK_TIMEOUT_MS) || 5000);
  const dir = path.dirname(sidecarPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = sidecarPath + '.lock';
  const deadline = Date.now() + lockTimeoutMs;
  const token = randomLockToken();
  for (;;) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (isStaleLock(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch { /* 竞争：他人已先接管，落入下一轮 */ }
        continue; // 立即重试接管
      }
      if (Date.now() > deadline) {
        const err = new Error('sidecar 写锁超时（另一席位持有 ' + lockPath + ' 超过 ' + lockTimeoutMs + ' 毫秒）');
        err.code = 'sidecar_locked';
        throw err;
      }
      syncSleep(50); // Atomics.wait 同步睡眠，不烧 CPU
      continue;
    }
    // 抢到创建权 ≠ 持有：判陈旧→unlink→重抢窗口内，他席位可能已 unlink 我方初锁并另立新锁。
    // 写入含随机 token 的锁内容后按路径回读核对：一致才算真持有；不一致 = 已被夺走，按争用继续等。
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), token }) + '\n', 'utf8');
    } finally {
      try { fs.closeSync(fd); } catch { /* 忽略 */ }
    }
    if (readLockToken(lockPath) === token) break; // 真持有，进入写阶段
    if (Date.now() > deadline) {
      const err = new Error('sidecar 写锁超时（接管后被夺走，重试超过 ' + lockTimeoutMs + ' 毫秒）');
      err.code = 'sidecar_locked';
      throw err;
    }
    syncSleep(50);
  }
  try {
    // 只读守卫（0.7.0，demo-b holdout 对抗实验缺陷1）：tmp+rename 原子写只需目录写权限——chmod 只读的
    // 保护意图会被静默穿过，且 rename 后新文件继承 umask 权限（444→664 静默重置，连痕迹都不留）。
    // 写前判定目标存在且不可写即 fail-loud：权限位无写位（root 等特权同样受判——保护意图先于 euid 豁免）
    // 或 accessSync W_OK 被拒（ACL/只读挂载等）。拒绝时文件内容与权限均未动。
    let priorMode = null;
    if (fs.existsSync(sidecarPath)) {
      const priorStat = fs.statSync(sidecarPath);
      let writable = (priorStat.mode & 0o222) !== 0;
      if (writable) {
        try {
          fs.accessSync(sidecarPath, fs.constants.W_OK);
        } catch {
          writable = false;
        }
      }
      if (!writable) {
        const err = new Error('侧车为只读=保护意图，拒绝写入；如确需写入请 chmod +w：' + sidecarPath);
        err.code = 'sidecar_readonly';
        throw err;
      }
      priorMode = priorStat.mode & 0o777; // rename 后回设原权限（见下），消灭静默重置
    }
    // 持锁重读磁盘，CAS 版本号：磁盘 revision 与待写数据不一致 = 他人已写入，拒绝覆盖。
    const diskRevision = readDiskRevision(sidecarPath);
    const dataRevision = normalizeRevision(sidecar.revision);
    if (diskRevision !== dataRevision) {
      const err = new Error(
        'sidecar 写冲突：磁盘 revision=' + diskRevision + '，待写 revision=' + dataRevision +
        '；补救：重新 loadSidecar 后在最新数据上重放变更再保存'
      );
      err.code = 'sidecar_conflict';
      throw err;
    }
    sidecar.revision = diskRevision + 1;
    const tmp = sidecarPath + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, sidecarPath);
    // tmp 文件权限继承 umask——目标已存在时回设其原权限（0.7.0；新文件首次写入仍按 umask）。
    if (priorMode !== null) {
      fs.chmodSync(sidecarPath, priorMode);
    }
  } finally {
    // 释放为尽力而为：极慢写入下（>30s）锁可能已按锁龄被他席位接管，此处 unlink 的是当前路径上的锁——
    // 该窗口属接受的有界风险（见头部注释）；正常路径 token 核对已确保写阶段持有者唯一。
    try { fs.unlinkSync(lockPath); } catch { /* 忽略 */ }
  }
}

export function findNode(sidecar, nodeId) {
  return sidecar.nodes[nodeId] || null;
}

export function ensureNode(sidecar, nodeId, owner) {
  if (!sidecar.nodes[nodeId]) {
    sidecar.nodes[nodeId] = {
      owner,
      truth: 'candidate',
      progress: 'planned',
      ledger: 'clean',
      evidence: [],
      history: [],
    };
  }
  return sidecar.nodes[nodeId];
}

// 增长控制开发规范批一#1（2026-08-15）：state 写路径全部 history 事件的单一构造点——
// set/evidence-add/transition/settle/block 五条写入都经此入账，engine 戳只在此打（勿散打多处）。
// engine=引擎版本号（可选增量字段，schemaVersion 不动）：回答「这条账是哪个引擎语义写的」；旧事件无此字段照常解析。
export function appendHistory(node, entry) {
  node.history = node.history || [];
  node.history.push({ ...entry, engine: ENGINE_VERSION });
  return node;
}

