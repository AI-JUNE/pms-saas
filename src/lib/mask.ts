// PII 마스킹 순수 모듈 — DB/next 의존 없음(단위테스트 가능)
// 감사로그·일반로그에 개인정보 원문을 남기지 않기 위한 유틸.
export function maskEmail(email: unknown): string {
  const s = String(email ?? '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return s ? '***' : '';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${head}***@${domain}`;
}
