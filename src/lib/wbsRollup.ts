// WBS 상위 작업 롤업 — 순수 모듈(DB·next 의존 없음). 2026-10-26 PMS 개편 P0-3.
//
// 업무 목록(parentId 트리)만 보고 상위 작업마다 다음을 계산한다. 저장값은 바꾸지 않는다(화면 표시·점검용).
//   rollup    : 하위 진척률 가중 평균 — 계획 공수가 있으면 공수 가중, 없으면 동일 가중. 손자까지 재귀로 올린다.
//   span      : 하위 작업들의 가장 이른 시작 ~ 가장 늦은 종료
//   issues    : 점검 결과
//     DONE_OPEN   상위가 완료인데 미완료 하위가 있음
//     OVER_END    하위 종료일이 상위 종료일보다 늦음
//     EARLY_START 하위 시작일이 상위 시작일보다 이름
//     DRIFT       상위 진척률이 롤업과 15%p 이상 차이
//   순환(parentId 고리)은 끊고 해당 작업에 CYCLE 을 단다.

export type WbsIssue = 'DONE_OPEN' | 'OVER_END' | 'EARLY_START' | 'DRIFT' | 'CYCLE';
export const WBS_ISSUE_LABEL: Record<WbsIssue, string> = {
  DONE_OPEN: '하위 미완료',
  OVER_END: '하위가 마감 초과',
  EARLY_START: '하위가 먼저 시작',
  DRIFT: '진척 불일치',
  CYCLE: '상위 지정 순환',
};
export const DRIFT_PP = 15;

export type WbsRoll = {
  id: number; children: number; leaves: number; doneLeaves: number;
  rollup: number; weight: number; spanStart: string; spanEnd: string; issues: WbsIssue[];
};

type Row = Record<string, any>;
const s = (v: unknown) => (v == null ? '' : String(v).trim());
const ymd = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v)); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
const pg = (t: Row) => (s(t.status) === 'done' ? 100 : Math.max(0, Math.min(100, Number(t.progress) || 0)));

/** 상위 작업(하위가 1건 이상)마다 롤업. 키는 업무 id. */
export function wbsRollup(rows: Row[]): Map<number, WbsRoll> {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(Number(r.id)));
  const byId = new Map<number, Row>(list.map((r) => [Number(r.id), r]));
  const kids = new Map<number, number[]>();
  const cyc = new Set<number>();
  for (const r of list) {
    const id = Number(r.id), p = Number(r.parentId);
    if (!r.parentId || !byId.has(p) || p === id) { if (p === id) cyc.add(id); continue; }
    // 고리 검사: 위로 따라가다 자기 자신을 만나면 순환
    let cur = p, hops = 0, loop = false;
    while (byId.has(cur) && hops++ < list.length) {
      if (cur === id) { loop = true; break; }
      const up = Number(byId.get(cur)!.parentId); if (!byId.get(cur)!.parentId || !byId.has(up)) break; cur = up;
    }
    if (loop) { cyc.add(id); continue; }
    (kids.get(p) || kids.set(p, []).get(p)!).push(id);
  }

  const out = new Map<number, WbsRoll>();
  const memo = new Map<number, { pv: number; w: number; leaves: number; done: number; st: string; en: string }>();
  const walk = (id: number, depth = 0): { pv: number; w: number; leaves: number; done: number; st: string; en: string } => {
    if (memo.has(id)) return memo.get(id)!;
    const t = byId.get(id)!; const ch = kids.get(id) || [];
    const ownW = Math.max(0, Number(t.plannedHours) || 0);
    if (!ch.length || depth > list.length) {
      const r = { pv: pg(t), w: ownW, leaves: 1, done: s(t.status) === 'done' ? 1 : 0, st: ymd(t.startDate), en: ymd(t.endDate) };
      memo.set(id, r); return r;
    }
    const subs = ch.map((c) => walk(c, depth + 1));
    const useHours = subs.some((x) => x.w > 0);
    let num = 0, den = 0, leaves = 0, done = 0, st = '', en = '';
    for (const x of subs) {
      const w = useHours ? x.w : 1; num += x.pv * w; den += w; leaves += x.leaves; done += x.done;
      if (x.st && (!st || x.st < st)) st = x.st; if (x.en && (!en || x.en > en)) en = x.en;
    }
    const rollup = den > 0 ? Math.round(num / den) : 0;
    const weight = useHours ? subs.reduce((n, x) => n + x.w, 0) : ownW;
    const issues: WbsIssue[] = [];
    if (s(t.status) === 'done' && done < leaves) issues.push('DONE_OPEN');
    const pe = ymd(t.endDate), ps = ymd(t.startDate);
    if (pe && en && en > pe) issues.push('OVER_END');
    if (ps && st && st < ps) issues.push('EARLY_START');
    if (Math.abs(pg(t) - rollup) >= DRIFT_PP) issues.push('DRIFT');
    if (cyc.has(id)) issues.push('CYCLE');
    out.set(id, { id, children: ch.length, leaves, doneLeaves: done, rollup, weight, spanStart: st, spanEnd: en, issues });
    const r = { pv: rollup, w: weight, leaves, done, st: st || ps, en: en || pe };
    memo.set(id, r); return r;
  };
  for (const id of kids.keys()) walk(id);
  for (const id of cyc) if (!out.has(id)) out.set(id, { id, children: 0, leaves: 1, doneLeaves: 0, rollup: pg(byId.get(id)!), weight: 0, spanStart: '', spanEnd: '', issues: ['CYCLE'] });
  return out;
}

/** 표 칸에 띄울 설명 한 줄. */
export function describeRoll(r: WbsRoll, own: number): string {
  const parts = [`하위 ${r.children}건(말단 ${r.leaves}건 중 완료 ${r.doneLeaves}) 롤업 ${r.rollup}%`, `저장값 ${own}%`];
  if (r.spanStart || r.spanEnd) parts.push(`하위 일정 ${r.spanStart || '?'} ~ ${r.spanEnd || '?'}`);
  for (const i of r.issues) parts.push('⚠ ' + WBS_ISSUE_LABEL[i]);
  return parts.join(' · ');
}
