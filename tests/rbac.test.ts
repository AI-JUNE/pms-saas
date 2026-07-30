import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_RANK, actionSatisfies } from '../src/lib/rbacRank.ts';

test('rank order: read < write < approve < admin', () => {
  assert.ok(ACTION_RANK.read < ACTION_RANK.write);
  assert.ok(ACTION_RANK.write < ACTION_RANK.approve);
  assert.ok(ACTION_RANK.approve < ACTION_RANK.admin);
});

test('higher grant satisfies lower need (admin -> read/write/approve)', () => {
  for (const need of ['read', 'write', 'approve', 'admin']) {
    assert.equal(actionSatisfies(['admin'], need), true, `admin should satisfy ${need}`);
  }
  assert.equal(actionSatisfies(['write'], 'read'), true);
});

test('lower grant does NOT satisfy higher need', () => {
  assert.equal(actionSatisfies(['read'], 'write'), false);
  assert.equal(actionSatisfies(['write'], 'approve'), false);
  assert.equal(actionSatisfies(['approve'], 'admin'), false);
});

test('unknown needed action is fail-closed even with admin grant', () => {
  assert.equal(actionSatisfies(['admin'], 'delete-everything'), false);
});

test('unknown granted action counts as no permission', () => {
  assert.equal(actionSatisfies(['???'], 'read'), false);
});

test('empty grant list satisfies nothing', () => {
  assert.equal(actionSatisfies([], 'read'), false);
});

test('any one sufficient grant in a mixed list is enough', () => {
  assert.equal(actionSatisfies(['read', 'approve'], 'write'), true);
});
