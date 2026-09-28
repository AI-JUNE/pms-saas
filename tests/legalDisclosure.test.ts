import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROCESSOR_ENV, TRANSFER_ENV, TRANSFER_FIELDS,
  parseProcessors, parseTransfers, disclosureConfig, publicProcessors,
  processorNotice, transferNotice, auditDisclosure, disclosureStatus,
  PENDING_PROCESSORS, PENDING_TRANSFERS,
} from '../src/lib/legalDisclosure.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const T = {
  name: '해외 클라우드 사업자', country: '미국', items: '이메일, 접속기록',
  purpose: '서비스 호스팅', retention: '위탁 종료 시까지', refusal: '고객센터로 요청',
};

test('미설정이면 목록이 비고, 페이지는 "위탁하지 않는다"고 말하지 않는다', () => {
  const cfg = disclosureConfig({});
  assert.deepEqual(cfg.processors, []);
  assert.deepEqual(cfg.transfers, []);
  assert.equal(processorNotice(cfg), PENDING_PROCESSORS);
  assert.equal(transferNotice(cfg), PENDING_TRANSFERS);
  // 사실이 아닐 수 있는 단정("위탁하지 않습니다"·"없습니다")을 쓰지 않는다
  for (const s of [PENDING_PROCESSORS, PENDING_TRANSFERS]) {
    assert.ok(!/위탁하지 않습니다|해당 없음|없습니다\./.test(s), `미고지 문구가 사실을 단정한다: ${s}`);
    assert.ok(/고지 전/.test(s));
  }
});

test('고지를 약속했는데 목록이 비면 promised_not_disclosed 로 잡는다', () => {
  const a = auditDisclosure(disclosureConfig({}), { promisesProcessors: true, promisesTransfers: true });
  assert.equal(a.ok, false);
  assert.deepEqual(a.issues.map((i) => i.code), ['promised_not_disclosed', 'promised_not_disclosed']);
  assert.deepEqual(a.issues.map((i) => i.section), ['processors', 'transfers']);
});

test('축약 표기 처리위탁 파싱 — 수탁자|위탁업무;…', () => {
  const { rows, issues } = parseProcessors('가나다|클라우드 호스팅; 라마바|결제대행 ');
  assert.deepEqual(issues, []);
  assert.deepEqual(rows, [
    { name: '가나다', purpose: '클라우드 호스팅' },
    { name: '라마바', purpose: '결제대행' },
  ]);
});

test('JSON 표기 처리위탁 파싱 + 연락처는 공개에서 제거된다', () => {
  const { rows } = parseProcessors(JSON.stringify([{ name: 'A사', purpose: '호스팅', contact: 'pii@example.com' }]));
  assert.equal(rows[0].contact, 'pii@example.com');
  const pub = publicProcessors(rows);
  assert.deepEqual(pub, [{ name: 'A사', purpose: '호스팅' }]);
  assert.ok(!JSON.stringify(pub).includes('pii@example.com'));
});

test('불완전·중복 처리위탁 행은 싣지 않고 사유를 보고한다', () => {
  const { rows, issues } = parseProcessors('A사|호스팅;B사|;A사|호스팅');
  assert.deepEqual(rows, [{ name: 'A사', purpose: '호스팅' }]);
  assert.deepEqual(issues.map((i) => i.code), ['incomplete_row', 'duplicate_row']);
});

test('깨진 JSON 은 조용히 비우지 않고 parse_error 로 보고한다', () => {
  assert.equal(parseProcessors('[{"name":').issues[0]?.code, 'parse_error');
  assert.equal(parseTransfers('{"name":"A"}').issues[0]?.code, 'parse_error');
});

test('국외이전은 법정 6항목이 모두 있어야 실린다(부분 고지 금지)', () => {
  const ok = parseTransfers(JSON.stringify([T]));
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.rows.length, 1);
  for (const f of TRANSFER_FIELDS) {
    const partial = { ...T, [f]: '' };
    const r = parseTransfers(JSON.stringify([partial]));
    assert.deepEqual(r.rows, [], `${f} 누락 행이 실렸다`);
    assert.equal(r.issues[0].code, 'incomplete_row');
    assert.ok(r.issues[0].message.includes(f));
  }
});

test('국외이전 중복은 1건만 남긴다', () => {
  const r = parseTransfers(JSON.stringify([T, { ...T, purpose: '다른 목적' }]));
  assert.equal(r.rows.length, 1);
  assert.equal(r.issues[0].code, 'duplicate_row');
});

test('설정이 갖춰지면 미고지 안내가 사라지고 audit 이 통과한다', () => {
  const env = { [PROCESSOR_ENV]: 'A사|호스팅', [TRANSFER_ENV]: JSON.stringify([T]) };
  const cfg = disclosureConfig(env);
  assert.equal(processorNotice(cfg), null);
  assert.equal(transferNotice(cfg), null);
  assert.equal(auditDisclosure(cfg, { promisesProcessors: true, promisesTransfers: true }).ok, true);
  assert.deepEqual(disclosureStatus(env), { processors: 1, transfers: 1, issues: 0, disclosed: true });
});

test('과도하게 긴 값은 잘라 레이아웃·로그를 보호한다', () => {
  const { rows } = parseProcessors(`${'가'.repeat(500)}|호스팅`);
  assert.equal(rows[0].name.length, 200);
});

test('모듈이 업체명·국가를 기본값으로 심지 않는다(사실확인은 사람 몫)', () => {
  const src = read('src/lib/legalDisclosure.ts');
  const body = src.replace(/^\s*\/\/.*$/gm, ''); // 주석 제외
  for (const vendor of ['Vercel', 'Neon', 'AWS', 'Amazon', 'Google', 'Cloudflare', 'Toss', '토스', 'Stripe', '아임포트']) {
    assert.ok(!body.includes(vendor), `업체명 리터럴이 코드에 박혀 있다: ${vendor}`);
  }
  assert.equal(disclosureStatus({}).disclosed, false);
});

test('처리방침 페이지가 수탁자·국외이전을 레지스트리에서만 렌더한다', () => {
  const page = read('src/app/privacy/page.tsx');
  assert.ok(page.includes('legalDisclosure'), '처리방침이 고지 레지스트리를 쓰지 않는다');
  assert.ok(page.includes('국외 이전'), '국외 이전 고지 절이 없다');
  // 배치170 과 같은 규칙: 페이지가 미고지 문구를 하드코딩하지 않는다
  assert.ok(!page.includes('고지 전입니다'), '미고지 문구가 페이지에 하드코딩되어 있다');
  // 「본 방침에 고지합니다」 약속만 남기고 목록이 없던 상태로 되돌아가지 않게 한다
  assert.ok(!/수탁자·위탁업무를 본 방침에 고지합니다/.test(page));
});

test('법적 문서 2종이 본문 랜드마크·목차를 갖춘다', () => {
  for (const rel of ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx']) {
    const s = read(rel);
    assert.ok(s.includes('id="main-content"'), `${rel}: 본문 랜드마크 없음`);
    assert.ok(s.includes('aria-label="문서 목차"'), `${rel}: 목차 없음`);
  }
});
