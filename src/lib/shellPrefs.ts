// 화면 틀(Shell) 편의 — 순수 모듈(DB·next·DOM 의존 없음). 2026-10-26 PMS 개편 P0-5.
//
//   즐겨찾기 : 메뉴 화면 주소 목록(브라우저 저장, 최대 8개). 지금 보이는 메뉴에 있는 주소만 남긴다.
//   결재 대기 : 내가 결재자인 검토 단계 산출물 + 신청 단계 방화벽 요청.
//              결재자 칸은 이름 글자(text)라 앞뒤 공백만 무시하고 정확히 같을 때만 센다.

export const FAV_KEY = 'pms.favs';
export const FAV_MAX = 8;

/** 저장값(JSON 글자) → 즐겨찾기 주소 배열. allowed 가 있으면 그 안의 주소만. */
export function parseFavs(raw: unknown, allowed?: Iterable<string>): string[] {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const ok = allowed ? new Set(allowed) : null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !/^\/[a-z0-9\-/]*$/i.test(x) || x.includes('//')) continue;
    if (ok && !ok.has(x)) continue;
    if (!out.includes(x)) out.push(x);
    if (out.length >= FAV_MAX) break;
  }
  return out;
}

/** 넣거나 빼기. 이미 8개면 가장 오래된 것을 밀어낸다. */
export function toggleFav(list: string[], href: string): string[] {
  const cur = parseFavs(list);
  if (cur.includes(href)) return cur.filter((h) => h !== href);
  return [...cur, href].slice(-FAV_MAX);
}

type Row = Record<string, any>;
const nm = (v: unknown) => (v == null ? '' : String(v).trim());

export type Approval = { kind: 'document' | 'firewall'; id: number; code: string | null; title: string; href: string };

export function myApprovals(me: string, docs: Row[], fw: Row[]): Approval[] {
  const who = nm(me); if (!who) return [];
  const a = (Array.isArray(docs) ? docs : []).filter((d) => d && nm(d.status) === 'review' && nm(d.approver) === who)
    .map((d) => ({ kind: 'document' as const, id: Number(d.id), code: nm(d.code) || null, title: nm(d.title), href: '/documents' }));
  const b = (Array.isArray(fw) ? fw : []).filter((r) => r && nm(r.status) === 'requested' && nm(r.approver) === who)
    .map((r) => ({ kind: 'firewall' as const, id: Number(r.id), code: nm(r.code) || null, title: nm(r.title), href: '/firewall' }));
  return [...a, ...b];
}

/** 결재 대기 배지를 붙일 메뉴 주소별 건수. */
export function approvalBadges(list: Approval[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) out[x.href] = (out[x.href] || 0) + 1;
  return out;
}
