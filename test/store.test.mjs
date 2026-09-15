// store.mjs 单元测试：形状守卫 + CAS revision + 保守 fail-closed 锁 + 提交边界（2026-09-15 存储批）。
// 全部使用临时目录，绝不触碰线上侧车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadSidecar, saveSidecar, findNode, ensureNode, validateSidecarShape, canonicalSidecarPath } from '../lib/store.mjs';

const STORE_URL = pathToFileURL(path.resolve('lib/store.mjs')).href;

function tmpSidecar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-test-'));
  return path.join(dir, 'atlas-state.json');
}

function writeRaw(sidecarPath, obj) {
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function tmpFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
}

// 取一个确认已死亡的 pid：子进程同步跑完即被回收。
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  return child.pid;
}

function fresh() {
  return { schemaVersion: 1, atlas: 'd1', nodes: {} };
}

test('消费字段坏形状在 load/save 前拒绝，既有文件及调用对象均不变', (t) => {
  const p = tmpSidecar();
  t.after(() => fs.rmSync(path.dirname(p), { recursive:true, force:true }));
  const cases = [
    {nodes:{n:{traceRefs:{}}}},
    {nodes:{n:{traceRefs:[42]}}},
    {notices:[{readBy:{}}]},
    {notices:[{readBy:[null]}]},
    {nodes:{n:{history:[{reason:{}}]}}},
    {trace:[{at:17}]},
    {trace:[{note:{text:'note'}}]},
    {lessons:[{source:[]}]},
    {lessons:[{hits:-1}]},
    {lessons:[{hits:0.5}]},
  ];
  for (const fields of cases) {
    const malformed = {...fresh(), ...fields};
    writeRaw(p, malformed);
    const raw = fs.readFileSync(p, 'utf8');
    assert.throws(() => loadSidecar(p), {code:'sidecar_bad_shape'});
    assert.equal(fs.readFileSync(p, 'utf8'), raw);
    writeRaw(p, fresh());
    const disk = fs.readFileSync(p, 'utf8'), original = structuredClone(malformed);
    assert.throws(() => saveSidecar(p, malformed), {code:'sidecar_bad_shape'});
    assert.deepEqual(malformed, original);
    assert.equal(fs.readFileSync(p, 'utf8'), disk);
    assert.equal(fs.existsSync(p + '.lock'), false);
  }
});

test('增量缺省/null、对象前后态及未知扩展字段可 load/save 往返', (t) => {
  const p = tmpSidecar();
  t.after(() => fs.rmSync(path.dirname(p), {recursive:true, force:true}));
  const legacy = {...fresh(),
    nodes:{n:{traceRefs:null, future:{deep:[1,2]}, history:[{kind:'future-event', reason:null,
      from:{progress:'planned'}, to:{progress:'verified'}, futureEvent:{extra:true}}]}},
    notices:[{readBy:null, unknown:{value:7}}, {readBy:['reviewer']}],
    trace:[{note:null, unknown:9}], lessons:[{hits:null, source:null, extra:['kept']}],
    futureRoot:{value:42},
  };
  assert.equal(validateSidecarShape(legacy), legacy);
  writeRaw(p, legacy);
  const loaded = loadSidecar(p);
  saveSidecar(p, loaded);
  assert.deepEqual(loadSidecar(p), {...legacy, revision:1});
});

test('旧侧车无 revision：loadSidecar 读出为 0（向后兼容）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  assert.equal(loadSidecar(p).revision, 0);
});

test('save 后 revision 递增：0→1→2，且随 data 对象自然传递', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const sidecar = loadSidecar(p);
  const res = saveSidecar(p, sidecar);
  assert.equal(sidecar.revision, 1);
  assert.equal(loadSidecar(p).revision, 1);
  assert.deepEqual(res, { path: p, committed: true, revision: 1, durability: 'synced' });
  saveSidecar(p, sidecar); // 同一对象再改再存，无需重新 load
  assert.equal(loadSidecar(p).revision, 2);
  assert.equal(loadSidecar(p).schemaVersion, 1); // schemaVersion 保持 1
});

test('CAS 冲突：load 后磁盘被外部改写 revision，save 抛 sidecar_conflict 并写明两个值', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const sidecar = loadSidecar(p); // revision 0
  writeRaw(p, { ...fresh(), revision: 5 }); // 他席位抢先写
  assert.throws(
    () => saveSidecar(p, sidecar),
    (err) => err.code === 'sidecar_conflict' &&
      err.message.includes('5') && err.message.includes('0') &&
      err.message.includes('重放')
  );
  assert.equal(fs.existsSync(`${p}.lock`), false, '冲突后锁必须释放');
  assert.equal(loadSidecar(p).revision, 5, '冲突时不得覆盖磁盘数据');
  assert.equal(sidecar.revision, 0, '冲突不得推进调用对象 revision');
});

// ---- 缺陷6：锁协议保守 fail-closed（无自动回收） ----

test('死 pid 残留锁不得被接管：save 抛 sidecar_locked，锁与磁盘均未动', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const lock = { schemaVersion: 1, pid: deadPid(), at: Date.now() - 10 * 60 * 1000, token: 'deadbeefdeadbeef' };
  fs.writeFileSync(`${p}.lock`, JSON.stringify(lock) + '\n', 'utf8');
  assert.throws(
    () => saveSidecar(p, loadSidecar(p), { lockTimeoutMs: 120 }),
    (err) => err.code === 'sidecar_locked' &&
      err.message.includes('liveness=absent') &&
      err.message.includes('恢复流程') &&
      err.holder && err.holder.liveness === 'absent'
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')), lock, '死 pid 残留锁不得被 unlink/接管');
  assert.equal(loadSidecar(p).revision, 0, '未接管 ⇒ 未写入');
  assert.deepEqual(tmpFiles(path.dirname(p)), [], '未进入写阶段不留 tmp');
});

test('活 pid 但锁龄超限：同样不按龄接管（旧实现对活 PID>30s 会夺锁）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const lock = { schemaVersion: 1, pid: process.pid, at: Date.now() - 10 * 60 * 1000, token: 'cafebabecafebabe' };
  fs.writeFileSync(`${p}.lock`, JSON.stringify(lock) + '\n', 'utf8');
  assert.throws(
    () => saveSidecar(p, loadSidecar(p), { lockTimeoutMs: 120 }),
    (err) => err.code === 'sidecar_locked' && err.holder && err.holder.liveness === 'alive'
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')), lock, '活锁不得被 unlink');
  assert.equal(loadSidecar(p).revision, 0);
});

test('活锁（本进程 pid 持有）在短 lockTimeoutMs 下抛 sidecar_locked 且不误删锁', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const lock = { schemaVersion: 1, pid: process.pid, at: Date.now(), token: '0123456789abcdef' };
  fs.writeFileSync(`${p}.lock`, JSON.stringify(lock) + '\n', 'utf8');
  const t0 = Date.now();
  assert.throws(
    () => saveSidecar(p, fresh(), { lockTimeoutMs: 150 }),
    (err) => err.code === 'sidecar_locked'
  );
  assert.ok(Date.now() - t0 >= 140, '应等待到超时而非立即失败');
  assert.deepEqual(JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')), lock, '活锁不得被 unlink');
});

test('释放只删本方锁：持锁期间锁被外部替换 → 释放不删他人锁（写入仍成功）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const foreign = { schemaVersion: 1, pid: process.pid, at: Date.now(), token: 'foreign-token-000' };
  const realRename = fs.renameSync;
  let swapped = false;
  fs.renameSync = (from, to) => {
    // 在真正发布前，把路径上的锁换成「他人锁」（模拟外部替换）
    if (!swapped && path.resolve(String(to)) === path.resolve(p)) {
      swapped = true;
      fs.unlinkSync(`${p}.lock`);
      fs.writeFileSync(`${p}.lock`, JSON.stringify(foreign) + '\n', 'utf8');
    }
    return realRename.call(fs, from, to);
  };
  try {
    saveSidecar(p, loadSidecar(p)); // 本次写入照常提交（副作用已发生，只能如实披露）
  } finally {
    fs.renameSync = realRename;
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')), foreign, '他人的锁不得被删除');
  assert.equal(loadSidecar(p).revision, 1, '本次写入已提交（替换锁不改写盘语义）');
});

test('锁文件内容为 JSON {schemaVersion, pid, at, token}；持锁窗口内第二写者 fail-closed 且不动该锁', async () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const t0 = Date.now();
  // 子进程持锁后、rename 前延时 800ms，父进程在此窗口内读锁内容并尝试第二次写入。
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const realRename = fs.renameSync;
    fs.renameSync = (...a) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800); realRename(...a); };
    import(${JSON.stringify(STORE_URL)}).then(({ saveSidecar }) => {
      saveSidecar(${JSON.stringify(p)}, { schemaVersion: 1, atlas: 'd1', nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } } });
    }).catch((e) => { console.error(e); process.exit(1); });
  `]);
  let lockInfo = null;
  for (let i = 0; i < 200 && lockInfo === null; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (fs.existsSync(`${p}.lock`)) {
      try { lockInfo = JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')); } catch { /* 尚未写完 */ }
    }
  }
  assert.ok(lockInfo, '应在持锁窗口内观察到锁文件');
  assert.equal(lockInfo.pid, child.pid, '锁内 pid 应为持锁子进程');
  assert.ok(Number.isFinite(lockInfo.at) && lockInfo.at >= t0 && lockInfo.at <= Date.now(), '锁内 at 应为获取时间戳');
  assert.ok(typeof lockInfo.token === 'string' && lockInfo.token.length >= 16, '锁内应携随机 token（≥16 字符）');
  assert.equal(lockInfo.schemaVersion, 1);
  // 确定性交错：第二写者（父进程、活锁）必须 fail-closed，且不删持有者的锁。
  const self = loadSidecar(p);
  let err = null;
  try { saveSidecar(p, self, { lockTimeoutMs: 150 }); } catch (e) { err = e; }
  assert.equal(err && err.code, 'sidecar_locked', '持锁期间第二写者必须 fail-closed');
  assert.deepEqual(JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')), lockInfo, '持有者的锁不得被第二写者删除');
  assert.equal(fs.existsSync(`${p}.lock`) && JSON.parse(fs.readFileSync(`${p}.lock`, 'utf8')).token, lockInfo.token);
  const { code: status } = await new Promise((resolve) => child.on('exit', (c) => resolve({ code: c })));
  assert.equal(status, 0, '子进程 save 应成功');
  assert.equal(loadSidecar(p).revision, 1);
  assert.equal(fs.existsSync(`${p}.lock`), false, 'save 结束后锁已释放');
});

// ---- 缺陷1：形状守卫 / 安全整数 / 原型键 ----

test('形状守卫：nodes 数组 / 顶层 null / 节点非记录 / 字段类型错 一律 sidecar_bad_shape', () => {
  const p = tmpSidecar();
  const cases = [
    ['nodes 为数组', { schemaVersion: 1, nodes: [] }],
    ['节点为数组', { schemaVersion: 1, nodes: { a: [] } }],
    ['节点为 null', { schemaVersion: 1, nodes: { a: null } }],
    ['evidence 非数组', { schemaVersion: 1, nodes: { a: { evidence: 'x' } } }],
    ['evidence 元素非串', { schemaVersion: 1, nodes: { a: { evidence: [1] } } }],
    ['progress 非串', { schemaVersion: 1, nodes: { a: { progress: 3 } } }],
    ['history 元素非记录', { schemaVersion: 1, nodes: { a: { history: ['x'] } } }],
    ['evidenceMeta 非记录', { schemaVersion: 1, nodes: { a: { evidenceMeta: [] } } }],
    ['notices 非数组', { schemaVersion: 1, nodes: {}, notices: {} }],
    ['trace 元素非记录', { schemaVersion: 1, nodes: {}, trace: [1] }],
  ];
  for (const [name, obj] of cases) {
    assert.throws(() => validateSidecarShape(obj, { source: 'test' }), (err) => err.code === 'sidecar_bad_shape', name);
  }
  const dir = path.dirname(p);
  writeRaw(p, { schemaVersion: 1, nodes: [] });
  assert.throws(() => loadSidecar(p), (err) => err.code === 'sidecar_bad_shape');
  fs.writeFileSync(p, 'null\n');
  assert.throws(() => loadSidecar(p), (err) => err.code === 'sidecar_bad_shape');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('形状守卫：save 亦守结构（坏形状不落盘、不改磁盘）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const before = fs.readFileSync(p, 'utf8');
  assert.throws(() => saveSidecar(p, { schemaVersion: 1, nodes: [] }), (err) => err.code === 'sidecar_bad_shape');
  assert.equal(fs.readFileSync(p, 'utf8'), before, '坏形状不得落盘');
  assert.equal(fs.existsSync(`${p}.lock`), false, '形状守卫在取锁之前：不留锁');
});

test('旧增量字段合法缺省 + 未知字段往返保留（snapshot-policy §5.3）', () => {
  const p = tmpSidecar();
  writeRaw(p, {
    schemaVersion: 1,
    revision: 0,
    nodes: { a: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, b: { futureField: { deep: [1, 2] } } },
    futureTop: { keep: true },
  });
  const sc = loadSidecar(p);
  assert.equal(sc.nodes.a.class, undefined, '缺 class 合法（存量 540/548 无 class）');
  sc.nodes.a.class = 'task';
  saveSidecar(p, sc);
  const back = loadSidecar(p);
  assert.deepEqual(back.nodes.b.futureField, { deep: [1, 2] }, '未知节点字段原样保留');
  assert.deepEqual(back.futureTop, { keep: true }, '未知顶层字段原样保留');
});

test('revision 非安全整数 fail-loud：load 抛 sidecar_bad_revision', () => {
  const p = tmpSidecar();
  writeRaw(p, { ...fresh(), revision: 'x' });
  assert.throws(() => loadSidecar(p), (err) => err.code === 'sidecar_bad_revision');
  writeRaw(p, { ...fresh(), revision: 2 ** 53 });
  assert.throws(() => loadSidecar(p), (err) => err.code === 'sidecar_bad_revision');
});

test("原型键防护：nodes['constructor'] 不是节点；ensureNode(__proto__) 建自有键且不污染原型", () => {
  assert.equal(findNode({ nodes: {} }, 'constructor'), null, 'hasOwn 守卫：不得命中 Object.prototype');
  assert.equal(findNode({ nodes: {} }, '__proto__'), null);
  const sc = { schemaVersion: 1, nodes: {} };
  ensureNode(sc, '__proto__', 'o');
  assert.equal(Object.hasOwn(sc.nodes, '__proto__'), true);
  assert.equal(sc.nodes.__proto__.owner, 'o');
  assert.equal(Object.getPrototypeOf(sc.nodes), Object.prototype, '原型未被污染');
  ensureNode(sc, 'constructor', 'o');
  assert.equal(Object.hasOwn(sc.nodes, 'constructor'), true);
  assert.equal(sc.nodes.constructor.owner, 'o');
});

// ---- 缺陷5：提交边界（权限先于发布 / 提交前回滚 / 提交后已提交诊断） ----

test('只读守卫：chmod 444 的侧车 save 抛 sidecar_readonly，内容与权限均未变，锁与 tmp 均已清理', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  fs.chmodSync(p, 0o444);
  const before = fs.readFileSync(p, 'utf8');
  assert.throws(
    () => saveSidecar(p, loadSidecar(p)),
    (err) => err.code === 'sidecar_readonly' && err.message.includes('chmod +w')
  );
  assert.equal(fs.readFileSync(p, 'utf8'), before, '拒写不得改动内容');
  assert.equal(fs.statSync(p).mode & 0o777, 0o444, '拒写不得改动权限（修复前：静默写入且 444→664 被重置）');
  assert.equal(fs.existsSync(`${p}.lock`), false, '锁必须释放');
  assert.deepEqual(tmpFiles(path.dirname(p)), [], '不得残留 tmp 文件');
  fs.chmodSync(p, 0o644); // 恢复可写以便清理
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('权限保留：chmod 600 的侧车正常写入后仍是 600（权限在发布前定稿），内容正常推进', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  fs.chmodSync(p, 0o600);
  saveSidecar(p, loadSidecar(p));
  assert.equal(fs.statSync(p).mode & 0o777, 0o600, '写入后权限必须保留原 600');
  assert.equal(loadSidecar(p).revision, 1, '内容正常推进（revision 递增）');
  saveSidecar(p, loadSidecar(p));
  assert.equal(fs.statSync(p).mode & 0o777, 0o600, '二次写入权限仍保留');
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('提交前 chmod 失败（注入）：原码透传、revision 回滚、tmp 清理、磁盘与权限未变', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  fs.chmodSync(p, 0o644); // 与 tmp 起步 0600 不同 ⇒ 必然走 fchmod（注入点）
  const before = fs.readFileSync(p, 'utf8');
  const sc = loadSidecar(p);
  const realFchmod = fs.fchmodSync;
  fs.fchmodSync = () => { const e = new Error('inject fchmod fail'); e.code = 'EACCES'; throw e; };
  let err = null;
  try { saveSidecar(p, sc); } catch (e) { err = e; }
  fs.fchmodSync = realFchmod;
  assert.equal(err && err.code, 'sidecar_write_failed', '提交前失败结构化落 sidecar_write_failed（不进 internal）');
  assert.equal(err.committed, false);
  assert.equal(err.causeCode, 'EACCES', '底层因由原样进 causeCode');
  assert.equal(sc.revision, 0, '提交前失败必须回滚调用对象 revision（修复前：+1 已生效）');
  assert.equal(fs.readFileSync(p, 'utf8'), before, '磁盘未变');
  assert.equal(fs.statSync(p).mode & 0o777, 0o644, '权限未变（修复前：600→644 静默放宽）');
  assert.deepEqual(tmpFiles(path.dirname(p)), [], 'tmp 已清理');
  assert.equal(fs.existsSync(`${p}.lock`), false, '锁已释放');
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('提交前 tmp 写入失败：结构化 sidecar_write_failed（committed=false）+ 对象 revision 回滚', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const sc = loadSidecar(p);
  // 注入点 = tmp 文件的 fsync（第 1 次文件 fsync 是锁文件、第 2 次才是 tmp；目录 fsync 单独一跳）。
  const realFsync = fs.fsyncSync;
  let fileSyncs = 0;
  fs.fsyncSync = (fd) => {
    if (!fs.fstatSync(fd).isDirectory()) {
      fileSyncs += 1;
      if (fileSyncs === 2) { const e = new Error('inject tmp fsync EIO'); e.code = 'EIO'; throw e; }
    }
    return realFsync.call(fs, fd);
  };
  let err = null;
  try { saveSidecar(p, sc); } catch (e) { err = e; }
  fs.fsyncSync = realFsync;
  assert.equal(err && err.code, 'sidecar_write_failed', '底层 EIO 结构化落侧车写失败码，不进 internal');
  assert.equal(err.committed, false);
  assert.equal(err.revision, null);
  assert.equal(err.path, p);
  assert.equal(err.causeCode, 'EIO');
  assert.equal(sc.revision, 0, 'revision 回滚');
  assert.equal(loadSidecar(p).revision, 0, '磁盘未推进');
  assert.deepEqual(tmpFiles(path.dirname(p)), []);
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('原本无 revision 的对象：提交前失败后属性被 delete（不留 undefined）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const sc = loadSidecar(p);
  delete sc.revision;
  fs.chmodSync(p, 0o644);
  const realFchmod = fs.fchmodSync;
  fs.fchmodSync = () => { const e = new Error('inject'); e.code = 'EACCES'; throw e; };
  let err = null;
  try { saveSidecar(p, sc); } catch (e) { err = e; }
  fs.fchmodSync = realFchmod;
  assert.ok(err);
  assert.equal(Object.hasOwn(sc, 'revision'), false, '原无 revision ⇒ 删属性，不伪装「完全未变」以外的形态');
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('提交后目录 fsync 失败：sidecar_commit_unknown（committed=true/revision/durability），不伪装零写入', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const sc = loadSidecar(p);
  const realFsync = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    if (fs.fstatSync(fd).isDirectory()) { const e = new Error('inject dir fsync EIO'); e.code = 'EIO'; throw e; }
    return realFsync.call(fs, fd);
  };
  let err = null;
  try { saveSidecar(p, sc); } catch (e) { err = e; }
  fs.fsyncSync = realFsync;
  assert.equal(err && err.code, 'sidecar_commit_unknown');
  assert.equal(err.committed, true);
  assert.equal(err.revision, 1);
  assert.equal(err.durability, 'unknown');
  assert.equal(err.path, p);
  assert.equal(loadSidecar(p).revision, 1, '磁盘内容确已提交（诊断不得伪装零写入）');
  assert.equal(sc.revision, 1, '调用对象按已提交态推进');
  assert.equal(fs.existsSync(`${p}.lock`), false, '锁已释放');
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('目录 fsync 平台不支持（ENOTSUP）：同样报已提交/耐久 unsupported（不静默放行）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const realFsync = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    if (fs.fstatSync(fd).isDirectory()) { const e = new Error('inject ENOTSUP'); e.code = 'ENOTSUP'; throw e; }
    return realFsync.call(fs, fd);
  };
  let err = null;
  try { saveSidecar(p, loadSidecar(p)); } catch (e) { err = e; }
  fs.fsyncSync = realFsync;
  assert.equal(err && err.code, 'sidecar_commit_unknown');
  assert.equal(err.committed, true);
  assert.equal(err.durability, 'unsupported');
  assert.equal(loadSidecar(p).revision, 1);
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

// ---- 路径规范化（symlink / 硬链接 / 断链） ----

test('symlink 侧车：save 写真实目标（链接保留、不产生第二把锁）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-link-'));
  const real = path.join(dir, 'real');
  fs.mkdirSync(real, { recursive: true });
  const target = path.join(real, 'atlas-state.json');
  writeRaw(target, fresh());
  const link = path.join(dir, 'link.json');
  fs.symlinkSync(target, link);

  assert.equal(canonicalSidecarPath(link), fs.realpathSync(target), '规范化到真实路径');
  const sc = loadSidecar(link);
  saveSidecar(link, sc);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, '链接本身必须保留（修复前：rename 把链接替换成普通文件）');
  assert.equal(loadSidecar(target).revision, 1, '写入落在真实目标');
  assert.equal(fs.existsSync(`${target}.lock`), false, '锁只在真实路径上，且已释放');
  assert.equal(fs.existsSync(`${link}.lock`), false, 'alias 路径不产生第二把锁');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('硬链接侧车（nlink>1）：保守拒写 sidecar_hardlinked，零写入', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-hard-'));
  const target = path.join(dir, 'atlas-state.json');
  writeRaw(target, fresh());
  const alias = path.join(dir, 'alias.json');
  fs.linkSync(target, alias);
  const before = fs.readFileSync(target, 'utf8');
  assert.throws(() => saveSidecar(alias, loadSidecar(alias)), (err) => err.code === 'sidecar_hardlinked');
  assert.equal(fs.readFileSync(target, 'utf8'), before, '拒写不得改动内容');
  assert.equal(fs.existsSync(`${target}.lock`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('断链 symlink：fail-loud sidecar_path_unresolvable（不按「新账本」回落）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-broken-'));
  const link = path.join(dir, 'dangling.json');
  fs.symlinkSync(path.join(dir, 'missing-target.json'), link);
  assert.throws(() => canonicalSidecarPath(link), (err) => err.code === 'sidecar_path_unresolvable');
  assert.throws(() => loadSidecar(link), (err) => err.code === 'sidecar_path_unresolvable');
  assert.equal(fs.existsSync(path.join(dir, 'missing-target.json')), false, '不得凭空造出目标文件');
  fs.rmSync(dir, { recursive: true, force: true });
});
