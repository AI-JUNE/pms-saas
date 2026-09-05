import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_AUDIT_ENTITY, accessMeta, adminAccessEvent, adminChangeKind,
  coarseIp, isAdminPath, normalizePath, sanitizeAccessDetail,
} from '../src/lib/auditAccess.ts';

test('normalizePath: 쿼리·해시·트레일링 슬래시 제거, 숫자 세그먼트 일반화', () => {
  assert.equal(normalizePath('/api/admin/users?limit=10'), '/api/admin/users');
  assert.equal(normalizePath('/api/admin/users/'), '/api/admin/users');
  assert.equal(normalizePath('/api/issues/42/journal#x'), '/api/issues/:id/journal');
});

test('isAdminPath: 관리·감사 경로만 대상', () => {
  assert.equal(isAdminPath('/api/admin/users'), true);
  assert.equal(isAdminPath('/api/audit'), true);
  assert.equal(isAdminPath('/api/issues'), false);
});

test('adminAccessEvent: 경로+메서드로 안정적 이벤트명 생성', () => {
  assert.equal(adminAccessEvent('/api/admin/users', 'GET'), 'admin.users.view');
  assert.equal(adminAccessEvent('/api/admin/users', 'PATCH'), 'admin.users.update');
  assert.equal(adminAccessEvent('/api/admin/migrate', 'POST'), 'admin.migrate.run');
  assert.equal(adminAccessEvent('/api/admin/security-events?event=login', 'GET'), 'admin.security-events.view');
  assert.equal(adminAccessEvent('/api/audit', 'GET'), 'admin.audit.view');
  assert.equal(adminAccessEvent('/api/admin/users', 'OPTIONS'), 'admin.users.access');
});

test('sanitizeAccessDetail: PII·비밀 키는 통째로 제거', () => {
  const out = sanitizeAccessDetail({
    count: 3, email: 'a@b.com', userName: '홍길동', tempPassword: 'x',
    apiKey: 'k', authorization: 'Bearer t', change: 'role_change', ok: true,
  });
  assert.deepEqual(out, { count: 3, change: 'role_change', ok: true });
});

test('sanitizeAccessDetail: 긴 문자열 절단, 배열은 개수만, 객체는 표식만', () => {
  const out = sanitizeAccessDetail({ note: 'a'.repeat(200), items: [1, 2, 3], nested: { a: 1 } });
  assert.equal((out.note as string).length, 121);
  assert.equal(out.items, 3);
  assert.equal(out.nested, '[object]');
});

test('sanitizeAccessDetail: 객체가 아니면 빈 객체', () => {
  assert.deepEqual(sanitizeAccessDetail(null), {});
  assert.deepEqual(sanitizeAccessDetail('x'), {});
  assert.deepEqual(sanitizeAccessDetail([1, 2]), {});
});

test('adminChangeKind: 변경 유형만 도출(값 미노출)', () => {
  assert.equal(adminChangeKind({ resetPassword: true }), 'password_reset');
  assert.equal(adminChangeKind({ isActive: false }), 'deactivate');
  assert.equal(adminChangeKind({ isActive: true }), 'activate');
  assert.equal(adminChangeKind({ role: 'admin' }), 'role_change');
  assert.equal(adminChangeKind({}), 'unknown');
  assert.equal(adminChangeKind(null), 'unknown');
});

test('coarseIp: IPv4 마지막 옥텟 마스킹, 비정상 값은 빈 문자열', () => {
  assert.equal(coarseIp('203.0.113.9, 70.41.3.18'), '203.0.113.x');
  assert.equal(coarseIp('2001:db8::1234'), '2001:db8::x');
  assert.equal(coarseIp(''), '');
  assert.equal(coarseIp(undefined), '');
  assert.equal(coarseIp('nonsense'), '');
});

test('accessMeta: 헤더에서 안전한 메타만 추출', () => {
  const headers = new Map<string, string>([
    ['x-forwarded-for', '198.51.100.7'],
    ['x-request-id', 'req-1'],
    ['user-agent', 'UA/1.0'],
    ['cookie', 'session=secret'],
  ]);
  const meta = accessMeta({ headers: { get: (n: string) => headers.get(n) ?? null } });
  assert.deepEqual(meta, { ip: '198.51.100.x', requestId: 'req-1', ua: 'UA/1.0' });
  assert.equal(ADMIN_AUDIT_ENTITY, 'admin');
});

test('accessMeta: 헤더가 없으면 빈 객체', () => {
  assert.deepEqual(accessMeta(undefined), {});
});
