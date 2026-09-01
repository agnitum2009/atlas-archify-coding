// state-machine unit tests (ADD-SPEC v1.0.0 §2 迁移表牙齿).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AXES, isAxis, isValidState, validateTransition, validateSetWrite } from '../lib/state-machine.mjs';

test('三轴状态集互斥且无重复', () => {
  for (const axis of Object.keys(AXES)) {
    const states = AXES[axis].states;
    assert.equal(new Set(states).size, states.length, axis + ' 状态集有重复');
    for (const state of states) {
      assert.ok(isValidState(axis, state), axis + '/' + state + ' 应为合法状态');
    }
  }
});

test('真相轴合法迁移：candidate→pending_confirmation→effective→closed 逐级单向', () => {
  for (const [from, to] of [['candidate', 'pending_confirmation'], ['pending_confirmation', 'effective'], ['effective', 'closed']]) {
    assert.equal(validateTransition('truth', from, to).ok, true, 'truth ' + from + '->' + to);
  }
});

test('真相轴非法迁移（回退/跳级）被拒并带规则码', () => {
  const bad = validateTransition('truth', 'effective', 'candidate');
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].rule, 'illegal_transition');
  const jump = validateTransition('truth', 'candidate', 'effective');
  assert.equal(jump.ok, false);
});

test('执行轴合法与非法迁移', () => {
  for (const [from, to] of [['planned', 'in_progress'], ['planned', 'cancelled'], ['in_progress', 'verified'], ['in_progress', 'blocked'], ['blocked', 'in_progress']]) {
    assert.equal(validateTransition('progress', from, to).ok, true, 'progress ' + from + '->' + to);
  }
  assert.equal(validateTransition('progress', 'planned', 'blocked').ok, false);
  assert.equal(validateTransition('progress', 'verified', 'in_progress').ok, false);
});

test('账务轴：clean→backlog→settled 单向', () => {
  assert.equal(validateTransition('ledger', 'clean', 'backlog').ok, true);
  assert.equal(validateTransition('ledger', 'backlog', 'settled').ok, true);
  assert.equal(validateTransition('ledger', 'settled', 'backlog').ok, false);
});

test('未知轴与非法状态值被拒', () => {
  assert.equal(validateTransition('unknown', 'a', 'b').ok, false);
  assert.equal(validateTransition('truth', 'nonsense', 'closed').diagnostics[0].rule, 'invalid_from_state');
  assert.equal(isAxis('unknown'), false);
});

// 提案④（2026-08-15 裁定）：set 写路径 A2 校验（复用上方迁移表，不复制）。
test('validateSetWrite：合法变更放行，同值/首写/初始化免表', () => {
  assert.equal(validateSetWrite('progress', 'planned', 'in_progress').ok, true);
  assert.equal(validateSetWrite('progress', 'in_progress', 'blocked').ok, true);
  // 同值写入（无变更）不触发校验：truth candidate→candidate 不在迁移表也放行
  assert.equal(validateSetWrite('truth', 'candidate', 'candidate').ok, true);
  // 轴尚无值（首次写）/初始化：任意目标直接写
  assert.equal(validateSetWrite('progress', undefined, 'verified').ok, true);
  assert.equal(validateSetWrite('progress', null, 'verified').ok, true);
  assert.equal(validateSetWrite('progress', 'planned', 'verified', { init: true }).ok, true);
});

test('validateSetWrite：违表被拒带 illegal_transition；--correction 放行并标记 admittedCorrection', () => {
  const bad = validateSetWrite('progress', 'planned', 'verified');
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].rule, 'illegal_transition');
  assert.equal(validateSetWrite('progress', 'verified', 'in_progress').ok, false);
  // 纠错通道：违表也放行，且 admittedCorrection=true（供落 corrected:true 留痕）
  const fixed = validateSetWrite('progress', 'planned', 'verified', { correction: true });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.admittedCorrection, true);
  // 合法迁移即使带 correction 也不标记（标记只指真实绕过 A2 的写入）
  const legal = validateSetWrite('progress', 'planned', 'in_progress', { correction: true });
  assert.equal(legal.ok, true);
  assert.equal(legal.admittedCorrection, false);
});

