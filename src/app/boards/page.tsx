'use client';
import { ResourceView } from '@/components/ResourceView';

// 본문(content)을 줄 단위로 파싱해 미리보기 + 툴팁 (배치70·72와 동일 패턴)
function lines(v: any): string[] {
  return String(v || '').split(/\r?\n/).map((s) => s.replace(/^\s*[-*·•]\s*/, '').trim()).filter(Boolean);
}

export default function Page() {
  return <ResourceView title="게시판" subtitle="공지·자료·Q&A를 공유합니다." endpoint="/api/boards" entity="boards" statusKey="category"
    emptyText="등록된 게시글이 없습니다. “새로 만들기”로 공지·자료·Q&A를 공유하세요."
    columns={[
      { key: 'code', label: '번호' },
      { key: 'category', label: '분류', badge: true },
      { key: 'title', label: '제목', strong: true },
      { key: 'content', label: '내용', render: (v) => {
        const ls = lines(v);
        if (!ls.length) return <span style={{ color: '#c0414f', fontWeight: 700 }} title="본문이 비어 있는 게시글입니다.">⚠ 본문 없음</span>;
        const tip = ls.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n') + (ls.length > 8 ? `\n… 외 ${ls.length - 8}줄` : '');
        return (
          <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'help', maxWidth: 320 }}>
            {ls.length > 1 && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'var(--brand-50)', color: 'var(--brand-600)', whiteSpace: 'nowrap' }}>{ls.length}줄</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{ls[0]}</span>
          </span>
        );
      } },
      { key: 'author', label: '작성자', render: (v) => v || <span className="muted">미지정</span> },
      { key: 'createdAt', label: '작성일', render: (v) => {
        if (!v) return '—';
        const t = new Date(v).getTime();
        if (isNaN(t)) return v;
        const d = Date.now() - t;
        const rel = d < 3600000 ? `${Math.max(1, Math.floor(d / 60000))}분 전`
          : d < 86400000 ? `${Math.floor(d / 3600000)}시간 전`
          : d < 7 * 86400000 ? `${Math.floor(d / 86400000)}일 전`
          : new Date(v).toLocaleDateString('ko-KR');
        const isNew = d < 3 * 86400000;
        return (
          <span title={new Date(v).toLocaleString('ko-KR')} style={{ cursor: 'help', whiteSpace: 'nowrap' }}>
            {rel}
            {isNew && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#2f8f5b' }} title="최근 3일 이내 등록된 새 글입니다.">NEW</span>}
          </span>
        );
      } },
    ]}
    fields={[
      { key: 'title', label: '제목', required: true, placeholder: '예: 2분기 정기점검 일정 안내' },
      { key: 'category', label: '분류', type: 'select', options: ['공지', '자료', 'Q&A', '일반'], half: true },
      { key: 'author', label: '작성자', type: 'combo', optionsFrom: 'members', half: true },
      { key: 'content', label: '내용', type: 'textarea', hint: '한 줄에 항목 하나씩 작성하면 목록에서 미리보기·툴팁으로 확인할 수 있습니다.' },
    ]} />;
}
