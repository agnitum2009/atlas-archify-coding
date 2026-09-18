// atlas-state.json sidecar load/save (zero-dep).
// 不变量（改本文件前先读）：
//   I1 读方只校验引擎消费的已知字段；未知字段与缺省增量字段一律原样保留（snapshot-policy §5.3）。
//   I2 任何代码路径都不得删除「非本方」的锁文件；自动回收整条路径不存在（无回收者 ⇒ 无 TOCTOU 面）。
//   I3 提交前失败 ⇒ 磁盘与调用对象都未推进（revision 回滚、tmp 清理）；提交后失败 ⇒ 报已提交/耐久未知，不伪装零写入。
//   I4 权限在发布前定稿（tmp 阶段 fchmod），发布后不再 chmod。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENGINE_VERSION } from './version.mjs';

const NODE_STRING_FIELDS = ['owner', 'truth', 'progress', 'ledger', 'class', 'kind'];
const NODE_STRING_ARRAY_FIELDS = ['evidence', 'specRefs', 'traceRefs'];
const NODE_RECORD_ARRAY_FIELDS = ['history', 'truthReceipts'];
const ROOT_RECORD_ARRAY_FIELDS = ['notices', 'trace', 'lessons'];
const RECORD_STRING_FIELDS = {
  history: ['at', 'kind', 'reason', 'by', 'axis', 'receipt'],
  trace: ['at', 'id', 'kind', 'actor', 'note', 'node'],
  lessons: ['at', 'id', 'rule', 'lesson', 'source', 'status'],
};

function isPlainRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function shapeError(message) {
  const err = new Error(message);
  err.code = 'sidecar_bad_shape';
  return err;
}

function validateRecordStrings(record, fields, subject) {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw shapeError(subject + '.' + field + ' 必须是字符串（实际：' + typeName(value) + '）');
    }
  }
}

// 形状校验（load 读前、save 写前共用）：坏形状（nodes 为数组/节点非记录/字段类型错）fail-loud，
// 不落盘也不读成幽灵账（旧实现接受 nodes:[] 并让 JSON 字符串键静默丢失）。
export function validateSidecarShape(sidecar, { source = 'sidecar' } = {}) {
  if (!isPlainRecord(sidecar)) {
    throw shapeError(source + ' 顶层必须是 JSON 对象（实际：' + typeName(sidecar) + '）');
  }
  if (sidecar.schemaVersion !== 1) {
    const err = new Error('sidecar schemaVersion 必须为 1');
    err.code = 'sidecar_bad_schema';
    throw err;
  }
  if (!isPlainRecord(sidecar.nodes)) {
    throw shapeError('sidecar 缺少 nodes 对象（必须是 JSON 对象，不能是数组或 null；实际：' + typeName(sidecar.nodes) + '）');
  }
  for (const [id, node] of Object.entries(sidecar.nodes)) {
    if (!isPlainRecord(node)) {
      throw shapeError('sidecar 节点 ' + JSON.stringify(id) + ' 必须是 JSON 对象（实际：' + typeName(node) + '）');
    }
    for (const field of NODE_STRING_FIELDS) {
      const v = node[field];
      if (v !== undefined && v !== null && typeof v !== 'string') { // 缺失/null 合法：旧增量字段与历史写入
        throw shapeError('sidecar 节点 ' + id + '.' + field + ' 必须是字符串（实际：' + typeName(v) + '）');
      }
    }
    for (const field of NODE_STRING_ARRAY_FIELDS) {
      const v = node[field];
      if (v === undefined || (field === 'traceRefs' && v === null)) continue;
      if (!Array.isArray(v)) {
        throw shapeError('sidecar 节点 ' + id + '.' + field + ' 必须是数组（实际：' + typeName(v) + '）');
      }
      for (const item of v) {
        if (typeof item !== 'string') {
          throw shapeError('sidecar 节点 ' + id + '.' + field + ' 的元素必须是字符串（实际：' + typeName(item) + '）');
        }
      }
    }
    for (const field of NODE_RECORD_ARRAY_FIELDS) {
      const v = node[field];
      if (v === undefined) continue;
      if (!Array.isArray(v)) {
        throw shapeError('sidecar 节点 ' + id + '.' + field + ' 必须是数组（实际：' + typeName(v) + '）');
      }
      for (const item of v) {
        if (!isPlainRecord(item)) {
          throw shapeError('sidecar 节点 ' + id + '.' + field + ' 的元素必须是 JSON 对象（实际：' + typeName(item) + '）');
        }
        if (field === 'history') validateRecordStrings(item, RECORD_STRING_FIELDS.history, 'sidecar 节点 ' + id + '.history');
      }
    }
    if (node.evidenceMeta !== undefined) {
      if (!isPlainRecord(node.evidenceMeta)) {
        throw shapeError('sidecar 节点 ' + id + '.evidenceMeta 必须是 JSON 对象（实际：' + typeName(node.evidenceMeta) + '）');
      }
      for (const [locator, meta] of Object.entries(node.evidenceMeta)) {
        if (!isPlainRecord(meta)) {
          throw shapeError('sidecar 节点 ' + id + '.evidenceMeta[' + JSON.stringify(locator) + '] 必须是 JSON 对象（实际：' + typeName(meta) + '）');
        }
        for (const field of ['h', 'at']) {
          const v = meta[field];
          if (v !== undefined && v !== null && typeof v !== 'string') {
            throw shapeError('sidecar 节点 ' + id + '.evidenceMeta[' + locator + '].' + field + ' 必须是字符串（实际：' + typeName(v) + '）');
          }
        }
      }
    }
  }
  for (const field of ROOT_RECORD_ARRAY_FIELDS) {
    const v = sidecar[field];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      throw shapeError('sidecar ' + field + ' 必须是数组（实际：' + typeName(v) + '）');
    }
    for (const item of v) {
      if (!isPlainRecord(item)) {
        throw shapeError('sidecar ' + field + ' 的元素必须是 JSON 对象（实际：' + typeName(item) + '）');
      }
      if (RECORD_STRING_FIELDS[field]) validateRecordStrings(item, RECORD_STRING_FIELDS[field], 'sidecar ' + field);
      if (field === 'notices' && item.readBy !== undefined && item.readBy !== null &&
          (!Array.isArray(item.readBy) || item.readBy.some(seat => typeof seat !== 'string'))) {
        throw shapeError('sidecar notices.readBy 必须是字符串数组');
      }
      if (field === 'lessons' && item.hits !== undefined && item.hits !== null &&
          (!Number.isSafeInteger(item.hits) || item.hits < 0)) {
        throw shapeError('sidecar lessons.hits 必须是非负安全整数');
      }
    }
  }
  if (sidecar.revision !== undefined) normalizeRevision(sidecar.revision);
  return sidecar;
}

export function loadSidecar(sidecarPath) {
  sidecarPath = canonicalSidecarPath(sidecarPath);
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
  validateSidecarShape(parsed, { source: sidecarPath });
  if (parsed.revision === undefined) {
    parsed.revision = 0; // 旧侧车兼容：无 revision 字段按 0（schemaVersion 仍为 1）
  } else {
    parsed.revision = normalizeRevision(parsed.revision);
  }
  if (parsed.notices === undefined) {
    parsed.notices = []; // 旧侧车兼容（清单 B3）：缺省空数组；存在则由 validateSidecarShape 校验数组形状
  }
  return parsed;
}

function normalizeRevision(v) {
  if (v === undefined) return 0;
  if (!Number.isSafeInteger(v) || v < 0) {
    const err = new Error('sidecar revision 必须为非负安全整数（≤2^53-1），实际：' + JSON.stringify(v));
    err.code = 'sidecar_bad_revision';
    throw err;
  }
  return v;
}

// 路径规范化（唯一入口，load/save/门禁上下文共用）：现存目标取 realpath（symlink 侧车 → 写真实文件，
// 链接本身保留、不再被 rename 覆盖成普通文件；锁也只有一份 <真实路径>.lock，不产生「两个锁各写一个路径」）。
// 目标不存在时：向上找最近存在的祖先取 realpath，再接回剩余段（新建侧车落在真实目录里）。
// 失败纪律：**只有 ENOENT（路径项确实不存在）**才允许按祖先回落；断链 symlink（lstat 存在但 realpath 失败）、
// EACCES/ELOOP/EIO 一律 fail-loud——不把无法解析的路径伪装成「新账本」，也不静默换一个文件写。
export function canonicalSidecarPath(sidecarPath) {
  const abs = path.resolve(sidecarPath);
  let entryExists = false;
  try {
    fs.lstatSync(abs);
    entryExists = true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw unresolvablePathError(abs, e);
  }
  if (entryExists) {
    try {
      return fs.realpathSync(abs);
    } catch (e) {
      throw unresolvablePathError(abs, e);
    }
  }
  const tail = [];
  let cur = abs;
  for (let i = 0; i < 64; i += 1) {
    tail.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
    let ancestorExists = false;
    try {
      fs.lstatSync(cur);
      ancestorExists = true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw unresolvablePathError(cur, e);
    }
    if (!ancestorExists) continue;
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch (e) {
      throw unresolvablePathError(cur, e);
    }
  }
  return abs;
}

function unresolvablePathError(target, cause) {
  const err = new Error(
    '侧车路径不可解析：' + target + '（' + cause.code + ': ' + cause.message + '）——' +
    '断链符号链接/权限等一律 fail-loud，不按「新账本」回落（否则会把坏路径伪装成空账并写歪目录）'
  );
  err.code = 'sidecar_path_unresolvable';
  err.cause = cause;
  err.path = target;
  return err;
}

// ---------- 写锁：保守 fail-closed，无自动回收（I2） ----------
// 旧实现「判陈旧 → unlink → 重抢 → 回读 token」存在不可消除的窗口：两个回收者基于同一个已死持有者
// 各自判陈旧，R2 会 unlink 掉 R1 刚立起的**活**锁并另立新锁，两边同时进入临界区；一次 token 回读
// 发生在写之前，挡不住它。零依赖跨平台没有「比较并删除他人锁」的原子原语，故本模块不回收任何锁：
//   · 锁内容 {schemaVersion, pid, at, token} 只用于诊断与释放自校验，不作接管判据；
//   · 锁龄（ageMs）只进诊断文案；活 PID 绝不按龄接管；
//   · 恢复 = 确认全体写者已停（kill -0）→ 人工删除 <sidecar>.lock → 重跑。无自动接管后门。
// 信任模型：防误不防恶——可信本地进程遵守本协议时不存在删除他人锁的路径；外部恶意的替换不在此承诺内。
const LOCK_SCHEMA_VERSION = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
// 提交前失败中原样透传的本模块错误码；其余（文件系统错误等）统一结构化落 sidecar_write_failed。
const PASSTHROUGH_WRITE_CODES = new Set([
  'sidecar_readonly', 'sidecar_conflict', 'sidecar_bad_revision', 'sidecar_bad_shape', 'sidecar_bad_schema',
  'sidecar_invalid_json', 'sidecar_unreadable', 'sidecar_commit_unknown', 'sidecar_lock_failed', 'sidecar_hardlinked',
]);

function syncSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function randomLockToken() {
  return crypto.randomBytes(16).toString('hex');
}

function readLockToken(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return parsed && typeof parsed.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

// 持有者诊断（只读）：liveness 仅作提示——alive 可能是崩溃残留（pid 复用），absent 是已退出的残留。
function lockHolderInfo(lockPath) {
  let pid = null;
  let at = null;
  let token = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (isPlainRecord(parsed)) {
      if (Number.isInteger(parsed.pid) && parsed.pid > 0) pid = parsed.pid;
      if (typeof parsed.at === 'number' && parsed.at > 0) at = parsed.at;
      if (typeof parsed.token === 'string') token = parsed.token;
    }
  } catch { /* 锁内容缺失或损坏：退回 mtime 判龄（仅诊断） */ }
  if (at === null) {
    try { at = fs.statSync(lockPath).mtimeMs; } catch { /* 已不存在 */ }
  }
  let liveness = 'unknown';
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      liveness = 'alive';
    } catch (e) {
      liveness = e.code === 'ESRCH' ? 'absent' : 'alive';
    }
  }
  return { pid, at, ageMs: at === null ? null : Math.max(0, Date.now() - at), token, liveness };
}

function lockedError(lockPath, lockTimeoutMs, extra) {
  const h = lockHolderInfo(lockPath);
  const lines = [
    'sidecar 写锁被占用（等待 ' + lockTimeoutMs + ' 毫秒后放弃）：' + lockPath,
    '持有者：pid=' + (h.pid === null ? '未知' : h.pid) +
      ' at=' + (h.at === null ? '未知' : new Date(h.at).toISOString()) +
      ' ageMs=' + (h.ageMs === null ? '未知' : h.ageMs) +
      ' token=' + (h.token === null ? '未知' : h.token.slice(0, 8) + '…') +
      ' liveness=' + h.liveness,
  ];
  if (extra) lines.push(extra);
  lines.push('本引擎不做自动接管（自动回收会删除他人新锁；活进程不按锁龄判定）。恢复流程：确认全体写者已停止（kill -0 <pid> 核对，absent=持有进程已退出）→ 人工删除锁文件：rm -- \'' + lockPath.replace(/'/g, "'\\''") + '\' → 重跑原命令');
  const err = new Error(lines.join('\n'));
  err.code = 'sidecar_locked';
  err.holder = h;
  return err;
}

// 只删「身份就是本方」的锁文件：held.ino 缺失（fstat 失败/平台不提供 ino）时一律不删（保守残留）。
function removeLockOwnedBy(lockPath, held) {
  if (!held || !held.ino) return false;
  try {
    const st = fs.statSync(lockPath);
    if (st.ino !== held.ino || st.dev !== held.dev) return false; // 已被替换：不是我们的文件
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

// 获取锁（fail-closed）。成功返回 { ino, dev }——身份在写入之前抓取，写失败时才有资格自清理。
function acquireLock(lockPath, token, lockTimeoutMs) {
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (e) {
      if (e.code !== 'EEXIST') {
        const err = new Error('sidecar 锁文件无法创建：' + lockPath + '（' + e.message + '）');
        err.code = 'sidecar_lock_failed';
        err.cause = e;
        throw err;
      }
      // EEXIST：绝不回收、绝不接管；等到 deadline 即 fail-closed。
      if (Date.now() >= deadline) throw lockedError(lockPath, lockTimeoutMs);
      syncSleep(50);
      continue;
    }
    let held = null;
    try {
      const st = fs.fstatSync(fd);
      held = { ino: st.ino || 0, dev: st.dev || 0 };
    } catch { /* 身份不可得：本次持锁失败后不得自清理 */ }
    try {
      if (!held || !held.ino) throw new Error('锁文件身份不可得（fstat 未返回 inode）');
      fs.writeFileSync(fd, JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, pid: process.pid, at: Date.now(), token }) + '\n', 'utf8');
      fs.fsyncSync(fd);
    } catch (e) {
      try { fs.closeSync(fd); } catch { /* 忽略 */ }
      const removed = removeLockOwnedBy(lockPath, held);
      const err = new Error(
        'sidecar 锁写入失败：' + lockPath + '（' + e.message + '）；' +
        (removed ? '已清理本次创建的锁文件' : '未能确认锁文件归属，保守残留（确认无写者后人工删除）') +
        '；未进入写阶段，侧车内容未动'
      );
      err.code = 'sidecar_lock_failed';
      err.cause = e;
      throw err;
    }
    try { fs.closeSync(fd); } catch { /* 忽略 */ }
    // 完整性核对（非安全承重）：路径上仍是本次 token。不符 = 外部替换，保守放弃且不删任何文件。
    if (readLockToken(lockPath) === token) return held;
    if (Date.now() >= deadline) {
      throw lockedError(lockPath, lockTimeoutMs, '锁在获取后被外部替换（token 不符），无法确认持有');
    }
    syncSleep(50);
  }
}

// 释放：inode 身份 + token 双判据，任一不符即不删（他人的锁不可删）。
function releaseLock(lockPath, token, held) {
  try {
    const st = fs.statSync(lockPath);
    if (!held || !held.ino) return false;
    if (st.ino !== held.ino || st.dev !== held.dev) return false;
    if (readLockToken(lockPath) !== token) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false; // ENOENT（已被外部删除）等：保守不动作
  }
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

// 写 tmp（I4）：权限在发布前定稿——目标已存在则以 0600 建再 fchmod 回原权限（消灭 umask 静默放宽）；
// 新文件以 0666 交内核按 umask 收敛（与旧行为等价）。chmod 失败 = 提交前失败，磁盘与对象都不动。
function writeSidecarTmp(tmpPath, data, priorMode) {
  const fd = fs.openSync(tmpPath, 'wx', priorMode === null ? 0o666 : 0o600);
  try {
    const created = fs.fstatSync(fd).mode & 0o777;
    const target = priorMode === null ? created : priorMode;
    if (created !== target) fs.fchmodSync(fd, target);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd); // 内容先于 rename 落盘
  } finally {
    try { fs.closeSync(fd); } catch { /* 忽略 */ }
  }
}

// 目录 fsync：让 rename 本身持久。边界 = 内容先于发布（file fsync）、发布先于目录项持久化（dir fsync）。
// 失败一律走 sidecar_commit_unknown：ENOTSUP/EISDIR/EINVAL/ENOSYS = 平台/文件系统不支持（unsupported），
// 其余（EACCES/EPERM/EIO/…）= 真失败（unknown）——两者都属「已提交但耐久未知」，不静默放行。
const DIR_SYNC_UNSUPPORTED = new Set(['ENOTSUP', 'ENOSYS', 'EISDIR', 'EINVAL']);

function syncDir(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
    return { durability: 'synced' };
  } catch (e) {
    return { durability: DIR_SYNC_UNSUPPORTED.has(e.code) ? 'unsupported' : 'unknown', cause: e };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
  }
}

function commitUnknownError(sidecarPath, revision, durability, cause) {
  const err = new Error(
    'sidecar 已提交但耐久未知：新内容已写入 ' + sidecarPath + '（revision=' + revision + '），' +
    '但提交后的目录 fsync ' + (durability === 'unsupported' ? '不被本平台/文件系统支持' : '失败') +
    '（' + (cause && cause.code ? cause.code + ': ' : '') + (cause ? cause.message : '') + '）——不伪装零写入；' +
    '内容已可见，重跑或继续前请重新 loadSidecar 读取磁盘值'
  );
  err.code = 'sidecar_commit_unknown';
  err.committed = true;
  err.revision = revision;
  err.durability = durability;
  err.path = sidecarPath;
  err.cause = cause;
  return err;
}

/**
 * 原子写侧车。成功返回 { path, committed: true, revision, durability: 'synced' }。
 * 失败分层（I3）：
 *   · 提交前（锁/只读守卫/CAS/权限/tmp/rename 之前）任何失败 → 原错误码透传（未知码归 sidecar_write_failed）、
 *     revision 回滚（原本无 revision 属性则 delete，不留 undefined 属性）、tmp 清理；
 *   · 提交后（rename 成功、目录 fsync 未成功）→ sidecar_commit_unknown
 *     （err.committed=true / err.revision=已提交版本 / err.durability=unsupported|unknown）。
 * 目录 fsync 与提交后诊断都在持锁段内完成：锁释放后他人可能已写入，届时再声称「磁盘是本方值」即为假。
 */
export function saveSidecar(sidecarPath, sidecar, options = {}) {
  sidecarPath = canonicalSidecarPath(sidecarPath);
  const lockTimeoutMs = resolveLockTimeout(options);
  validateSidecarShape(sidecar, { source: '待写侧车（save 结构守卫）' });
  const dir = path.dirname(sidecarPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = sidecarPath + '.lock';
  const token = randomLockToken();
  const held = acquireLock(lockPath, token, lockTimeoutMs);
  let published = false;
  let hadRevision = false;
  let prevRevision;
  let nextRevision = null;
  let tmpPath = null;
  try {
    // 只读守卫（0.7.0 缺陷1）：tmp+rename 只需目录写权限，chmod 只读的保护意图会被静默穿过。
    // 写前判不可写即 fail-loud（权限位无写位先于 euid 豁免；accessSync W_OK 覆盖 ACL/只读挂载）。
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
      priorMode = priorStat.mode & 0o777;
      // 硬链接（nlink>1）：realpath 无法识别同 inode 的第二个路径 → 两个路径两把锁、写入互相覆盖。
      // 保守拒写（不做静默分叉）：用同一路径调用，或先解除硬链接。
      if (priorStat.nlink > 1) {
        const err = new Error(
          '侧车有多个硬链接（nlink=' + priorStat.nlink + '）：' + sidecarPath +
          '——硬链接路径 realpath 无法归一，两个路径会各持一把锁并互相覆盖；请统一用同一路径调用或先解除硬链接'
        );
        err.code = 'sidecar_hardlinked';
        err.path = sidecarPath;
        throw err;
      }
    }
    // CAS：持锁重读磁盘比对 revision，不一即拒（并发丢更新的最终屏障）。
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
    if (diskRevision >= Number.MAX_SAFE_INTEGER) {
      const err = new Error('sidecar revision 已达安全整数上界（' + Number.MAX_SAFE_INTEGER + '），拒绝继续推进');
      err.code = 'sidecar_bad_revision';
      throw err;
    }
    hadRevision = Object.hasOwn(sidecar, 'revision');
    prevRevision = sidecar.revision;
    nextRevision = diskRevision + 1;
    sidecar.revision = nextRevision;
    // tmp 名含 pid + token 片段：崩溃残留可判归属；本模块不自动清扫 tmp（无锁保证的清扫会误删活跃写者的 tmp）。
    tmpPath = sidecarPath + '.tmp-' + process.pid + '-' + token.slice(0, 8);
    writeSidecarTmp(tmpPath, sidecar, priorMode);
    fs.renameSync(tmpPath, sidecarPath);
    published = true;
    const synced = syncDir(dir);
    if (synced.durability !== 'synced') {
      throw commitUnknownError(sidecarPath, nextRevision, synced.durability, synced.cause);
    }
  } catch (e) {
    if (!published) {
      if (nextRevision !== null) {
        if (hadRevision) sidecar.revision = prevRevision;
        else delete sidecar.revision; // 原本无 revision：删属性，而非留一个 undefined
      }
      if (tmpPath !== null) { try { fs.unlinkSync(tmpPath); } catch { /* 未创建/已清 */ } }
      if (e && typeof e.code === 'string' && PASSTHROUGH_WRITE_CODES.has(e.code)) throw e;
      // 未识别的底层错误（EIO/ENOSPC/…）：结构化落 sidecar_write_failed + committed:false（可达机器判定），
      // 原码进 causeCode——不让文件系统错误落进 CLI 的 internal/exit 2 兜底。
      const err = new Error(
        'sidecar 写入失败（未提交，磁盘与调用对象均未推进）：' + (e && e.code ? e.code + ': ' : '') + (e ? e.message : String(e))
      );
      err.code = 'sidecar_write_failed';
      err.committed = false;
      err.durability = null;
      err.revision = null;
      err.path = sidecarPath;
      err.causeCode = e && typeof e.code === 'string' ? e.code : null;
      err.cause = e;
      throw err;
    }
    throw e; // 已提交：不回滚，诊断已由 commitUnknownError 给出
  } finally {
    releaseLock(lockPath, token, held);
  }
  return { path: sidecarPath, committed: true, revision: nextRevision, durability: 'synced' };
}

function resolveLockTimeout(options) {
  if (typeof options.lockTimeoutMs === 'number' && Number.isFinite(options.lockTimeoutMs) && options.lockTimeoutMs >= 0) {
    return options.lockTimeoutMs;
  }
  const fromEnv = Number(process.env.ATLAS_LOCK_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  return DEFAULT_LOCK_TIMEOUT_MS;
}

// 原型键误查防护：`nodes[id]` 直取会命中 Object.prototype（nodes['constructor'] 为函数、nodes['__proto__']
// 为原型对象）→ 幽灵节点。一律 hasOwn；建号用 defineProperty（`nodes['__proto__'] = x` 会走 setter 改原型、节点不落）。
export function findNode(sidecar, nodeId) {
  if (!sidecar || !sidecar.nodes) return null;
  return Object.hasOwn(sidecar.nodes, nodeId) ? sidecar.nodes[nodeId] : null;
}

function setOwnNode(nodes, nodeId, node) {
  Object.defineProperty(nodes, nodeId, { value: node, enumerable: true, writable: true, configurable: true });
}

export function ensureNode(sidecar, nodeId, owner) {
  if (!Object.hasOwn(sidecar.nodes, nodeId) || !isPlainRecord(sidecar.nodes[nodeId])) {
    setOwnNode(sidecar.nodes, nodeId, {
      owner,
      truth: 'candidate',
      progress: 'planned',
      ledger: 'clean',
      evidence: [],
      history: [],
    });
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
