// store.mjs 单元测试：CAS revision 版本号 + 陈旧锁接管 + 锁超时（缺陷1/缺陷2 牙齿）。
// 全部使用临时目录，绝不触碰线上侧车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadSidecar, saveSidecar } from '../lib/store.mjs';

const STORE_URL = pathToFileURL(path.resolve('lib/store.mjs')).href;

function tmpSidecar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-test-'));
  return path.join(dir, 'atlas-state.json');
}

function writeRaw(sidecarPath, obj) {
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
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

test('旧侧车无 revision：loadSidecar 读出为 0（向后兼容）', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  assert.equal(loadSidecar(p).revision, 0);
});

test('save 后 revision 递增：0→1→2，且随 data 对象自然传递', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const sidecar = loadSidecar(p);
  saveSidecar(p, sidecar);
  assert.equal(sidecar.revision, 1);
  assert.equal(loadSidecar(p).revision, 1);
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
  assert.equal(fs.existsSync(p + '.lock'), false, '冲突后锁必须释放');
  assert.equal(loadSidecar(p).revision, 5, '冲突时不得覆盖磁盘数据');
});

test('陈旧锁（死 pid）被接管，save 成功', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  fs.writeFileSync(p + '.lock', JSON.stringify({ pid: deadPid(), at: Date.now() }) + '\n', 'utf8');
  saveSidecar(p, loadSidecar(p)); // 应 unlink 陈旧锁并接管
  assert.equal(loadSidecar(p).revision, 1);
  assert.equal(fs.existsSync(p + '.lock'), false);
});

test('陈旧锁（活 pid 但锁龄 >30s）按锁龄接管，save 成功', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  fs.writeFileSync(p + '.lock', JSON.stringify({ pid: process.pid, at: Date.now() - 31000 }) + '\n', 'utf8');
  saveSidecar(p, loadSidecar(p));
  assert.equal(loadSidecar(p).revision, 1);
  assert.equal(fs.existsSync(p + '.lock'), false);
});

test('活锁（本进程 pid 持有）在短 lockTimeoutMs 下抛 sidecar_locked 且不误删锁', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const lock = { pid: process.pid, at: Date.now() };
  fs.writeFileSync(p + '.lock', JSON.stringify(lock) + '\n', 'utf8');
  const t0 = Date.now();
  assert.throws(
    () => saveSidecar(p, fresh(), { lockTimeoutMs: 150 }),
    (err) => err.code === 'sidecar_locked'
  );
  assert.ok(Date.now() - t0 >= 140, '应等待到超时而非立即失败');
  assert.deepEqual(JSON.parse(fs.readFileSync(p + '.lock', 'utf8')), lock, '活锁不得被 unlink');
});

test('锁文件内容为 JSON {pid, at, token}（跨进程观察持锁内容；token 供接管后回读核对）', async () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const t0 = Date.now();
  // 子进程持锁后、rename 前延时 800ms，父进程在此窗口内读取锁内容。
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const realRename = fs.renameSync;
    fs.renameSync = (...a) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800); realRename(...a); };
    import(${JSON.stringify(STORE_URL)}).then(({ saveSidecar }) => {
      saveSidecar(${JSON.stringify(p)}, { schemaVersion: 1, atlas: 'd1', nodes: {} });
    }).catch((e) => { console.error(e); process.exit(1); });
  `]);
  let lockInfo = null;
  for (let i = 0; i < 200 && lockInfo === null; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (fs.existsSync(p + '.lock')) {
      try { lockInfo = JSON.parse(fs.readFileSync(p + '.lock', 'utf8')); } catch { /* 尚未写完 */ }
    }
  }
  const { code: status } = await new Promise((resolve) => child.on('exit', (c) => resolve({ code: c })));
  assert.equal(status, 0, '子进程 save 应成功');
  assert.ok(lockInfo, '应在持锁窗口内观察到锁文件');
  assert.equal(lockInfo.pid, child.pid, '锁内 pid 应为持锁子进程');
  assert.ok(Number.isFinite(lockInfo.at) && lockInfo.at >= t0 && lockInfo.at <= Date.now(), '锁内 at 应为获取时间戳');
  assert.ok(typeof lockInfo.token === 'string' && lockInfo.token.length >= 16, '锁内应携随机 token（≥16 字符）');
  assert.equal(loadSidecar(p).revision, 1);
  assert.equal(fs.existsSync(p + '.lock'), false, 'save 结束后锁已释放');
});

test('revision 非法值 fail-loud：load 抛 sidecar_bad_revision', () => {
  const p = tmpSidecar();
  writeRaw(p, { ...fresh(), revision: 'x' });
  assert.throws(() => loadSidecar(p), (err) => err.code === 'sidecar_bad_revision');
});

// ---- 0.7.0（demo-b holdout 对抗实验缺陷1）：只读侧车拒写 + 权限保留 ----

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
  assert.equal(fs.existsSync(p + '.lock'), false, '锁必须释放');
  assert.equal(fs.existsSync(p + '.tmp-' + process.pid), false, '不得残留 tmp 文件');
  fs.chmodSync(p, 0o644); // 恢复可写以便清理
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('权限保留：chmod 600 的侧车正常写入后仍是 600（rename 不再静默重置为 umask），内容正常推进', () => {
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

test('TOCTOU 加固：初锁被夺（回读 token 不一致）→ 不进入写阶段，按争用等到超时抛 sidecar_locked，不删他人锁', () => {
  const p = tmpSidecar();
  writeRaw(p, fresh());
  const before = fs.readFileSync(p, 'utf8');
  const thiefLock = { pid: process.pid, at: Date.now(), token: 'thief-token' };
  // 确定性模拟「判陈旧→unlink→重抢窗口内他席位夺锁」：
  // 拦截 saveSidecar 抢锁成功后的首次锁文件回读，在返回前用他席位锁替换路径上的锁文件。
  const realReadFileSync = fs.readFileSync;
  let stolen = false;
  fs.readFileSync = function intercepted(file, ...rest) {
    if (!stolen && String(file) === p + '.lock') {
      stolen = true;
      fs.unlinkSync(p + '.lock');
      fs.writeFileSync(p + '.lock', JSON.stringify(thiefLock) + '\n', 'utf8');
      return JSON.stringify(thiefLock);
    }
    return realReadFileSync.call(fs, file, ...rest);
  };
  try {
    assert.throws(
      () => saveSidecar(p, loadSidecar(p), { lockTimeoutMs: 150 }),
      (err) => err.code === 'sidecar_locked'
    );
  } finally {
    fs.readFileSync = realReadFileSync;
  }
  // token 核对失败：不得进入写阶段（磁盘未被覆盖），也不得误删他席位锁。
  assert.equal(fs.readFileSync(p, 'utf8'), before, '被夺锁后不得写入侧车');
  assert.deepEqual(JSON.parse(realReadFileSync.call(fs, p + '.lock', 'utf8')), thiefLock, '他席位锁不得被 unlink');
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
});
