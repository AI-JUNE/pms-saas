// 공통 입력 검증(순수 모듈 · 외부 의존 없음 · Node --test 로 단위 테스트).
// 목적: 전 API에서 동일한 규칙으로 타입·길이·범위를 검사하고,
//       실패 시 표준 에러 응답(code=VALIDATION, fields[])에 쓸 구조를 돌려준다.
// 원칙: 방어적이되 관대하게 — 기존에 통과하던 정상 입력은 그대로 통과시키고,
//       명백히 잘못된 값(숫자 아님·날짜 아님·과도한 길이)만 차단한다.

export type FieldKind = 'text' | 'longtext' | 'int' | 'number' | 'percent' | 'date' | 'email';

export interface FieldRule {
  kind: FieldKind;
  /** 문자열 최대 길이(kind=text/longtext/email) */
  max?: number;
  /** 숫자 최소/최대(kind=int/number/percent) */
  min?: number;
  maxNum?: number;
}

export interface FieldError {
  field: string;
  code: 'TYPE' | 'LENGTH' | 'RANGE' | 'REQUIRED';
  message: string;
}

/** 기본 길이 한도 — DB varchar/text 폭주와 저장소 남용을 막는 상한. */
export const MAX_TEXT = 500;
export const MAX_LONGTEXT = 20000;
export const MAX_EMAIL = 254;

// 필드명 규약으로 종류를 추론한다(설정 파일 수정 없이 전 리소스에 일괄 적용).
const LONGTEXT = new Set([
  'description', 'content', 'steps', 'expected', 'agenda', 'decisions', 'actionItems',
  'mitigation', 'contingency', 'acceptanceCriteria', 'spec', 'note', 'reason',
  'attendees', 'goal', 'fields', 'labels', 'related', 'body', 'memo',
]);
const INT_FIELDS = new Set([
  'sortOrder', 'parentId', 'sprintId', 'pmUserId', 'qty', 'userId', 'projectId',
]);
const NUMBER_FIELDS = new Set([
  'budget', 'unitPrice', 'estimateHours', 'spentHours', 'plannedHours', 'actualHours',
  'plannedPct', 'actualPct', 'billingPct', 'amount', 'price', 'storyPoints',
]);
const PERCENT_FIELDS = new Set(['progress']);

/** 필드명 → 검증 규칙. 알 수 없는 필드는 짧은 텍스트로 취급한다. */
export function ruleFor(field: string): FieldRule {
  if (PERCENT_FIELDS.has(field)) return { kind: 'percent', min: 0, maxNum: 100 };
  if (INT_FIELDS.has(field)) return { kind: 'int' };
  if (NUMBER_FIELDS.has(field)) return { kind: 'number' };
  if (field === 'email') return { kind: 'email', max: MAX_EMAIL };
  if (LONGTEXT.has(field)) return { kind: 'longtext', max: MAX_LONGTEXT };
  if (/(^|[a-z])Date$|^date$|Start$|End$/.test(field)) return { kind: 'date' };
  return { kind: 'text', max: MAX_TEXT };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 'YYYY-MM-DD' 또는 파싱 가능한 ISO 문자열인지. */
export function isDateLike(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  if (v.length > 40) return false;
  return !Number.isNaN(Date.parse(v));
}

/** 숫자 또는 숫자 형태 문자열인지. */
export function isNumberLike(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

/** 값 1건 검증. 통과하면 null. */
export function validateOne(field: string, value: unknown, rule: FieldRule = ruleFor(field)): FieldError | null {
  // null·undefined·빈 문자열은 "비움"으로 보고 통과시킨다(필수 여부는 required가 따로 검사).
  if (value === null || value === undefined || value === '') return null;

  switch (rule.kind) {
    case 'text':
    case 'longtext': {
      if (typeof value === 'number' || typeof value === 'boolean') return null;
      if (typeof value !== 'string') {
        return { field, code: 'TYPE', message: `${field}: 문자열이어야 합니다` };
      }
      const max = rule.max ?? MAX_TEXT;
      if (value.length > max) {
        return { field, code: 'LENGTH', message: `${field}: 최대 ${max}자까지 입력할 수 있습니다` };
      }
      return null;
    }
    case 'email': {
      if (typeof value !== 'string') return { field, code: 'TYPE', message: `${field}: 문자열이어야 합니다` };
      if (value.length > (rule.max ?? MAX_EMAIL)) {
        return { field, code: 'LENGTH', message: `${field}: 최대 ${rule.max ?? MAX_EMAIL}자까지 입력할 수 있습니다` };
      }
      if (!EMAIL_RE.test(value)) return { field, code: 'TYPE', message: `${field}: 이메일 형식이 올바르지 않습니다` };
      return null;
    }
    case 'int':
    case 'number':
    case 'percent': {
      if (!isNumberLike(value)) return { field, code: 'TYPE', message: `${field}: 숫자를 입력하세요` };
      const n = Number(value);
      if (rule.kind === 'int' && !Number.isInteger(n)) {
        return { field, code: 'TYPE', message: `${field}: 정수를 입력하세요` };
      }
      if (rule.min !== undefined && n < rule.min) {
        return { field, code: 'RANGE', message: `${field}: ${rule.min} 이상이어야 합니다` };
      }
      if (rule.maxNum !== undefined && n > rule.maxNum) {
        return { field, code: 'RANGE', message: `${field}: ${rule.maxNum} 이하여야 합니다` };
      }
      return null;
    }
    case 'date': {
      if (!isDateLike(value)) return { field, code: 'TYPE', message: `${field}: 날짜 형식이 올바르지 않습니다` };
      return null;
    }
    default:
      return null;
  }
}

/** 값 묶음 검증. 위반 목록을 반환(빈 배열이면 통과). */
export function validateValues(
  values: Record<string, unknown>,
  overrides?: Record<string, FieldRule>,
): FieldError[] {
  const errs: FieldError[] = [];
  for (const [field, value] of Object.entries(values)) {
    const rule = overrides?.[field] ?? ruleFor(field);
    const e = validateOne(field, value, rule);
    if (e) errs.push(e);
  }
  return errs;
}

/** 표준 에러 응답에 실을 요약 메시지(첫 위반 기준). */
export function summarizeErrors(errs: FieldError[]): string {
  if (!errs.length) return '';
  if (errs.length === 1) return errs[0].message;
  return `${errs[0].message} 외 ${errs.length - 1}건`;
}
