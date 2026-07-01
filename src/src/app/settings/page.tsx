'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Check } from 'lucide-react';
import { Shell } from '@/components/Shell';
export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<any>(null); const [name, setName] = useState(''); const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => { fetch('/api/settings').then((r) => r.ok ? r.json() : Promise.reject()).then((x) => { setD(x); setName(x.org?.name || ''); }).catch(() => router.push('/login')); }, [router]);
  async function save() { await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  async function fillDemo() { setBusy(true); const r = await fetch('/api/admin/seed-demo', { method: 'POST' }); setBusy(false); if (r.ok) setDone(true); }
  if (!d) return <Shell title="설정"><div className="empty">불러오는 중…</div></Shell>;
  return (
    <Shell title="설정">
      <h2 className="h1">설정</h2><p className="h-sub">조직 정보와 데모 데이터를 관리합니다.</p>
      <div style={{ height: 18 }} />
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <div className="sect" style={{ marginBottom: 14 }}>조직</div>
        <div className="field"><label>조직명</label><input className="in" value={name} onChange={(e) => setName(e.target.value)} disabled={!d.isOrgAdmin} /></div>
        <div className="row" style={{ gap: 18, fontSize: 13 }}><span className="muted">플랜</span><span className="pill p-blue np">{d.org?.plan || 'free'}</span><span className="muted">내 역할</span><span className="pill p-purple np">{d.role}</span></div>
        {d.isOrgAdmin && <div style={{ marginTop: 16 }}><button className="btn btn-pri" onClick={save}>{saved ? '저장됨 ✓' : '저장'}</button></div>}
      </div>
      {d.isOrgAdmin && (
        <div className="card card-pad" style={{ maxWidth: 560, marginTop: 14 }}>
          <div className="sect" style={{ marginBottom: 8 }}><Database style={{ width: 15, verticalAlign: -3, marginRight: 6, color: 'var(--brand)' }} />데모 데이터 모드</div>
          <p className="muted" style={{ margin: '0 0 14px', lineHeight: 1.6 }}>현재 조직에 샘플 프로젝트·요구사항·이슈·리스크·업무·스프린트·인력·인프라·방화벽·조달·게시판 데이터를 한 번에 채웁니다. 모든 메뉴와 대시보드·리포트에서 즉시 확인할 수 있고, 이미 있는 항목은 보존됩니다.</p>
          <button className="btn btn-pri" onClick={fillDemo} disabled={busy || done}>{busy ? '생성 중…' : done ? <><Check style={{ width: 15 }} />완료 · 새로고침하세요</> : '데모 데이터 채우기'}</button>
          {done && <p className="muted" style={{ marginTop: 10 }}>브라우저를 새로고침하면 각 메뉴에 데이터가 표시됩니다.</p>}
        </div>
      )}
      <div className="card card-pad" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="sect" style={{ marginBottom: 10 }}>안내</div>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>데모 계정(admin@demo.local)은 운영 전 삭제하거나 비밀번호를 변경하세요. 신규 구성원은 로그인 화면의 회원가입으로 추가됩니다. Powered by GOWON.</p>
      </div>
    </Shell>
  );
}
