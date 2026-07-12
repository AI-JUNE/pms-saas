'use client';
import { ResourceView } from '@/components/ResourceView';
import { Pill } from '@/lib/ui';

// 인터페이스 목록 품질 진단
// - 연동테스트: 상태가 '승인(approved)'인데 테스트가 '미실시'면 검증 근거 없이 승인된 상태 → 경고
// - 규격: 결재요청(review)·승인(approved) 단계인데 연동 규격(spec)이 비어 있으면 경고 (감리 지적 1순위)
const lines = (s: any) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

export default function Page() {
  return <ResourceView title="인터페이스" subtitle="시스템 간 인터페이스를 설계·관리합니다." endpoint="/api/interfaces" projectScoped entity="interfaces"
    columns={[
      { key: 'code', label: '코드' },
      { key: 'name', label: '인터페이스', strong: true },
      { key: 'srcSystem', label: '송신' },
      { key: 'dstSystem', label: '수신' },
      { key: 'protocol', label: '프로토콜' },
      { key: 'format', label: '포맷' },
      { key: 'cycle', label: '주기' },
      { key: 'owner', label: '담당' },
      {
        key: 'spec', label: '규격', render: (v: any, r: any) => {
          const ls = lines(v);
          if (!ls.length) {
            const gated = r.status === 'approved' || r.status === 'review';
            return gated
              ? <span style={{ color: '#c0414f', fontWeight: 700, fontSize: 12 }} title={`연동 규격이 비어 있습니다 — 현재 상태: ${r.status === 'approved' ? '승인' : '결재요청'}. 규격 없이 결재·승인된 인터페이스는 감리·검수에서 바로 지적됩니다.`}>⚠ 규격 미작성</span>
              : <span className="muted" style={{ fontSize: 12 }} title="연동 규격이 아직 작성되지 않았습니다 (작성중 단계).">미작성</span>;
          }
          const head = ls[0].length > 22 ? `${ls[0].slice(0, 22)}…` : ls[0];
          const tip = ls.slice(0, 8).map((l, i) => `${i + 1}. ${l}`).join('\n') + (ls.length > 8 ? `\n… 외 ${ls.length - 8}줄` : '');
          return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220 }} title={`연동 규격 ${ls.length}줄\n${tip}`}>
            <span className="pill" style={{ background: 'rgba(190,85,53,.12)', color: 'var(--brand)', fontSize: 10.5, fontWeight: 700 }}>{ls.length}줄</span>
            <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{head}</span>
          </span>;
        }
      },
      {
        key: 'testStatus', label: '연동테스트', render: (v: any, r: any) => {
          const t = v || '미실시';
          const risky = t === '미실시' && r.status === 'approved';
          const partial = t === '진행' && r.status === 'approved';
          return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title={risky ? '승인된 인터페이스인데 연동테스트가 미실시입니다 — 검증 없이 승인된 상태이므로 테스트를 먼저 수행하세요.'
              : partial ? '승인된 인터페이스의 연동테스트가 아직 진행중입니다.'
                : t === '완료' ? '연동테스트 완료' : `연동테스트: ${t}`}>
            <Pill v={t} />
            {risky && <span style={{ color: '#c0414f', fontWeight: 700, fontSize: 11.5 }}>⚠ 미검증 승인</span>}
            {partial && <span style={{ color: '#d98a16', fontWeight: 700, fontSize: 11.5 }}>승인·검증중</span>}
          </span>;
        }
      },
      { key: 'status', label: '상태', badge: true },
    ]}
    fields={[
      { key: 'name', label: '인터페이스명', required: true },
      { key: 'srcSystem', label: '송신 시스템', half: true },
      { key: 'dstSystem', label: '수신 시스템', half: true },
      { key: 'protocol', label: '프로토콜', type: 'select', options: ['REST', 'SOAP', 'FTP', 'MQ', 'DB Link', 'File'], half: true },
      { key: 'format', label: '포맷', type: 'select', options: ['JSON', 'XML', 'CSV', 'Fixed', 'EDI'], half: true },
      { key: 'cycle', label: '주기', type: 'select', options: ['실시간', '배치(일)', '배치(시간)', '수시'], half: true },
      { key: 'owner', label: '담당자', type: 'combo', optionsFrom: 'members', half: true },
      { key: 'testStatus', label: '연동테스트', type: 'select', options: ['미실시', '진행', '완료'], half: true },
      { key: 'spec', label: '연동 규격', type: 'textarea', hint: '한 줄에 항목 하나씩 — 전문 포맷·필드·오류코드·재전송 정책 등' },
      { key: 'status', label: '상태', type: 'select', options: ['draft', 'review', 'approved'], half: true },
    ]} />;
}
