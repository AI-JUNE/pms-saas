'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban, CalendarView } from '@/components/views';

const DONE = ['resolved', 'closed'];
const num = (n: number) => String(Math.round(n * 10) / 10);
const lines = (v: any): string[] =>
  String(v || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*·•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

// 기한: 초과·임박 하이라이트(전 화면 공통 규칙) + 미해결인데 기한 미설정 경고
const dueCell = (v: any, row: any) => {
  const done = DONE.includes(String(row?.status));
  if (!v) {
    if (done) return <span className="muted">—</span>;
    return (
      <span title="미해결 이슈에 기한이 없습니다 — 마감 알림·지연 집계에서 제외됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>
        기한 없음
      </span>
    );
  }
  const t = new Date(String(v)).getTime();
  if (done || isNaN(t)) return <span className="muted" style={{ opacity: 0.72 }}>{String(v)}</span>;
  const now = Date.now();
  const dd = Math.ceil((t - now) / 86400000);
  const od = Math.floor((now - t) / 86400000);
  const col = t < now ? '#c0414f' : dd <= 7 ? '#d98a16' : undefined;
  const tip = col ? (t < now ? (od >= 1 ? `${od}일 기한 초과` : '오늘 기한') : dd <= 0 ? '오늘 기한' : `D-${dd}`) : undefined;
  return (
    <span title={tip} style={{ color: col, fontWeight: col ? 700 : undefined, cursor: tip ? 'help' : undefined, whiteSpace: 'nowrap' }}>
      {String(v)}
      {col === '#c0414f' ? ' ⚠' : ''}
    </span>
  );
};

// 설명(재현 정보): 결함인데 설명이 비면 재현·검증 불가 = 반려 1순위
const descCell = (_v: any, row: any) => {
  const ls = lines(row?.description);
  const isBug = String(row?.type) === 'bug';
  const status = String(row?.status || 'open');
  if (!ls.length) {
    if (isBug && status !== 'open')
      return (
        <span title="결함인데 설명(재현 절차·현상)이 비어 있습니다 — 재현·검증이 불가능합니다" style={{ color: '#c0414f', fontWeight: 700, fontSize: 11.5, cursor: 'help' }}>
          ⚠ 설명 없음
        </span>
      );
    if (DONE.includes(status))
      return (
        <span title="내용 없이 종결된 이슈입니다 — 조치 내역이 남지 않습니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>
          설명 없음
        </span>
      );
    return <span className="muted" style={{ fontSize: 11.5 }}>미작성</span>;
  }
  const tip = ls.slice(0, 8).map((l, i) => `${i + 1}. ${l}`).join('\n') + (ls.length > 8 ? `\n… 외 ${ls.length - 8}줄` : '');
  return (
    <div className="row" title={tip} style={{ gap: 6, cursor: 'help', maxWidth: 220, whiteSpace: 'nowrap' }}>
      <span className="label-chip" style={{ color: '#be5535', fontSize: 11 }}>{ls.length}줄</span>
      <span className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ls[0]}</span>
    </div>
  );
};

// 공수: 예상(estimateHours) 대비 실제(spentHours) 소진율 — 업무(tasks) 공수 셀과 동일 규칙
const hoursCell = (_v: any, row: any) => {
  const p = Number(row?.estimateHours) || 0;
  const a = Number(row?.spentHours) || 0;
  const status = String(row?.status || 'open');
  if (!p && !a) {
    if (DONE.includes(status))
      return (
        <span title="해결·종료된 이슈인데 실제 공수가 없습니다 — 공수 집계·원가(AC)에서 누락됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>
          공수 미기록
        </span>
      );
    return <span className="muted" title="예상·실제 공수 미입력" style={{ fontSize: 11.5 }}>—</span>;
  }
  const burn = p > 0 ? Math.round((a / p) * 100) : null;
  const over = p > 0 && a > p;
  const col = over ? '#c0414f' : burn != null && burn >= 80 ? '#d98a16' : '#2f8f5b';
  const tip = [
    p ? `예상 ${num(p)}h` : '예상 공수 미입력',
    `실제 ${num(a)}h`,
    burn != null ? `소진율 ${burn}%` : null,
    p > 0 ? (over ? `${num(a - p)}h 초과` : `잔여 ${num(p - a)}h`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="row" title={tip} style={{ gap: 8, cursor: 'help', whiteSpace: 'nowrap' }}>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: over ? '#c0414f' : undefined, fontWeight: over ? 700 : undefined }}>
        {num(a)}
        <span className="muted">{` / ${p ? num(p) + 'h' : '—'}`}</span>
      </span>
      {burn != null && (
        <div className="bar" style={{ width: 44, minWidth: 44 }}>
          <i style={{ width: `${Math.min(100, burn)}%`, background: col }} />
        </div>
      )}
      {over && <span style={{ color: '#c0414f', fontWeight: 700, fontSize: 11 }}>⚠</span>}
    </div>
  );
};

// 연계: 요구사항(reqCode)·관계 이슈(related) — 입력 필드는 있는데 목록에 전혀 보이지 않던 두 값
const linkCell = (_v: any, row: any) => {
  const req = String(row?.reqCode || '').trim();
  const rel = String(row?.related || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const type = String(row?.type);
  if (!req && !rel.length) {
    if (type === 'bug' || type === 'change')
      return (
        <span title="연계 요구사항이 없습니다 — RTM(요구사항 추적) 커버리지 집계에서 제외됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>
          ⚠ 미연계
        </span>
      );
    return <span className="muted" style={{ fontSize: 11.5 }}>—</span>;
  }
  const relTip = rel.length ? `관계 이슈 ${rel.join(' · ')}` : '';
  return (
    <div className="row" style={{ gap: 4, whiteSpace: 'nowrap' }}>
      {req && (
        <span className="label-chip" title={`연계 요구사항 ${req} — RTM에 추적됩니다`} style={{ color: '#be5535', fontFamily: 'ui-monospace,monospace', fontSize: 11, cursor: 'help' }}>
          {req}
        </span>
      )}
      {rel.slice(0, 2).map((r, i) => (
        <span key={i} className="label-chip" title={relTip} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, cursor: 'help' }}>
          {r}
        </span>
      ))}
      {rel.length > 2 && (
        <span className="muted" title={relTip} style={{ fontSize: 11, cursor: 'help' }}>
          외 {rel.length - 2}
        </span>
      )}
    </div>
  );
};

// 담당: 진행중인데 담당자가 없으면 아무도 손대지 않는 이슈
const assigneeCell = (v: any, row: any) => {
  const status = String(row?.status || 'open');
  if (!String(v || '').trim()) {
    if (status === 'in_progress')
      return (
        <span title="진행중인데 담당자가 지정되지 않았습니다" style={{ color: '#c0414f', fontWeight: 700, fontSize: 11.5, cursor: 'help' }}>
          ⚠ 미지정
        </span>
      );
    if (!DONE.includes(status))
      return (
        <span title="담당자 미지정 — 부하(리소스) 집계에서 제외됩니다" style={{ color: '#d98a16', fontSize: 11.5, cursor: 'help' }}>
          미지정
        </span>
      );
    return <span className="muted">—</span>;
  }
  return <span>{String(v)}</span>;
};

export default function Page() {
  return (
    <ResourceView
      title="이슈·결함"
      subtitle="이슈와 결함을 관리합니다."
      endpoint="/api/issues"
      projectScoped
      entity="issues"
      emptyText="등록된 이슈·결함이 없습니다. 상단에서 결함·기능개선·변경요청을 등록하세요."
      altViews={[
        {
          key: 'board',
          label: '보드',
          render: (rows, openDetail) => (
            <Kanban
              rows={rows}
              openDetail={openDetail}
              columns={[
                { key: 'open', label: '열림', color: '#3b5bfd' },
                { key: 'in_progress', label: '진행중', color: '#e08600' },
                { key: 'resolved', label: '해결', color: '#15a34a' },
                { key: 'closed', label: '종료', color: '#94a3b8' },
              ]}
            />
          ),
        },
        { key: 'cal', label: '캘린더', render: (rows, openDetail) => <CalendarView rows={rows} dateKey="dueDate" openDetail={openDetail} /> },
      ]}
      columns={[
        { key: 'code', label: '코드' },
        { key: 'title', label: '제목', strong: true },
        { key: 'issDesc', label: '설명', render: descCell },
        { key: 'type', label: '유형', badge: true },
        { key: 'priority', label: '우선순위', badge: true },
        { key: 'status', label: '상태', badge: true },
        { key: 'dueDate', label: '기한', render: dueCell },
        { key: 'issLink', label: '연계', render: linkCell },
        { key: 'epic', label: '에픽' },
        { key: 'storyPoints', label: 'SP' },
        { key: 'issHours', label: '공수(h)', render: hoursCell },
        {
          key: 'labels',
          label: '라벨',
          render: (v) =>
            v ? (
              String(v)
                .split(',')
                .map((l, i) => (
                  <span className="label-chip" key={i}>
                    {l.trim()}
                  </span>
                ))
            ) : (
              <span className="muted">—</span>
            ),
        },
        { key: 'assignee', label: '담당', render: assigneeCell },
      ]}
      fields={[
        { key: 'title', label: '제목', required: true },
        { key: 'description', label: '설명', type: 'textarea', hint: '결함이면 재현 절차·현상·기대결과를 한 줄에 하나씩 적어주세요' },
        {
          key: 'type',
          label: '유형(트래커)',
          type: 'select',
          options: [
            { value: 'bug', label: '결함' },
            { value: 'task', label: '태스크' },
            { value: 'improvement', label: '기능개선' },
            { value: 'support', label: '지원' },
            { value: 'change', label: '변경요청' },
          ],
          half: true,
        },
        { key: 'priority', label: '우선순위', type: 'select', options: ['critical', 'high', 'medium', 'low'], half: true },
        { key: 'status', label: '상태', type: 'select', options: ['open', 'in_progress', 'resolved', 'closed'], half: true },
        { key: 'assignee', label: '담당자', type: 'combo', optionsFrom: 'members', half: true, placeholder: '인력 선택/입력' },
        { key: 'dueDate', label: '기한', type: 'date', half: true },
        { key: 'storyPoints', label: '스토리포인트', type: 'number', half: true },
        { key: 'estimateHours', label: '예상공수(h)', type: 'number', half: true, placeholder: '예: 8', hint: '실제공수와 함께 목록에 소진율로 표시됩니다' },
        { key: 'spentHours', label: '실제공수(h)', type: 'number', half: true, placeholder: '예: 6' },
        { key: 'epic', label: '에픽', half: true },
        { key: 'labels', label: '라벨(쉼표구분)', half: true },
        { key: 'reqCode', label: '연계 요구사항', type: 'combo', options: [], placeholder: '예: REQ-0001', hint: '요구사항 코드를 입력하면 추적(RTM)에 연결됩니다' },
        { key: 'related', label: '관계 이슈(쉼표 코드)', type: 'combo', options: [], placeholder: '예: ISS-0002', hint: '연관·중복·차단 이슈 코드를 입력합니다' },
      ]}
    />
  );
}
