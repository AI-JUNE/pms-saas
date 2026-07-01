'use client';
import { useEffect, useState } from 'react';
export const BADGE: Record<string, string> = {
  active:'p-green', approved:'p-green', done:'p-green', resolved:'p-green', closed:'p-gray', completed:'p-green',
  open:'p-blue', draft:'p-gray', planned:'p-gray', todo:'p-gray', identified:'p-amber', review:'p-blue',
  in_progress:'p-blue', doing:'p-blue', mitigating:'p-amber', rejected:'p-red', archived:'p-gray',
  high:'p-red', medium:'p-amber', low:'p-green', critical:'p-red', urgent:'p-red',
  bug:'p-red', task:'p-blue', improvement:'p-cyan',
};
export const badge = (v: any) => BADGE[String(v)] || 'p-gray';
export function Pill({ v }: { v: any }) {
  if (v == null || v === '') return <span className="muted">—</span>;
  return <span className={`pill ${badge(v)}`}>{String(v)}</span>;
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
