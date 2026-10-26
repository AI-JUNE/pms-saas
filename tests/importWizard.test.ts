/**
 * importWizard.test.ts — 공통 가져오기 마법사(엑셀·CSV·붙여넣기 → 검사 → 등록 본문). 2026-10-26 PMS 개편 P0-2
 * 순수 함수 + 소스 확인 — 네트워크·DB 미사용. .xlsx 는 시험 안에서 ZIP 을 직접 만들어 읽는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  detectDelimiter, parseDelimited, parseHtmlTable, colIndex, parseSharedStrings, parseSheetXml, readXlsx, decodeXml,
  autoMap, coerce, buildRows, guessHeaderRow, normDate, excelSerialToYmd, importable, MAX_ROWS, type ImportField,
} from '../src/lib/importWizard.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const inflateRaw = async (d: Uint8Array) => new Uint8Array(zlib.inflateRawSync(d));

const FIELDS: ImportField[] = [
  { key: 'title', label: '제목', required: true },
  { key: 'type', label: '유형(트래커)', type: 'select', options: [{ value: 'bug', label: '결함' }, { value: 'task', label: '태스크' }] },
  { key: 'priority', label: '우선순위', type: 'select', options: ['high', 'medium', 'low'] },
  { key: 'assignee', label: '담당자', type: 'combo' },
  { key: 'dueDate', label: '마감일', type: 'date' },
  { key: 'progress', label: '진척률', type: 'select', numeric: true, options: [{ value: '0', label: '0%' }, { value: '50', label: '50%' }, { value: '100', label: '100%' }] },
  { key: 'plannedHours', label: '계획 공수', type: 'number' },
  { key: 'parentId', label: '상위 작업', type: 'select', optionsFrom: 'tasks', numeric: true },
];

/** 최소 ZIP(저장 방식: 압축 8 = deflate) 만들기 */
function makeZip(files: Record<string, string>): Uint8Array {
  const local: Buffer[] = []; const central: Buffer[] = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = Buffer.from(name); const raw = Buffer.from(text); const comp = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    local.push(lh, nb, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...local, cd, end]));
}

test('구분자 추정과 CSV 따옴표·줄바꿈', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('abc'), ',');
  const t = parseDelimited('﻿제목,설명\r\n"쉼표, 포함","두 줄\n설명"\n"따옴표 ""안""",\n\n');
  assert.deepEqual(t, [['제목', '설명'], ['쉼표, 포함', '두 줄\n설명'], ['따옴표 "안"', '']]);
});

test('이 앱이 내보낸 엑셀(HTML 표)도 읽는다', () => {
  const t = parseHtmlTable('<table><tr><th style="x">제목</th><th>담당자</th></tr><tr><td>A &amp; B</td><td>김<br>PM</td></tr></table>');
  assert.deepEqual(t, [['제목', '담당자'], ['A & B', '김\nPM']]);
  assert.equal(decodeXml('&#x41;&#66;&lt;&unknown;'), 'AB<&unknown;');
});

test('열 번호·공유 문자열·시트 XML(빈 칸 건너뜀·인라인 문자열·논리값)', () => {
  assert.equal(colIndex('A1'), 0); assert.equal(colIndex('Z9'), 25); assert.equal(colIndex('AA3'), 26); assert.equal(colIndex(''), -1);
  const ss = parseSharedStrings('<sst><si><t>제목</t></si><si><r><t>담</t></r><r><t xml:space="preserve">당자</t></r></si><si/></sst>');
  assert.deepEqual(ss, ['제목', '담당자', '']);
  const t = parseSheetXml('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>로그인 &amp; 권한</t></is></c><c r="B3" t="b"><v>1</v></c><c r="C3"><v>46321</v></c></row></sheetData>', ss);
  assert.deepEqual(t, [['제목', '', '담당자'], [], ['로그인 & 권한', 'TRUE', '46321']]);
});

test('.xlsx: 통합문서가 가리키는 첫 시트를 읽는다', async () => {
  const zip = makeZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="목록" sheetId="1" r:id="rId7"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Type="x" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>제목</t></si><si><t>결함</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<sheetData><row r="1"><c r="A1"><v>틀린 시트</v></c></row></sheetData>',
    'xl/worksheets/sheet2.xml': '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>유형</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>버튼 오류</t></is></c><c r="B2" t="s"><v>1</v></c></row></sheetData>',
  });
  assert.deepEqual(await readXlsx(zip, inflateRaw), [['제목', '유형'], ['버튼 오류', '결함']]);
  await assert.rejects(readXlsx(new Uint8Array(40), inflateRaw), /엑셀/);
});

test('머리글 자동 짝짓기: 라벨·괄호 무시·동의어, 같은 항목은 한 번만', () => {
  assert.deepEqual(importable(FIELDS).map((f) => f.key).includes('parentId'), false);
  assert.deepEqual(autoMap(['제목', '유형', '담당', '마감', '진척률(%)', '없는열', '제목', '상위 작업'], FIELDS),
    ['title', 'type', 'assignee', 'dueDate', 'progress', '', '', '']);
  assert.deepEqual(autoMap(['Title', 'PRIORITY', ' 계획공수 '], FIELDS), ['title', 'priority', 'plannedHours']);
});

test('값 변환: 선택지(값·라벨)·숫자·날짜·필수', () => {
  const f = (k: string) => FIELDS.find((x) => x.key === k)!;
  assert.deepEqual(coerce(f('type'), '결함'), { value: 'bug' });
  assert.deepEqual(coerce(f('type'), 'TASK'), { value: 'task' });
  assert.ok('error' in coerce(f('type'), '개선'));
  assert.deepEqual(coerce(f('progress'), '50 %'), { value: 50 });
  assert.deepEqual(coerce(f('plannedHours'), '1,200h'), { value: 1200 });
  assert.ok('error' in coerce(f('plannedHours'), '많음'));
  assert.deepEqual(coerce(f('dueDate'), '2026.10.5'), { value: '2026-10-05' });
  assert.deepEqual(coerce(f('dueDate'), '20261026'), { value: '2026-10-26' });
  assert.deepEqual(coerce(f('dueDate'), '2026년 10월 26일'), { value: '2026-10-26' });
  assert.ok('error' in coerce(f('dueDate'), '2026-02-30'));
  assert.ok('error' in coerce(f('title'), '  '));
  assert.deepEqual(coerce(f('assignee'), ''), { value: '' });
});

test('엑셀 날짜 일련번호', () => {
  assert.equal(excelSerialToYmd(46321), '2026-10-26');
  assert.equal(normDate('46321'), '2026-10-26');
  assert.equal(normDate('123'), null);
});

test('buildRows: 문제 행은 빼고 행 번호를 알려준다', () => {
  const table = [
    ['제목', '유형', '마감일', '계획 공수'],
    ['로그인 오류', '결함', '2026-10-30', '8'],
    ['', '', '', ''],
    ['', '태스크', '', ''],
    ['조회 느림', '개선', '2026/11/01', 'x'],
    ['보고서', '태스크', '', ''],
  ];
  const r = buildRows(table, autoMap(table[0], FIELDS), FIELDS);
  assert.deepEqual(r.bodies, [{ title: '로그인 오류', type: 'bug', dueDate: '2026-10-30', plannedHours: 8 }, { title: '보고서', type: 'task' }]);
  assert.deepEqual(r.rowNos, [2, 6]);
  assert.equal(r.skippedEmpty, 1);
  assert.deepEqual(r.problems.map((p) => [p.row, p.field]), [[4, '제목'], [5, '유형(트래커)'], [5, '계획 공수']]);
});

test('필수 항목에 짝지은 열이 없으면 아무 행도 만들지 않는다', () => {
  const r = buildRows([['담당자'], ['김']], ['assignee'], FIELDS);
  assert.equal(r.bodies.length, 0); assert.equal(r.problems[0].row, 0); assert.match(r.problems[0].msg, /필수/);
});

test('머리글 줄 추정과 행 수 상한', () => {
  const t = [['프로젝트 업무 목록'], ['작성 2026-10-26'], ['제목', '담당자', '마감일'], ['a', 'b', '']];
  assert.equal(guessHeaderRow(t, FIELDS), 2);
  const many = [['제목'], ...Array.from({ length: MAX_ROWS + 5 }, (_, i) => ['t' + i])];
  const r = buildRows(many, ['title'], FIELDS);
  assert.equal(r.bodies.length, MAX_ROWS); assert.match(r.problems.at(-1)!.msg, /나눠서/);
});

test('목록 공통 화면에 가져오기 마법사가 붙어 있다', () => {
  const v = fs.readFileSync(path.join(ROOT, 'src', 'components', 'ResourceView.tsx'), 'utf8');
  assert.match(v, /ImportWizard/);
  const w = fs.readFileSync(path.join(ROOT, 'src', 'components', 'ImportWizard.tsx'), 'utf8');
  assert.match(w, /DecompressionStream\('deflate-raw'\)/);
  assert.match(w, /buildRows\(/);
});
