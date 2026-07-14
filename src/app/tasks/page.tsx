'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';
import { Kanban, Gantt, CalendarView } from '@/components/views';

type T = { code: string; name: string; status: string; progress: number };

export default function Page() {
  // 선행 작업(predecessor) 정합성 판정을 위해 같은 프로젝트의 업무를 코드로 색인한다(읽기 전용 보조 fetch)
  const [byCode, setByCode] = useState<Record<string, T>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/tasks?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ts: any[]) => {
        if (!Array.isArray(ts)) return;
        const m: Record<string, T> = {};
        for (const t of ts) {
          const c = String(t?.code || '').trim();
          if (c) m[c] = { code: c, name: String(t?.name || ''), status: String(t?.status || 'todo'), progress: Number(t?.progress) || 0 };
        }
        setByCode(m);
      })
      .catch(() => {});
  }, []);

  const DAY = 86400000;
  const midnight = (v: any): number | null => { const d = new Date(v); if (isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d.getTime(); };
  const STLABEL: Record<string, string> = { todo: '할 일', doing: '진행중', done: '완료' };

  return <ResourceView title="업무 (WBS)" subtitle="작업을 분해하고 진척을 관리합니다." endpoint="/api/tasks" projectScoped entity="tasks" treeKey="parentId"
    emptyText="등록된 업무가 없습니다. “새로 만들기”로 작업을 분해하거나, 타임라인(간트)에서 빈 행을 드래그해 만들 수 있습니다."
    altViews={[
      { key: 'board', label: '보드', render: (rows, openDetail) => (
        <Kanban rows={rows} openDetail={openDetail} titleKey="name" columns={[
          { key: 'todo', label: '할 일', color: '#94a3b8' },
          { key: 'doing', label: '진행중', color: '#be5535' },
          { key: 'done', label: '완료', color: '#15a34a' },
        ]} />
      )},
      { key: 'gantt', label: '타임라인', render: (rows, openDetail, save, create) => <Gantt rows={rows} openDetail={openDetail} save={save} create={create} /> },
      { key: 'cal', label: '캘린더', render: (rows, openDetail) => <CalendarView rows={rows} dateKey="endDate" openDetail={openDetail} /> },
    ]}
    columns={[
      { key: 'code', label: '코드' },
      { key: 'name', label: '작업', strong: true },
      { key: 'phase', label: '단계', render: (v, row) => {
        if (String(v || '').trim()) return <span style={{ fontSize: 12 }}>{v}</span>;
        const st = String(row.status || 'todo');
        if (st === 'todo') return <span className="muted" style={{ fontSize: 11.5 }}>—</span>;
        return <span title="단계 미지정 — 간트 스와이레인·단계별 진척 집계에서 제외됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>미지정</span>;
      } },
      { key: 'predecessor', label: '선행', render: (v, row) => {
        const code = String(v || '').trim();
        if (!code) return <span className="muted" style={{ fontSize: 11.5 }}>—</span>;
        const st = String(row.status || 'todo');
        if (String(row.code || '').trim() === code) return <span title="자기 자신을 선행 작업으로 지정했습니다 — 선후행 순환이라 간트 의존선·임계경로 계산에서 무시됩니다" style={{ color: '#c0414f', fontWeight: 700, fontSize: 11.5, cursor: 'help' }}>⚠ 자기참조</span>;
        const indexed = Object.keys(byCode).length > 0;
        const pre = byCode[code];
        if (indexed && !pre) return <span title={`이 프로젝트에 코드 ${code} 인 업무가 없습니다 — 오타이거나 삭제된 작업이라 간트 의존선·임계경로에서 무시됩니다`} style={{ cursor: 'help', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11.5 }}>{code}</span>
          <span style={{ marginLeft: 6, color: '#d98a16', fontWeight: 700, fontSize: 11 }}>⚠ 없는 코드</span>
        </span>;
        const preDone = pre ? pre.status === 'done' : true;
        const violate = !!pre && !preDone && (st === 'doing' || st === 'done');
        const col = violate ? (st === 'done' ? '#c0414f' : '#d98a16') : undefined;
        const tip = pre
          ? `선행: ${pre.code} ${pre.name} (${STLABEL[pre.status] || pre.status} · 진척 ${pre.progress}%)`
            + (violate ? (st === 'done' ? ' — 선행이 완료되지 않았는데 이 작업은 완료 처리됐습니다(순서 위반)' : ' — 선행이 끝나기 전에 착수했습니다') : '')
          : `선행 작업 ${code}`;
        return <span title={tip} style={{ cursor: 'help', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11.5, color: col, fontWeight: col ? 700 : undefined }}>{code}</span>
          {!!pre && preDone && <span style={{ marginLeft: 5, color: '#2f8f5b', fontSize: 10.5 }}>✓</span>}
          {violate && <span style={{ marginLeft: 5, color: col, fontWeight: 700, fontSize: 11 }}>⚠ 선행 미완료</span>}
        </span>;
      } },
      { key: 'assignee', label: '담당', render: (v, row) => {
        if (String(v || '').trim()) return <span style={{ fontSize: 12 }}>{v}</span>;
        const st = String(row.status || 'todo');
        if (st === 'doing') return <span title="진행중인데 담당자가 없습니다 — 부하(리소스) 집계·마감 알림 대상에서 제외됩니다" style={{ color: '#c0414f', fontWeight: 700, fontSize: 11.5, cursor: 'help' }}>⚠ 미지정</span>;
        if (st === 'done') return <span className="muted" style={{ fontSize: 11.5 }}>미지정</span>;
        return <span title="담당자 미지정 — 배정 전 작업입니다(부하 집계 제외)" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>미지정</span>;
      } },
      { key: 'status', label: '상태', badge: true },
      { key: 'progress', label: '진척', render: (v, row) => {
        const pg = Math.max(0, Math.min(100, Number(v) || 0));
        const st = String(row.status || 'todo');
        // 상태 ↔ 진척률 모순 검사 (EVM의 EV·완료 집계가 상태와 어긋나는 원인)
        let warn: string | null = null; let wc = '#d98a16'; let wt = `진척 ${pg}%`;
        if (st === 'done' && pg < 100) { warn = '진척 미갱신'; wc = '#c0414f'; wt = `완료 상태인데 진척률이 ${pg}%입니다 — EVM(EV)·진척 평균이 실제보다 낮게 계산됩니다`; }
        else if (pg >= 100 && st !== 'done') { warn = '완료 처리 필요'; wt = '진척률 100%인데 상태가 완료가 아닙니다 — 완료 건수·주간보고 집계에서 빠집니다'; }
        else if (st === 'doing' && pg === 0) { warn = '미착수'; wt = '진행중으로 표시했지만 진척률이 0%입니다 — 실제 착수 여부를 확인하세요'; }
        const col = st === 'done' ? '#2f8f5b' : pg >= 50 ? '#be5535' : '#94a3b8';
        return <div className="row" style={{ gap: 8, whiteSpace: 'nowrap', cursor: 'help' }} title={wt}>
          <div className="bar"><i style={{ width: `${pg}%`, background: col }} /></div>
          <span className="muted" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{pg}%</span>
          {warn && <span style={{ color: wc, fontWeight: 700, fontSize: 11 }}>{wc === '#c0414f' ? '⚠ ' : ''}{warn}</span>}
        </div>;
      } },
      { key: 'actualHours', label: '공수', render: (_v, row) => {
        const p = Number(row.plannedHours) || 0; const a = Number(row.actualHours) || 0;
        const st = String(row.status || 'todo');
        if (!p && !a) return st === 'done'
          ? <span title="완료됐는데 실제 공수가 없습니다 — 원가(AC)·CPI 집계에서 제외됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>공수 미기록</span>
          : <span className="muted" title="계획·실제 공수 미입력">—</span>;
        const pg = Number(row.progress) || 0;
        const burn = p > 0 ? Math.round((a / p) * 100) : null;
        const over = p > 0 && a > p;
        const col = over ? '#c0414f' : burn != null && burn >= 80 ? '#d98a16' : '#2f8f5b';
        const gap = burn != null && pg > 0 ? burn - pg : null;
        const num = (n: number) => String(Math.round(n * 10) / 10);
        const tip = [p ? `계획 ${num(p)}h` : '계획 공수 미입력', `실제 ${num(a)}h`, burn != null ? `소진율 ${burn}%` : null,
          p > 0 ? (over ? `${num(a - p)}h 초과` : `잔여 ${num(p - a)}h`) : null,
          gap != null && Math.abs(gap) >= 20 ? (gap > 0 ? `진척 ${pg}%보다 공수 소진이 ${Math.round(gap)}%p 앞섬 — 효율 저하 주의` : `진척 ${pg}%이 공수 소진보다 ${Math.round(-gap)}%p 앞섬 — 효율 양호`) : null].filter(Boolean).join(' · ');
        return <div className="row" title={tip} style={{ gap: 8, cursor: 'help', whiteSpace: 'nowrap' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: over ? '#c0414f' : undefined, fontWeight: over ? 700 : undefined }}>{num(a)}<span className="muted">{` / ${p ? num(p) + 'h' : '—'}`}</span></span>
          {burn != null && <div className="bar" style={{ width: 44, minWidth: 44 }}><i style={{ width: `${Math.min(100, burn)}%`, background: col }} /></div>}
          {over && <span style={{ color: '#c0414f', fontWeight: 700, fontSize: 11 }}>⚠</span>}
        </div>;
      } },
      { key: 'endDate', label: '마감', render: (v, row) => {
        const st = String(row.status || 'todo');
        const done = st === 'done';
        const end = midnight(v);
        if (end == null) return done
          ? <span className="muted" style={{ fontSize: 11.5 }}>—</span>
          : <span title="미완료인데 마감일이 없습니다 — 지연 집계·마감 알림·간트 막대에서 제외됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>기한 없음</span>;
        const today = midnight(new Date()) as number;
        const diff = Math.round((end - today) / DAY);
        if (done) return <span className="muted" title={`마감 ${v} — 완료된 업무입니다`} style={{ fontSize: 11.5, cursor: 'help' }}>{v}</span>;
        const over = diff < 0;
        const col = over ? '#c0414f' : diff <= 7 ? '#d98a16' : undefined;
        const tip = over ? `${-diff}일 기한 초과 — 지연 업무입니다` : diff === 0 ? '오늘 마감' : `D-${diff} (${diff}일 남음)`;
        return <span title={tip} style={{ color: col, fontWeight: col ? 700 : undefined, cursor: 'help', whiteSpace: 'nowrap', fontSize: 11.5 }}>
          {v}
          {over ? <span style={{ marginLeft: 5 }}>⚠ {-diff}일 초과</span> : diff <= 7 ? <span style={{ marginLeft: 5 }}>{diff === 0 ? '오늘' : `D-${diff}`}</span> : null}
        </span>;
      } },
    ]}
    fields={[
      { key: 'name', label: '작업명', required: true },
      { key: 'phase', label: '단계', type: 'combo', half: true, options: ['착수', '요구사항 분석', '분석/설계', '설계', '구현/개발', '단위 테스트', '통합 테스트', '시스템 테스트', '이행/전개', '안정화', '검수', '운영/유지보수', '완료'], placeholder: '단계 선택/입력', hint: '단계를 지정해야 간트 스와이레인·단계별 진척 집계에 잡힙니다' },
      { key: 'assignee', label: '담당자', type: 'combo', optionsFrom: 'members', half: true, placeholder: '인력 선택/입력', hint: '담당자를 지정해야 부하(리소스) 뷰·마감 알림 대상이 됩니다' },
      { key: 'status', label: '상태', type: 'select', half: true, options: [{ value: 'todo', label: '할 일' }, { value: 'doing', label: '진행중' }, { value: 'done', label: '완료' }] },
      { key: 'progress', label: '진척률', type: 'select', numeric: true, half: true, hint: '완료 상태는 100%로 맞춰야 진척 평균·EVM(EV)이 정확합니다', options: [{ value: '0', label: '0%' }, { value: '10', label: '10%' }, { value: '20', label: '20%' }, { value: '30', label: '30%' }, { value: '40', label: '40%' }, { value: '50', label: '50%' }, { value: '60', label: '60%' }, { value: '70', label: '70%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }, { value: '100', label: '100%' }] },
      { key: 'startDate', label: '시작일', type: 'date', half: true },
      { key: 'endDate', label: '마감일', type: 'date', half: true, hint: '마감일이 없으면 지연 집계·마감 알림에서 제외됩니다' },
      { key: 'reqCode', label: '연계 요구사항', type: 'combo', options: [], placeholder: '예: REQ-0001', hint: '요구사항 코드를 입력하면 추적(RTM)에 연결됩니다' },
      { key: 'predecessor', label: '선행 작업', type: 'combo', options: [], placeholder: '예: WBS-0001', hint: '이 작업 전에 완료돼야 할 작업 코드 — 같은 프로젝트의 업무 코드와 정확히 일치해야 간트 의존선·임계경로에 반영됩니다' },
      { key: 'parentId', label: '상위 작업(WBS)', type: 'select', optionsFrom: 'tasks', numeric: true, half: true, placeholder: '없음(최상위)', hint: '상위 작업을 지정하면 1·1.1 번호와 들여쓰기로 계층 표시됩니다' },
      { key: 'plannedHours', label: '계획 공수(h)', type: 'number', numeric: true, half: true, placeholder: '예: 16' },
      { key: 'actualHours', label: '실제 공수(h)', type: 'number', numeric: true, half: true, placeholder: '예: 12', hint: '실적 시간을 입력하면 EVM의 AC·CPI가 계산됩니다' },
      { key: 'baselineStart', label: '기준선 시작(계획)', type: 'date', half: true, hint: '최초 계획 일정. 간트에서 현재 일정과 이중 막대로 비교됩니다' },
      { key: 'baselineEnd', label: '기준선 마감(계획)', type: 'date', half: true, hint: '입력하면 간트 막대 아래 옅은 기준선 막대가 표시됩니다' },
    ]} />;
}
