// 지연 삭제(되돌리기) 대기열 — 순수 모듈(DB·next·DOM 의존 없음). 2026-10-26 PMS 개편 P0-4.
//
// 목록에서 삭제를 누르면 행은 바로 숨기고, 실제 DELETE 는 delayMs(기본 7초) 뒤에 보낸다.
// 그 사이 되돌리기(undo)를 누르면 요청 자체를 보내지 않는다 — 서버·DB 는 아무것도 바뀌지 않는다.
// 화면을 떠나면(flush) 남은 건을 즉시 보낸다. 타이머는 주입받아 시험에서 시간을 돌릴 수 있게 한다.

export type UndoTimer = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
export type UndoEntry = { token: number; ids: number[]; label: string };

export const UNDO_MS = 7000;

export function createUndoQueue(run: (ids: number[]) => Promise<unknown> | unknown, opts: { delayMs?: number; timer?: UndoTimer } = {}) {
  const delay = Math.max(0, opts.delayMs ?? UNDO_MS);
  const timer: UndoTimer = opts.timer || { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as any) };
  const pending = new Map<number, { entry: UndoEntry; handle: unknown }>();
  let seq = 0;

  function fire(token: number) {
    const p = pending.get(token); if (!p) return;
    pending.delete(token);
    return run(p.entry.ids.slice());
  }

  return {
    /** 삭제 예약. 같은 id 가 이미 대기 중이면 빼고 넣는다(중복 DELETE 방지). 빈 목록이면 null. */
    schedule(ids: number[], label = ''): UndoEntry | null {
      const queued = new Set(Array.from(pending.values()).flatMap((p) => p.entry.ids));
      const list = Array.from(new Set(ids.filter((n) => Number.isFinite(n)))).filter((n) => !queued.has(n));
      if (!list.length) return null;
      const token = ++seq;
      const entry = { token, ids: list, label };
      pending.set(token, { entry, handle: timer.set(() => { fire(token); }, delay) });
      return entry;
    },
    /** 되돌리기 — 아직 보내지 않았으면 true. */
    undo(token: number): boolean {
      const p = pending.get(token); if (!p) return false;
      timer.clear(p.handle); pending.delete(token); return true;
    },
    /** 남은 예약을 지금 모두 보낸다(화면 이탈·언마운트). */
    flush(): Promise<unknown[]> {
      const tokens = Array.from(pending.keys());
      return Promise.all(tokens.map((t) => { timer.clear(pending.get(t)!.handle); return fire(t); }));
    },
    /** 대기 중인 id 전체. */
    pendingIds(): Set<number> { return new Set(Array.from(pending.values()).flatMap((p) => p.entry.ids)); },
    size(): number { return pending.size; },
  };
}

/** 열 너비 저장값 정리 — 숫자만, 60~800px. */
export function cleanWidths(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const x = Math.round(Number(n));
    if (k && Number.isFinite(x)) out[k] = Math.max(60, Math.min(800, x));
  }
  return out;
}
