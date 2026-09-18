import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LEGAL_DOC_KEYS, LEGAL_CONSENT_DDL, DRAFT_VERSION,
  parseDocVersion, parseEffectiveDate, legalFinalEnabled, consentRequired,
  legalDoc, legalDocs, draftNotice, docMetaLine,
  parseConsentInput, missingConsents, checkConsent, needsReconsent, pendingReconsent, legalStatus,
} from '../src/lib/legal.ts';

const SRC = path.join(process.cwd(), 'src');
const FINAL = {
  LEGAL_DOCS_FINAL: 'true',
  LEGAL_TERMS_VERSION: '1.0', LEGAL_TERMS_EFFECTIVE: '2026-10-01',
  LEGAL_PRIVACY_VERSION: '1.0', LEGAL_PRIVACY_EFFECTIVE: '2026-10-01',
};

test('기본은 초안 — 스위치가 없으면 모든 문서가 draft', () => {
  const docs = legalDocs({});
  assert.equal(docs.length, LEGAL_DOC_KEYS.length);
  for (const d of docs) {
    assert.equal(d.status, 'draft');
    assert.equal(d.version, DRAFT_VERSION);
    assert.equal(d.effectiveDate, '');
    assert.equal(d.required, true);
  }
  assert.equal(legalFinalEnabled({}), false);
  assert.equal(consentRequired({}), false);
  // 스위치만 켜고 버전·시행일이 없으면 여전히 draft(fail-safe)
  assert.equal(legalDoc('terms', { LEGAL_DOCS_FINAL: 'true' }).status, 'draft');
});

test('확정본 전환은 env 만으로 — 버전·시행일이 모두 유효할 때', () => {
  const t = legalDoc('terms', FINAL);
  assert.equal(t.status, 'final');
  assert.equal(t.version, '1.0');
  assert.equal(t.effectiveDate, '2026-10-01');
  // 시행일이 실존하지 않으면 확정되지 않는다
  assert.equal(legalDoc('terms', { ...FINAL, LEGAL_TERMS_EFFECTIVE: '2026-02-30' }).status, 'draft');
  // 문서별로 독립 — 약관만 확정, 방침은 초안
  const mixed = { ...FINAL, LEGAL_PRIVACY_VERSION: '' };
  assert.equal(legalDoc('terms', mixed).status, 'final');
  assert.equal(legalDoc('privacy', mixed).status, 'draft');
});

test('버전·시행일 파서는 형식 밖 입력을 거부', () => {
  assert.equal(parseDocVersion('1'), '1');
  assert.equal(parseDocVersion(' 2.1.3 '), '2.1.3');
  assert.equal(parseDocVersion('v1.0'), null);
  assert.equal(parseDocVersion('1.0.0.0'), null);
  assert.equal(parseDocVersion(''), null);
  assert.equal(parseDocVersion(1.0 as unknown), null);
  assert.equal(parseEffectiveDate('2026-10-01'), '2026-10-01');
  assert.equal(parseEffectiveDate('2026-13-01'), null);
  assert.equal(parseEffectiveDate('2026-2-01'), null);
  assert.equal(parseEffectiveDate(null), null);
});

test('초안 배너·메타 문구는 상태에서 파생 — 임의 날짜를 쓰지 않는다', () => {
  const draftDoc = legalDoc('privacy', {});
  assert.match(draftNotice(draftDoc)!, /초안/);
  assert.match(docMetaLine(draftDoc), /확정 전 \(초안\)/);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(docMetaLine(draftDoc)), '초안 메타에 날짜가 들어가면 안 된다');
  const finalDoc = legalDoc('privacy', FINAL);
  assert.equal(draftNotice(finalDoc), null);
  assert.match(docMetaLine(finalDoc), /시행일: 2026-10-01 · 버전 1\.0/);
  assert.match(docMetaLine(legalDoc('terms', FINAL)), /최종 개정: 2026-10-01/);
});

test('동의 입력 파싱 — 불리언 true 만 동의로 인정', () => {
  assert.deepEqual(parseConsentInput({ agree: { terms: true, privacy: true } }), ['terms', 'privacy']);
  assert.deepEqual(parseConsentInput({ agree: { terms: true } }), ['terms']);
  assert.deepEqual(parseConsentInput({ agree: { terms: 'true', privacy: 1 } }), []);
  assert.deepEqual(parseConsentInput({ consents: ['privacy', 'privacy', 'nope'] }), ['privacy']);
  assert.deepEqual(parseConsentInput(undefined), []);
  assert.deepEqual(parseConsentInput({ agree: null }), []);
  assert.deepEqual(missingConsents(['terms'], {}), ['privacy']);
  assert.deepEqual(missingConsents(['terms', 'privacy'], {}), []);
});

test('가입 동의는 기본 관측 모드 — 막지 않되 누락을 보고', () => {
  const off = checkConsent({}, {});
  assert.equal(off.ok, true);
  assert.equal(off.enforced, false);
  assert.deepEqual(off.missing, ['terms', 'privacy']);
  assert.deepEqual(off.snapshot, []);
  // 스위치 ON 이면 거절
  const on = checkConsent({}, { LEGAL_CONSENT_REQUIRED: 'true' });
  assert.equal(on.ok, false);
  assert.equal(on.enforced, true);
  assert.match(on.message!, /동의해야/);
  // 동의하면 통과하고 버전 스냅샷이 남는다(PII 없음)
  const okd = checkConsent({ agree: { terms: true, privacy: true } }, { ...FINAL, LEGAL_CONSENT_REQUIRED: 'true' });
  assert.equal(okd.ok, true);
  assert.deepEqual(okd.snapshot, [{ docKey: 'terms', version: '1.0' }, { docKey: 'privacy', version: '1.0' }]);
  assert.deepEqual(checkConsent({ agree: { terms: true, privacy: true } }, {}).snapshot,
    [{ docKey: 'terms', version: 'draft' }, { docKey: 'privacy', version: 'draft' }]);
});

test('재동의는 확정본에서만 — 초안 버전 변화로는 요구하지 않는다', () => {
  const finalTerms = legalDoc('terms', FINAL);
  assert.equal(needsReconsent(finalTerms, [{ docKey: 'terms', version: '1.0' }]), false);
  assert.equal(needsReconsent(finalTerms, [{ docKey: 'terms', version: '0.9' }]), true);
  assert.equal(needsReconsent(finalTerms, []), true);
  assert.equal(needsReconsent(finalTerms, [{ docKey: 'privacy', version: '1.0' }]), true);
  // 초안 상태면 어떤 이력이든 재동의 없음
  assert.equal(needsReconsent(legalDoc('terms', {}), []), false);
  assert.deepEqual(pendingReconsent([], {}), []);
  assert.deepEqual(pendingReconsent([{ docKey: 'terms', version: '1.0' }], FINAL), ['privacy']);
  assert.deepEqual(pendingReconsent([{ docKey: 'terms', version: '1.0' }, { docKey: 'privacy', version: '1.0' }], FINAL), []);
});

test('동의 이력 DDL 초안은 멱등이고 부팅 MIGRATION_DDL 에 섞이지 않았다', () => {
  for (const s of LEGAL_CONSENT_DDL) assert.match(s, /IF NOT EXISTS/);
  assert.ok(LEGAL_CONSENT_DDL.some((s) => /CREATE TABLE IF NOT EXISTS legal_consents/.test(s)));
  const migrate = fs.readFileSync(path.join(SRC, 'lib', 'migrate.ts'), 'utf8');
  assert.ok(!/legal_consents/.test(migrate), 'legal_consents DDL must not be wired into boot-time MIGRATION_DDL');
  const schema = fs.readFileSync(path.join(SRC, 'db', 'schema.ts'), 'utf8');
  assert.ok(!/legal_consents|legalConsents/.test(schema), 'schema.ts must not declare legal_consents before DDL is applied');
});

test('법적 문서 페이지가 문안 상태를 하드코딩하지 않고 레지스트리를 쓴다', () => {
  for (const f of ['terms', 'privacy']) {
    const src = fs.readFileSync(path.join(SRC, 'app', f, 'page.tsx'), 'utf8');
    assert.match(src, /@\/lib\/legal/, `${f} page must read status from lib/legal`);
    assert.ok(!/2026-00-00/.test(src), `${f} page must not hardcode a placeholder date`);
  }
});

test('legalStatus 요약은 문안·PII 없이 상태만 보고', () => {
  const off = legalStatus({});
  assert.equal(off.final, false);
  assert.equal(off.consentEnforced, false);
  assert.equal(off.ddlDraftStatements, LEGAL_CONSENT_DDL.length);
  assert.deepEqual(off.docs.map((d) => d.status), ['draft', 'draft']);
  const on = legalStatus({ ...FINAL, LEGAL_CONSENT_REQUIRED: 'true' });
  assert.equal(on.final, true);
  assert.equal(on.consentEnforced, true);
  assert.deepEqual(on.docs.map((d) => d.version), ['1.0', '1.0']);
  assert.ok(!JSON.stringify(on).includes('@'), '요약에 연락처가 들어가면 안 된다');
});
