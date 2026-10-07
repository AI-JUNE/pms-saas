/**
 * formRender.test.ts — 커스텀 산출물 양식 동적 폼(정의 파서·검증·빌더). 2026-10-07 (주간 수동, ROADMAP ⑩ 30 · ⑦ 80)
 * 파일만 읽는다 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIELD_TYPES, MAX_FIELDS, keyFor, normalizeDef, parseFieldDefs, serializeFieldDefs,
  addField, removeField, moveField, updateField, emptyValues, validateFormValues, parseFormValues, displayValue, summarizeEntry, formRenderStatus,
  type FormFieldDef,
} from '../src/lib/formRender.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const DEFS: FormFieldDef[] = [
  { key: 'reviewer', label: '검토자', type: 'text', required: true },
  { key: 'score', label: '점수', type: 'number', min: 0, max: 100 },
  { key: 'date', label: '검토일', type: 'date', required: true },
  { key: 'result', label: '결과', type: 'select', options: ['통과', '조건부', '반려'], required: true },
  { key: 'memo', label: '비고', type: 'textarea' },
  { key: 'confirmed', label: '확인', type: 'checkbox', required: true },
];

test('parseFieldDefs: 줄바꿈 텍스트(기존 데이터)는 전부 text 필드로, 빈 값은 empty', () => {
  const r = parseFieldDefs('검토자\n검토일\n\n결과');
  assert.equal(r.format, 'lines');
  assert.deepEqual(r.defs.map((d) => [d.key, d.label, d.type]), [['f1', '검토자', 'text'], ['f2', '검토일', 'text'], ['f3', '결과', 'text']]);
  assert.deepEqual(parseFieldDefs(''), { defs: [], format: 'empty', problems: [] });
  assert.deepEqual(parseFieldDefs(null), { defs: [], format: 'empty', problems: [] });
});

test('parseFieldDefs: JSON 배열은 타입·필수·선택지를 읽고, 모르는 타입·깨진 JSON 은 problems 로 보고한다', () => {
  const r = parseFieldDefs(serializeFieldDefs(DEFS));
  assert.equal(r.format, 'json'); assert.deepEqual(r.problems, []);
  assert.deepEqual(r.defs, DEFS);
  const bad = parseFieldDefs('[{"label":"a","type":"rating"},{"label":"b","type":"select"},{"type":"text"},{"label":"ok"}]');
  assert.equal(bad.defs.length, 1); assert.equal(bad.defs[0].type, 'text', '타입 생략은 text');
  assert.equal(bad.problems.length, 3);
  assert.match(bad.problems[0], /모르는 타입/); assert.match(bad.problems[1], /선택지가 없습니다/); assert.match(bad.problems[2], /라벨이 비었습니다/);
  assert.deepEqual(parseFieldDefs('[oops').problems, ['JSON 을 해석할 수 없습니다']);
  assert.deepEqual(parseFieldDefs('[1,2]').defs, []);
  // 키 충돌은 접미사로 풀고, 한글 라벨은 f{n} 키
  const dup = parseFieldDefs('[{"label":"Name"},{"label":"name"},{"label":"이름"}]');
  assert.deepEqual(dup.defs.map((d) => d.key), ['name', 'name_2', 'f3']);
  assert.equal(keyFor('검토 결과', 4), 'f5');
  assert.equal(keyFor('Review Result!', 0), 'review_result');
  assert.equal(keyFor('1abc', 0), 'abc');
});

test('normalizeDef: number 범위 역전·select 선택지 문자열 분해', () => {
  const used = new Set<string>();
  assert.match(String(normalizeDef({ label: 'n', type: 'number', min: 10, max: 1 }, 0, used).problem), /최소값/);
  const s = normalizeDef({ label: 's', type: 'select', options: 'a, b\nc,,a' }, 0, used);
  assert.deepEqual(s.def?.options, ['a', 'b', 'c']);
  assert.equal(normalizeDef('str', 0, used).problem, '1번 항목: 객체가 아닙니다');
  assert.ok(FIELD_TYPES.length === 6 && formRenderStatus().maxFields === MAX_FIELDS);
});

test('빌더 조작은 불변이고 상한·검증을 지킨다', () => {
  const a = addField(DEFS, { label: '첨부 여부', type: 'checkbox' });
  assert.equal(a.problem, null); assert.equal(a.defs.length, 7); assert.equal(DEFS.length, 6);
  assert.equal(a.defs[6].key, 'f7');
  const dupKey = addField(DEFS, { key: 'score', label: '점수2', type: 'number' });
  assert.equal(dupKey.defs[6].key, 'score_2', '키 충돌은 접미사로 해소');
  assert.match(String(addField(DEFS, { label: 'x', type: 'select' }).problem), /선택지/);
  const full = Array.from({ length: MAX_FIELDS }, (_, i) => ({ key: `k${i}`, label: `L${i}`, type: 'text' as const }));
  assert.match(String(addField(full, { label: 'one more' }).problem), /최대/);
  assert.equal(removeField(DEFS, 'memo').length, 5);
  assert.deepEqual(moveField(DEFS, 'score', -1).map((d) => d.key).slice(0, 2), ['score', 'reviewer']);
  assert.deepEqual(moveField(DEFS, 'reviewer', -1).map((d) => d.key), DEFS.map((d) => d.key), '맨 위는 그대로');
  assert.deepEqual(moveField(DEFS, 'confirmed', 1).map((d) => d.key), DEFS.map((d) => d.key), '맨 아래는 그대로');
  const u = updateField(DEFS, 'score', { label: '점수(100점)', max: 50 });
  assert.equal(u.problem, null); assert.equal(u.defs[1].label, '점수(100점)'); assert.equal(u.defs[1].max, 50); assert.equal(u.defs[1].key, 'score');
  assert.match(String(updateField(DEFS, 'nope', { label: 'x' }).problem), /찾을 수 없습니다/);
  assert.match(String(updateField(DEFS, 'score', { min: 100, max: 1 }).problem), /최소값/);
});

test('validateFormValues: 타입별 검증·정규화, 정의 밖 키는 버린다', () => {
  const r = validateFormValues(DEFS, { reviewer: ' 홍길동 ', score: '1,234', date: '2026-10-07', result: '통과', memo: 'ok  ', confirmed: 'true', extra: 'drop' });
  assert.equal(r.ok, false, '점수 1234 는 max 100 초과');
  assert.deepEqual(r.errors.map((e) => e.code), ['RANGE']);
  assert.equal(r.values.reviewer, '홍길동'); assert.equal(r.values.score, 1234); assert.equal(r.values.confirmed, true); assert.equal(r.values.memo, 'ok');
  assert.ok(!('extra' in r.values));
  const ok = validateFormValues(DEFS, { reviewer: 'a', score: '77', date: '2026-02-28', result: '반려', confirmed: true });
  assert.equal(ok.ok, true); assert.equal(ok.values.memo, null);
  const bad = validateFormValues(DEFS, { score: 'abc', date: '2026-02-30', result: '보류', confirmed: false });
  assert.deepEqual(bad.errors.map((e) => [e.field, e.code]), [['reviewer', 'REQUIRED'], ['score', 'TYPE'], ['date', 'FORMAT'], ['result', 'OPTION'], ['confirmed', 'REQUIRED']]);
  assert.match(bad.errors[2].message, /^검토일: /, '오류 문구는 라벨로 시작한다');
  const empties = validateFormValues(DEFS, null);
  assert.equal(empties.ok, false); assert.equal(empties.values.score, null);
  assert.deepEqual(emptyValues(DEFS), { reviewer: '', score: '', date: '', result: '', memo: '', confirmed: false });
  const long = validateFormValues([{ key: 't', label: 'T', type: 'text' }], { t: 'x'.repeat(2001) });
  assert.equal(long.errors[0].code, 'LENGTH');
});

test('parseFormValues / displayValue / summarizeEntry', () => {
  assert.deepEqual(parseFormValues('{"a":1}'), { a: 1 });
  assert.deepEqual(parseFormValues('[1]'), {}); assert.deepEqual(parseFormValues('nope'), {}); assert.deepEqual(parseFormValues(''), {});
  assert.equal(displayValue(DEFS[1], 1234), '1,234'); assert.equal(displayValue(DEFS[5], true), '예'); assert.equal(displayValue(DEFS[5], null), '아니요'); assert.equal(displayValue(DEFS[0], null), '—');
  assert.equal(summarizeEntry(DEFS, { reviewer: '홍', score: 90, date: '2026-10-07', result: '통과' }), '검토자: 홍 · 점수: 90 · 검토일: 2026-10-07');
  assert.equal(summarizeEntry(DEFS, {}), '확인: 아니요', '체크박스는 값이 없어도 표시된다');
});

// ── 실제 소스 배선 ────────────────────────────────────────────────────────────

test('[실제 소스] 입력 라우트·스키마·DDL·화면 배선', () => {
  const src = read('src', 'app', 'api', 'form-definitions', '[id]', 'entries', 'route.ts');
  assert.ok(src.includes('parseFieldDefs(') && src.includes('validateFormValues('), '서버가 정의대로 값을 검증하지 않는다');
  assert.ok(src.includes('requirePermission('), '쓰기 권한(RBAC) 검사 누락');
  const ex = Array.from(src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(ex, ['GET', 'POST', 'dynamic'], 'route.ts 는 HTTP 메서드·설정 외 export 금지');
  assert.ok(read('src', 'db', 'schema.ts').includes("pgTable('form_entries'"), 'drizzle 선언 누락');
  assert.ok(/CREATE TABLE IF NOT EXISTS form_entries/.test(read('src', 'lib', 'migrate.ts')), '멱등 DDL 누락');
  const fill = read('src', 'components', 'FormFill.tsx');
  for (const t of FIELD_TYPES) assert.ok(fill.includes(`'${t}'`), `FormFill 이 타입 ${t} 를 렌더하지 않는다`);
  const builder = read('src', 'components', 'FormBuilder.tsx');
  assert.ok(builder.includes('addField(') && builder.includes('removeField(') && builder.includes('moveField('), '빌더 조작 누락');
  const rv = read('src', 'components', 'ResourceView.tsx');
  assert.ok(rv.includes('<FormBuilder ') && rv.includes('<FormFill '), '상세 패널에 빌더·입력 섹션이 없다');
  const page = read('src', 'app', 'form-definitions', 'page.tsx');
  assert.ok(page.includes('parseFieldDefs('), '목록 화면이 JSON 정의를 읽지 못한다(항목 수 표시가 깨진다)');
});
