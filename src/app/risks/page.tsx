'use client';
import { ResourceView } from '@/components/ResourceView';
import { RiskMatrix } from '@/components/views';

// 1~5 척도 한글 라벨 (발생가능성·영향도 공통)
const SCALE: Record<number, string> = { 1: '매우낮음', 2: '낮음', 3: '보통', 4: '높음', 5: '매우높음' };
// 노출도(발생×영향) 등급 임계값 — lib/crud.ts의 RISK_TRANSFORM과 동일 규칙(15↑ high · 8↑ medium)
const gradeOf = (s: number) => (s >= 15 ? { label: '높음', color: '#c0414f' } : s >= 8 ? { label: '보통', color: '#d98a16' } : { label: '낮음', color: '#2f8f5b' });
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : 0; };
// 텍스트영역을 줄 단위로 파싱(글머리표 제거)
const lines = (v: any) => String(v ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*·•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

// 1~5 척도 셀: 숫자 + 한글 라벨 툴팁
function scaleCell(v: any, kind: string) {
  const n = num(v);
  if (!n) return <span className="muted" title={`${kind} 미평가 — 상세에서 1~5 값을 입력하세요`} style={{ cursor: 'help' }}>—</span>;
  return <span title={`${kind} ${n}/5 — ${SCALE[n]}`} style={{ cursor: 'help', fontVariantNumeric: 'tabular-nums' }}>{n}<span className="muted" style={{ fontSize: 11 }}>/5</span></span>;
}

export default function Page() {
  return <ResourceView title="리스크" subtitle="리스크를 식별·평가합니다. 등급은 발생가능성×영향도로 자동 산정됩니다." endpoint="/api/risks" entity="risks" projectScoped
    altViews={[{ key: 'matrix', label: '매트릭스', render: (rows, openDetail) => <RiskMatrix rows={rows} openDetail={openDetail} /> }]}
    columns={[
      { key: 'code', label: '코드' },
      { key: 'title', label: '제목', strong: true },
      { key: 'probability', label: '발생', render: (v: any) => scaleCell(v, '발생가능성') },
      { key: 'impact', label: '영향', render: (v: any) => scaleCell(v, '영향도') },
      // 노출도 = 발생가능성 × 영향도 (1~25) — 등급의 산출 근거를 목록에서 바로 확인
      { key: 'exposure', label: '노출도', render: (_v: any, row: any) => {
        const p = num(row.probability), i = num(row.impact);
        if (!p || !i) return <span className="muted" title="발생가능성·영향도가 입력되지 않아 노출도를 산출할 수 없습니다" style={{ cursor: 'help' }}>미평가</span>;
        const s = p * i; const g = gradeOf(s); const closed = String(row.status) === 'closed';
        const tip = `발생가능성 ${p}(${SCALE[p]}) × 영향도 ${i}(${SCALE[i]}) = ${s}점 / 25점\n등급 ${g.label} — 15점↑ 높음 · 8점↑ 보통${closed ? '\n※ 종료된 리스크' : s >= 15 ? '\n최우선 대응 대상' : ''}`;
        return <span title={tip} style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: closed ? undefined : g.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: closed ? 0.55 : 1 }}>{s}</span>
          <span aria-hidden style={{ width: 44, height: 5, borderRadius: 3, background: '#eceaea', overflow: 'hidden', display: 'inline-block' }}>
            <span style={{ display: 'block', width: `${(s / 25) * 100}%`, height: '100%', background: closed ? '#c9c5c5' : g.color }} />
          </span>
        </span>;
      } },
      { key: 'level', label: '등급', badge: true },
      // 대응: 완화계획·비상계획 작성 여부 — 고노출 리스크의 대응방안 누락은 감리 지적 1순위
      { key: 'mitigation', label: '대응', render: (v: any, row: any) => {
        const m = lines(v), c = lines(row.contingency);
        const p = num(row.probability), i = num(row.impact); const s = p && i ? p * i : 0;
        const closed = String(row.status) === 'closed';
        const risky = s >= 15 || String(row.level) === 'high' || String(row.level) === 'critical';
        if (!m.length) {
          if (risky && !closed) return <span title={`노출도 ${s || '?'}점(등급 높음) 리스크인데 대응방안(완화계획)이 비어 있습니다.\n상세를 열어 완화계획을 작성하세요 — 고위험 리스크의 대응방안 누락은 감리·검수 지적 대상입니다.`} style={{ color: '#c0414f', fontWeight: 700, cursor: 'help' }}>⚠ 대응방안 미작성</span>;
          return <span className="muted" title={closed ? '종료된 리스크입니다' : '대응방안(완화계획)이 아직 작성되지 않았습니다'} style={{ cursor: 'help' }}>미작성</span>;
        }
        const tip = [
          `완화계획 ${m.length}건`,
          ...m.slice(0, 5).map((l, n) => `  ${n + 1}. ${l}`),
          m.length > 5 ? `  … 외 ${m.length - 5}건` : '',
          c.length ? `비상계획 ${c.length}건` : '비상계획 없음 — 발생 시 대응 절차를 작성하세요',
          ...c.slice(0, 3).map((l, n) => `  ${n + 1}. ${l}`),
        ].filter(Boolean).join('\n');
        return <span title={tip} style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 240 }}>
          <span className="pill p-green" style={{ flex: '0 0 auto' }}>완화 {m.length}</span>
          {c.length
            ? <span className="pill p-gray" style={{ flex: '0 0 auto' }}>비상 {c.length}</span>
            : risky && !closed ? <span style={{ flex: '0 0 auto', color: '#d98a16', fontSize: 11, fontWeight: 600 }}>비상계획 없음</span> : null}
          <span className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m[0]}</span>
        </span>;
      } },
      { key: 'status', label: '상태', badge: true },
      { key: 'dueDate', label: '대응기한', render: (v: any, row: any) => {
        if (!v) return '—';
        const closed = String(row.status) === 'closed';
        const t = new Date(v).getTime();
        if (closed || isNaN(t)) return v;
        const now = Date.now();
        const dd = Math.ceil((t - now) / 86400000);
        const od = Math.floor((now - t) / 86400000);
        const col = t < now ? '#c0414f' : dd <= 7 ? '#d98a16' : undefined;
        const tip = col ? (t < now ? (od >= 1 ? `${od}일 대응기한 초과` : '오늘 대응기한') : (dd <= 0 ? '오늘 대응기한' : `D-${dd}`)) : undefined;
        return <span title={tip} style={{ color: col, fontWeight: col ? 700 : undefined, cursor: tip ? 'help' : undefined }}>{v}{col === '#c0414f' ? ' ⚠' : ''}</span>;
      } },
      { key: 'owner', label: '담당' },
    ]}
    fields={[
      { key: 'title', label: '제목', required: true },
      { key: 'description', label: '설명', type: 'textarea' },
      { key: 'probability', label: '발생가능성(1-5)', type: 'number', half: true, hint: '1 매우낮음 · 2 낮음 · 3 보통 · 4 높음 · 5 매우높음' },
      { key: 'impact', label: '영향도(1-5)', type: 'number', half: true, hint: '1 매우낮음 · 2 낮음 · 3 보통 · 4 높음 · 5 매우높음' },
      { key: 'status', label: '상태', type: 'select', options: ['identified', 'mitigating', 'closed'], half: true },
      { key: 'owner', label: '담당자', type: 'combo', optionsFrom: 'members', half: true, placeholder: '인력 선택/입력' },
      { key: 'dueDate', label: '대응 기한', type: 'date', half: true },
      { key: 'mitigation', label: '대응방안(완화계획)', type: 'textarea', hint: '한 줄에 조치 하나씩 — 발생 확률·영향을 낮추기 위한 사전 조치' },
      { key: 'contingency', label: '비상계획(Contingency)', type: 'textarea', hint: '한 줄에 조치 하나씩 — 리스크가 실제로 발생했을 때의 대응 절차' },
    ]} />;
}
