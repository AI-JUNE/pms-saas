// 비밀번호 재설정 — 토큰·만료·메일 어댑터 순수 모듈(DB·next 의존 없음, process.env 는 인자로만 받는다).
//
// ── 흐름 ────────────────────────────────────────────────────────────────────
//   1) 요청: 이메일 → (계정이 있으면) 무작위 토큰 발급 → **해시만** DB 에 저장 → 메일 어댑터로 발송
//   2) 확인: 토큰 + 새 비밀번호 → 해시로 조회 → 만료·사용 여부 판정 → 비밀번호 교체 + 토큰 소모 + 기존 세션 전부 폐기
//
// ── 원칙(build now, activate on approval) ───────────────────────────────────
//  · 메일 발송은 `MAIL_PROVIDER` 로만 켠다. **미설정 = log 스텁** — 실제로는 아무것도 보내지 않고
//    수신자(마스킹)·제목만 서버 로그에 남긴다. 토큰·링크는 로그에도 남기지 않는다(로그 열람 = 계정 탈취).
//  · 지원하지 않는 provider 값은 **발송한 척하지 않는다** — 'unsupported' 로 돌려 호출부가 「전송되지 않음」을 알린다.
//  · 응답은 계정 존재 여부를 드러내지 않는다(요청 응답 문구는 항상 같다 — 계정 열거 방지).
//  · 토큰은 원문을 저장하지 않는다(sha256). DB 가 유출돼도 토큰으로 로그인할 수 없다.
import crypto from 'crypto';

export const MAIL_PROVIDER_ENV = 'MAIL_PROVIDER';
export const RESET_TTL_ENV = 'PASSWORD_RESET_TTL_MIN';

/** 토큰 바이트 수(32 → base64url 43자). */
export const RESET_TOKEN_BYTES = 32;
/** 유효시간 기본값(분)과 허용 범위 — 짧으면 메일 지연에 걸리고, 길면 유출 창이 넓어진다. */
export const DEFAULT_RESET_TTL_MIN = 30;
export const MIN_RESET_TTL_MIN = 5;
export const MAX_RESET_TTL_MIN = 24 * 60;
/** 비밀번호 최소 길이(register 와 동일). */
export const MIN_PASSWORD_LEN = 8;

/** 요청 응답 문구 — 계정이 있든 없든 **항상 이 문장**이다. */
export const RESET_REQUEST_RESPONSE = '입력하신 이메일이 등록되어 있으면 비밀번호 재설정 안내를 보냈습니다. 메일함을 확인해 주세요.';

export type MailProviderKind = 'log' | 'unsupported';

export interface MailMessage { to: string; subject: string; text: string }
export interface MailResult {
  /** 실제 외부 발송이 일어났는가. log·unsupported 는 항상 false. */
  sent: boolean;
  /** 어디로 갔는가. */
  delivered: 'log' | 'none';
  provider: MailProviderKind;
  error?: string;
}
export interface MailAdapter {
  kind: MailProviderKind;
  /** 호출부 안내용 — 이 어댑터가 실제 메일을 보내는가. */
  canSend: boolean;
  send(msg: MailMessage): Promise<MailResult>;
}

type EnvLike = Record<string, string | undefined>;
type Logger = { info: (msg: string, fields?: Record<string, unknown>) => void; warn: (msg: string, fields?: Record<string, unknown>) => void };

/** `MAIL_PROVIDER` 해석. 미설정·공백·'log' → log 스텁. 그 외 값은 아직 배선된 구현이 없어 unsupported. */
export function mailProviderKind(env: EnvLike | null | undefined): MailProviderKind {
  const v = String(env?.[MAIL_PROVIDER_ENV] ?? '').trim().toLowerCase();
  if (!v || v === 'log') return 'log';
  return 'unsupported';
}

/** 이메일 마스킹(mask.ts 와 같은 규칙을 의존 없이 복제 — 로그에 원문을 남기지 않는다). */
export function maskRecipient(email: unknown): string {
  const s = String(email ?? '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return s ? '***' : '';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * 메일 어댑터 생성. log 스텁은 **본문을 기록하지 않는다**(재설정 링크가 들어 있다).
 * 지원하지 않는 provider 는 send 가 실패를 돌려주되 던지지 않는다 — 요청 응답은 동일하게 나가야 한다.
 */
export function createMailAdapter(env: EnvLike | null | undefined, logger: Logger = console): MailAdapter {
  const kind = mailProviderKind(env);
  if (kind === 'log') {
    return {
      kind,
      canSend: false,
      async send(msg) {
        logger.info('[mail:log] 발송 생략(MAIL_PROVIDER 미설정 — 스텁)', { to: maskRecipient(msg.to), subject: msg.subject });
        return { sent: false, delivered: 'log', provider: 'log' };
      },
    };
  }
  const raw = String(env?.[MAIL_PROVIDER_ENV] ?? '').trim();
  return {
    kind,
    canSend: false,
    async send(msg) {
      logger.warn('[mail] 지원하지 않는 MAIL_PROVIDER — 발송하지 않음', { provider: raw, to: maskRecipient(msg.to) });
      return { sent: false, delivered: 'none', provider: 'unsupported', error: `unsupported provider: ${raw}` };
    },
  };
}

/** 유효시간(분). env 가 정수이고 범위 안이면 그 값, 아니면 기본 30분. */
export function resetTtlMinutes(env: EnvLike | null | undefined): number {
  const raw = String(env?.[RESET_TTL_ENV] ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_RESET_TTL_MIN;
  const n = Number(raw);
  if (n < MIN_RESET_TTL_MIN || n > MAX_RESET_TTL_MIN) return DEFAULT_RESET_TTL_MIN;
  return n;
}

/** 무작위 토큰(base64url, 패딩 없음). */
export function generateResetToken(bytes: number = RESET_TOKEN_BYTES): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** 저장·조회용 해시(sha256 hex). 원문은 메일로만 나간다. */
export function hashResetToken(token: unknown): string {
  return crypto.createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

/** 토큰 모양 검사 — DB 조회 전에 쓰레기 입력을 거른다(base64url 32~64자). */
export function tokenLooksValid(token: unknown): boolean {
  const s = String(token ?? '');
  return /^[A-Za-z0-9_-]{32,64}$/.test(s);
}

export function resetExpiry(now: Date, ttlMin: number): Date {
  return new Date(now.getTime() + ttlMin * 60_000);
}

export interface ResetTokenRow { expiresAt: Date | string; usedAt?: Date | string | null }
export type ResetTokenVerdict = 'ok' | 'not_found' | 'expired' | 'used';

/** 조회된 토큰 행 판정. 행이 없으면 not_found. 사용됨이 만료보다 먼저다(재사용 시도는 그 자체로 신호). */
export function evaluateResetToken(row: ResetTokenRow | null | undefined, now: Date = new Date()): ResetTokenVerdict {
  if (!row) return 'not_found';
  if (row.usedAt) return 'used';
  const exp = new Date(row.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= now.getTime()) return 'expired';
  return 'ok';
}

/** 판정 → 사용자 문구(원인을 세세히 구분하지 않는다 — 토큰 탐색에 도움을 주지 않기 위해). */
export function verdictMessage(v: ResetTokenVerdict): string {
  if (v === 'ok') return '';
  if (v === 'expired') return '재설정 링크가 만료되었습니다. 다시 요청해 주세요.';
  return '재설정 링크가 유효하지 않습니다. 다시 요청해 주세요.';
}

/** 새 비밀번호 검증. 문제 없으면 null. */
export function validateNewPassword(pw: unknown): string | null {
  const s = String(pw ?? '');
  if (s.length < MIN_PASSWORD_LEN) return `비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다`;
  if (s.length > 256) return '비밀번호가 너무 깁니다';
  if (/^\s+$/.test(s)) return '비밀번호는 공백만으로 만들 수 없습니다';
  return null;
}

/** 이메일 형식(느슨). */
export function emailLooksValid(email: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

/** 재설정 메일 본문. origin 은 호출부가 요청 URL 에서 얻는다(SITE_URL 이 없을 때도 동작). */
export function buildResetMail(origin: string, to: string, token: string, ttlMin: number): MailMessage {
  const base = String(origin || '').replace(/\/+$/, '');
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: '[PMS] 비밀번호 재설정 안내',
    text: [
      '비밀번호 재설정을 요청하셨습니다.',
      `아래 링크는 ${ttlMin}분 동안만 유효합니다.`,
      link,
      '',
      '본인이 요청하지 않았다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다.',
    ].join('\n'),
  };
}

/** 보안 감사로그용 상세(PII·토큰 미포함). */
export function resetAuditDetail(input: { email: unknown; delivered: MailResult['delivered'] | 'skipped'; found: boolean }): Record<string, unknown> {
  return { email: maskRecipient(input.email), delivered: input.delivered, accountMatched: input.found };
}

/** 한눈 요약(운영 점검용). */
export function passwordResetStatus(env: EnvLike | null | undefined): { provider: MailProviderKind; canSend: boolean; ttlMin: number } {
  const kind = mailProviderKind(env);
  return { provider: kind, canSend: false, ttlMin: resetTtlMinutes(env) };
}
