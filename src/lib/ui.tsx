'use client';
import { useEffect, useState } from 'react';
export const BADGE: Record<string, string> = {
  active:'p-green', approved:'p-green', done:'p-green', resolved:'p-green', closed:'p-gray', completed:'p-green',
  open:'p-blue', draft:'p-gray', planned:'p-gray', todo:'p-gray', identified:'p-amber', review:'p-blue',
  in_progress:'p-blue', doing:'p-blue', mitigating:'p-amber', rejected:'p-red', archived:'p-gray',
  high:'p-red', medium:'p-amber', low:'p-green', critical:'p-red', urgent:'p-red',
  bug:'p-red', task:'p-blue', improvement:'p-cyan', support:'p-amber', change:'p-purple',
  dev:'p-blue', pl:'p-amber', pm:'p-cyan', pass:'p-green', fail:'p-red', blocked:'p-red', na:'p-gray',
  requested:'p-amber', ordered:'p-blue', received:'p-cyan', standby:'p-gray', retired:'p-gray',
};
export const LABEL: Record<string, string> = {
  active:'진행', approved:'승인', done:'완료', resolved:'해결', closed:'종료', completed:'완료',
  open:'열림', draft:'작성중', planned:'계획', todo:'할 일', identified:'식별', review:'결재요청',
  in_progress:'진행중', doing:'진행중', mitigating:'대응중', rejected:'반려', archived:'보관',
  high:'높음', medium:'보통', low:'낮음', critical:'긴급', urgent:'긴급',
  bug:'결함', task:'태스크', improvement:'기능개선', support:'지원', change:'변경요청',
  dev:'개발자검증', pl:'PL검증', pm:'PM승인', pass:'통과', fail:'실패', blocked:'블록', na:'미실행',
  requested:'요청', ordered:'발주', received:'입고', standby:'예비', retired:'폐기',
};
export const badge = (v: any) => BADGE[String(v)] || 'p-gray';
export function Pill({ v }: { v: any }) {
  if (v == null || v === '') return <span className="muted">—</span>;
  return <span className={`pill ${badge(v)}`}>{LABEL[String(v)] || String(v)}</span>;
}
export function useProjects(): [any[], number | null, (id: number) => void] {
  const [list, setList] = useState<any[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/projects').then((r) => r.ok ? r.json() : []).then((d) => {
      const arr = Array.isArray(d) ? d : []; setList(arr);
      const saved = Number(localStorage.getItem('pms.project')) || (arr[0]?.id ?? null); setPid(saved);
    });
  }, []);
  const set = (id: number) => { setPid(id); localStorage.setItem('pms.project', String(id)); };
  return [list, pid, set];
}
