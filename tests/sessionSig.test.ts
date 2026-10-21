// 세션 쿠키 서명(외부 오픈 관문 I-2, 2026-10-21) — 위조 쿠키가 미들웨어를 통과하지 못하는지 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signToken, verifyCookie, secretUsable, SECRET_MIN } from '../src/lib/sessionSig.ts';

const SECRET = 'x'.repeat(SECRET_MIN);
const TOKEN = 'ab'.repeat(32); // createSession 과 같은 64자 hex

test('비밀값 없으면 현행 그대로: 서명하지 않고, 값이 있기만 하면 통과', async () => {
  assert.equal(await signToken(TOKEN, undefined), TOKEN);
  assert.equal(await verifyCookie(TOKEN, undefined), TOKEN);
  assert.equal(await verifyCookie('아무값', undefined), '아무값');
  assert.equal(await verifyCookie(undefined, undefined), null);
  assert.equal(await verifyCookie('', undefined), null);
});

test('32자 미만 비밀값은 "꺼짐" 으로 본다(무력한 서명 방지)', async () => {
  assert.equal(secretUsable('short'), false);
  assert.equal(secretUsable(SECRET), true);
  assert.equal(await signToken(TOKEN, 'short'), TOKEN);
});

test('서명 → 검증 왕복: 원래 토큰이 돌아온다', async () => {
  const v = await signToken(TOKEN, SECRET);
  assert.match(v, /^[0-9a-f]{64}\.[0-9a-f]{64}$/);
  assert.equal(await verifyCookie(v, SECRET), TOKEN);
});

test('위조 차단: 서명 없는 값·임의 서명·다른 비밀값·토큰 바꿔치기·형식 오류', async () => {
  const v = await signToken(TOKEN, SECRET);
  assert.equal(await verifyCookie(TOKEN, SECRET), null, '서명 없는 옛 쿠키');
  assert.equal(await verifyCookie(`${TOKEN}.${'0'.repeat(64)}`, SECRET), null, '임의 서명');
  assert.equal(await verifyCookie(v, 'y'.repeat(SECRET_MIN)), null, '다른 비밀값');
  const other = 'cd'.repeat(32);
  assert.equal(await verifyCookie(`${other}.${v.split('.')[1]}`, SECRET), null, '서명은 그대로 두고 토큰만 바꿈');
  assert.equal(await verifyCookie(`${v}x`, SECRET), null, '서명 길이 오류');
  assert.equal(await verifyCookie('.abc', SECRET), null, '토큰 없음');
  assert.equal(await verifyCookie('아무값', SECRET), null, '점 없음');
});

test('연결 확인: 미들웨어·auth 가 쿠키를 서명 검증 함수로만 읽는다', () => {
  const src = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
  const mw = src('src/middleware.ts');
  assert.match(mw, /verifyCookie\(req\.cookies\.get\(COOKIE\)\?\.value, process\.env\.SESSION_SECRET\)/, '미들웨어 게이트가 서명 검증을 쓴다');
  assert.doesNotMatch(mw, /!req\.cookies\.get\(COOKIE\)\)/, '쿠키 존재만 보는 옛 조건이 남아 있지 않다');
  const auth = src('src/lib/auth.ts');
  assert.match(auth, /signToken\(token, process\.env\.SESSION_SECRET\)/, '발급 때 서명한다');
  assert.equal((auth.match(/verifyCookie\(cookies\(\)\.get\(COOKIE\)\?\.value, process\.env\.SESSION_SECRET\)/g) || []).length, 2, '조회·삭제 두 곳 모두 검증 후 토큰을 쓴다');
  assert.doesNotMatch(auth, /=\s*cookies\(\)\.get\(COOKIE\)\?\.value;/, '쿠키 값을 그대로 토큰으로 쓰는 곳이 없다');
});
