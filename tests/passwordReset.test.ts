/**
 * passwordReset.test.ts — 비밀번호 재설정(토큰·만료·메일 스텁). 2026-10-07 (주간 수동, ROADMAP ⑩ 27)
 *
 * 기본 OFF 원칙: MAIL_PROVIDER 미설정이면 **아무것도 보내지 않는** log 스텁이다. 토큰은 해시만 저장한다.
 * 이 테스트는 파일만 읽는다 — 네트워크·DB 를 쓰지 않고 process.env 를 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAIL_PROVIDER_ENV, RESET_TTL_ENV, DEFAULT_RESET_TTL_MIN, RESET_REQUEST_RESPONSE,
  mailProviderKind, maskRecipient, createMailAdapter, resetTtlMinutes, generateResetToken, hashResetToken,
  tokenLooksValid, resetExpiry, evaluateResetToken, verdictMessage, validateNewPassword, emailLooksValid,
  buildResetMail, resetAuditDetail, passwordResetStatus,
} from '../src/lib/passwordReset.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test("mailProviderKind: 미설정·공백·'log' 는 log 스텁, 그 외는 unsupported(보낸 척하지 않는다)", () => {
  assert.equal(mailProviderKind({}), 'log');
  assert.equal(mailProviderKind({ MAIL_PROVIDER: '' }), 'log');
  assert.equal(mailProviderKind({ MAIL_PROVIDER: ' LOG ' }), 'log');
  assert.equal(mailProviderKind({ MAIL_PROVIDER: 'resend' }), 'unsupported');
  assert.equal(mailProviderKind({ MAIL_PROVIDER: 'smtp' }), 'unsupported');
  assert.equal(mailProviderKind(null), 'log');
  assert.equal(MAIL_PROVIDER_ENV, 'MAIL_PROVIDER');
});

test('log 어댑터는 실제 발송 0, 본문(링크·토큰)을 로그에 남기지 않는다', async () => {
  const lines: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
  const logger = { info: (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, fields }), warn: (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, fields }) };
  const a = createMailAdapter({}, logger);
  assert.equal(a.kind, 'log'); assert.equal(a.canSend, false);
  const token = generateResetToken();
  const r = await a.send(buildResetMail('https://pms.example.com', 'user@company.com', token, 30));
  assert.deepEqual(r, { sent: false, delivered: 'log', provider: 'log' });
  assert.equal(lines.length, 1);
  const dumped = JSON.stringify(lines);
  assert.ok(!dumped.includes(token), '토큰이 로그에 실렸다');
  assert.ok(!dumped.includes('reset-password?token='), '링크가 로그에 실렸다');
  assert.ok(!dumped.includes('user@company.com'), '수신자 원문이 로그에 실렸다');
  assert.ok(dumped.includes('us***@company.com'));
});

test('지원하지 않는 provider 는 send 가 던지지 않고 실패를 돌려준다(요청 응답은 동일하게 나가야 한다)', async () => {
  const warns: unknown[] = [];
  const a = createMailAdapter({ MAIL_PROVIDER: 'sendgrid' }, { info: () => {}, warn: (m, f) => warns.push([m, f]) });
  assert.equal(a.kind, 'unsupported'); assert.equal(a.canSend, false);
  const r = await a.send({ to: 'a@b.co', subject: 's', text: 't' });
  assert.equal(r.sent, false); assert.equal(r.delivered, 'none'); assert.match(String(r.error), /unsupported/);
  assert.equal(warns.length, 1);
});

test('maskRecipient: 앞 2자만 남긴다', () => {
  assert.equal(maskRecipient('hong@gowon.co.kr'), 'ho***@gowon.co.kr');
  assert.equal(maskRecipient('a@b.c'), 'a***@b.c');
  assert.equal(maskRecipient('nonsense'), '***');
  assert.equal(maskRecipient(''), '');
});

test('resetTtlMinutes: 정수·범위 안만 인정, 아니면 기본 30분', () => {
  assert.equal(resetTtlMinutes({}), DEFAULT_RESET_TTL_MIN);
  assert.equal(resetTtlMinutes({ PASSWORD_RESET_TTL_MIN: '60' }), 60);
  assert.equal(resetTtlMinutes({ PASSWORD_RESET_TTL_MIN: '2' }), DEFAULT_RESET_TTL_MIN, '너무 짧으면 기본');
  assert.equal(resetTtlMinutes({ PASSWORD_RESET_TTL_MIN: '99999' }), DEFAULT_RESET_TTL_MIN, '너무 길면 기본');
  assert.equal(resetTtlMinutes({ PASSWORD_RESET_TTL_MIN: 'abc' }), DEFAULT_RESET_TTL_MIN);
  assert.equal(RESET_TTL_ENV, 'PASSWORD_RESET_TTL_MIN');
});

test('토큰: 무작위·base64url·해시는 결정적이고 원문과 다르다', () => {
  const t1 = generateResetToken(); const t2 = generateResetToken();
  assert.notEqual(t1, t2);
  assert.ok(tokenLooksValid(t1) && tokenLooksValid(t2));
  assert.equal(t1.length, 43);
  assert.equal(hashResetToken(t1), hashResetToken(t1));
  assert.notEqual(hashResetToken(t1), hashResetToken(t2));
  assert.match(hashResetToken(t1), /^[0-9a-f]{64}$/);
  assert.notEqual(hashResetToken(t1), t1);
  for (const bad of ['', 'short', 'has space ' + 'a'.repeat(40), 'a'.repeat(65), null, undefined, 'abc$' + 'a'.repeat(40)]) {
    assert.equal(tokenLooksValid(bad), false, String(bad));
  }
});

test('evaluateResetToken: 없음·사용됨·만료·정상 — 경계 포함', () => {
  const now = new Date('2026-10-07T09:00:00Z');
  assert.equal(evaluateResetToken(null, now), 'not_found');
  assert.equal(evaluateResetToken({ expiresAt: resetExpiry(now, 30) }, now), 'ok');
  assert.equal(evaluateResetToken({ expiresAt: new Date(now.getTime() + 1) }, now), 'ok');
  assert.equal(evaluateResetToken({ expiresAt: now }, now), 'expired', '만료 시각과 같으면 만료');
  assert.equal(evaluateResetToken({ expiresAt: new Date(now.getTime() - 1) }, now), 'expired');
  assert.equal(evaluateResetToken({ expiresAt: resetExpiry(now, 30), usedAt: now }, now), 'used');
  assert.equal(evaluateResetToken({ expiresAt: 'garbage' }, now), 'expired', '판독 불가 만료일은 유효로 보지 않는다');
  assert.equal(verdictMessage('ok'), '');
  assert.match(verdictMessage('expired'), /만료/);
  assert.equal(verdictMessage('used'), verdictMessage('not_found'), '사용됨·없음은 같은 문구(토큰 탐색에 힌트를 주지 않는다)');
});

test('validateNewPassword / emailLooksValid', () => {
  assert.equal(validateNewPassword('short'), '비밀번호는 8자 이상이어야 합니다');
  assert.equal(validateNewPassword('        '), '비밀번호는 공백만으로 만들 수 없습니다');
  assert.equal(validateNewPassword('a'.repeat(300)), '비밀번호가 너무 깁니다');
  assert.equal(validateNewPassword('goodpass1'), null);
  assert.equal(emailLooksValid('a@b.co'), true);
  assert.equal(emailLooksValid('nope'), false);
  assert.equal(emailLooksValid(''), false);
});

test('buildResetMail: 링크에 토큰이 URL 인코딩되어 들어가고 유효시간을 알린다', () => {
  const m = buildResetMail('https://pms.example.com/', 'u@x.io', 'tok_en-123', 45);
  assert.equal(m.to, 'u@x.io');
  assert.ok(m.text.includes('https://pms.example.com/reset-password?token=tok_en-123'));
  assert.ok(!m.text.includes('.com//reset'), '끝 슬래시 중복');
  assert.ok(m.text.includes('45분'));
  assert.match(m.subject, /비밀번호 재설정/);
});

test('감사 상세는 PII·토큰을 담지 않고, 요청 응답 문구는 계정 유무와 무관하다', () => {
  const d = resetAuditDetail({ email: 'hong@gowon.co.kr', delivered: 'log', found: true });
  assert.deepEqual(d, { email: 'ho***@gowon.co.kr', delivered: 'log', accountMatched: true });
  assert.match(RESET_REQUEST_RESPONSE, /등록되어 있으면/);
  const st = passwordResetStatus({});
  assert.deepEqual(st, { provider: 'log', canSend: false, ttlMin: 30 });
});

// ── 실제 소스 배선 ────────────────────────────────────────────────────────────

test('[실제 소스] 요청 라우트: rate limit·동일 응답·토큰 원문 미저장·미반환', () => {
  const src = read('src', 'app', 'api', 'auth', 'password-reset', 'request', 'route.ts');
  assert.ok(src.includes('enforceRateLimit('), 'rate limit 누락 — 계정 열거·메일 폭탄');
  assert.ok(src.includes('RESET_REQUEST_RESPONSE'), '응답 문구가 계정 유무에 따라 달라질 수 있다');
  assert.ok(src.includes('hashResetToken('), '토큰을 해시 없이 저장한다');
  assert.ok(!/ok\(\{[^}]*token/.test(src), '응답에 토큰을 돌려준다(메일 없이 재설정 가능 = 계정 탈취)');
  assert.ok(src.includes('createMailAdapter(process.env'), '어댑터가 env 를 보지 않는다');
  assert.ok(src.includes('auditSecurity('), '보안 감사로그 누락');
  const exportsFound = Array.from(src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(exportsFound, ['POST', 'dynamic'], 'route.ts 는 HTTP 메서드·설정 외 export 금지');
});

test('[실제 소스] 확인 라우트: 만료·사용 판정, 세션 전부 폐기, 토큰 소모', () => {
  const src = read('src', 'app', 'api', 'auth', 'password-reset', 'confirm', 'route.ts');
  assert.ok(src.includes('evaluateResetToken('), '만료·사용 판정 누락');
  assert.ok(src.includes('validateNewPassword('), '새 비밀번호 검증 누락');
  assert.ok(/db\.delete\(sessions\)/.test(src), '비밀번호 변경 후 기존 세션을 폐기하지 않는다');
  assert.ok(/usedAt/.test(src), '토큰을 소모(usedAt) 하지 않는다 — 재사용 가능');
  assert.ok(src.includes('hashPassword('), '해시 없이 저장');
  const exportsFound = Array.from(src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(exportsFound, ['POST', 'dynamic']);
});

test('[실제 소스] 스키마·DDL·공개 경로·env 레지스트리 배선', () => {
  const schema = read('src', 'db', 'schema.ts');
  assert.ok(schema.includes("pgTable('password_reset_tokens'"), 'drizzle 선언 누락');
  const migrate = read('src', 'lib', 'migrate.ts');
  assert.ok(/CREATE TABLE IF NOT EXISTS password_reset_tokens/.test(migrate), '멱등 DDL 누락');
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_idx/.test(migrate), '해시 유니크 인덱스 누락');
  const scan = read('src', 'lib', 'tenantScan.ts');
  assert.ok(scan.includes("'password_reset_tokens'"), '사용자 스코프 테이블은 tenantScan GLOBAL_TABLES 에 선언해야 한다');
  const site = read('src', 'lib', 'siteMeta.ts');
  assert.ok(site.includes("'/reset-password'"), '공개 경로 등록 누락(siteMeta)');
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'app', 'reset-password', 'page.tsx')), '재설정 화면 없음');
  const login = read('src', 'app', 'login', 'page.tsx');
  assert.ok(login.includes('/reset-password'), '로그인 화면에 재설정 링크가 없다');
  const env = read('src', 'lib', 'envRegistry.ts');
  assert.ok(env.includes("key: 'MAIL_PROVIDER'") && env.includes("key: 'PASSWORD_RESET_TTL_MIN'"), 'env 레지스트리 누락');
});
