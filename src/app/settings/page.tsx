'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Check } from 'lucide-react';
import { Shell } from '@/components/Shell';
const ROLE_LABEL: Record<string,string> = { admin:'관리자', pmo:'PMO', pm:'PM', member:'멤버' };
const ROLE_BADGE: Record<string,string> = { admin:'p-purple', pmo:'p-cyan', pm:'p-blue', member:'p-gray' };
const PLAN_LABEL: Record<string,string> = { free:'무료', pro:'프로', team:'팀', business:'비즈니스', enterprise:'엔터프라이즈' };
export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<any>(null); const [name, setName] = useState(''); const [saved, setSaved] = useState(false);
  const [myName, setMyName] = useState(''); const [mySaved, setMySaved] = useState(false);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [demoErr, setDemoErr] = useState('');
  const [curPw, setCurPw] = useState(''); const [newPw, setNewPw] = useState(''); const [cfPw, setCfPw] = useState(''); const [pwMsg, setPwMsg] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { fetch('/api/settings').then((r) => r.ok ? r.json() : Promise.reject()).then((x) => { setD(x); setName(x.org?.name || ''); setMyName(x.me?.name || ''); }).catch(() => router.push('/login')); }, [router]);
  async function save() { const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (r.ok) setD((p: any) => p ? { ...p, org: { ...(p.org || {}), name: name.trim() } } : p); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  async function saveProfile() { const r = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: myName.trim() }) }); if (r.ok) { setD((p: any) => p ? { ...p, me: { ...(p.me || {}), name: myName.trim() } } : p); setMySaved(true); setTimeout(() => setMySaved(false), 1500); } }
  async function fillDemo() {
    setBusy(true); setDemoErr('');
    const r = await fetch('/api/admin/seed-demo', { method: 'POST' }).catch(() => null);
    if (r && r.ok) { setDone(true); setTimeout(() => router.push('/tests'), 800); return; }
    const e = r ? await r.json().catch(() => ({} as any)) : {};
    setDemoErr((e as any).message || '데모 데이터를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    setBusy(false);
  }
  async function changePw() {
    setPwMsg('');
    if (newPw.length < 8) { setPwMsg('새 비밀번호는 8자 이상이어야 합니다'); return; }
    if (newPw !== cfPw) { setPwMsg('새 비밀번호가 일치하지 않습니다'); return; }
    const r = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }) });
    if (r.ok) { setPwMsg('변경되었습니다 \u2713'); setCurPw(''); setNewPw(''); setCfPw(''); }
    else { const e = await r.json().catch(() => ({})); setPwMsg(e.message || '변경에 실패했습니다'); }
  }
  async function regenInvite() { const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateInvite: true }) }); if (r.ok) { const j = await r.json().catch(() => ({})); if (j.inviteCode) setD({ ...d, org: { ...d.org, inviteCode: j.inviteCode } }); } }
  if (!d) return (
    <Shell title="설정">
      <h2 className="h1">설정</h2><p className="h-sub">조직 정보와 데모 데이터를 관리합니다.</p>
      <span className="sr-only" role="status">설정을 불러오는 중</span>
      <div style={{ height: 18 }} />
      <div className="card card-pad" style={{ maxWidth: 560 }} aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => <div key={`sk${i}`} className="skel" aria-hidden="true" style={{ height: 18, margin: '10px 0' }} />)}
      </div>
    </Shell>
  );
  return (
    <Shell title="설정">
      <h2 className="h1">설정</h2><p className="h-sub">조직 정보와 데모 데이터를 관리합니다.</p>
      <span className="sr-only" role="status">{`설정 · 조직 ${d.org?.name || '—'} · 플랜 ${PLAN_LABEL[d.org?.plan] || d.org?.plan || '무료'} · 내 역할 ${ROLE_LABEL[d.role] || d.role}${d.isOrgAdmin ? ' (조직 관리자)' : ''}`}</span>
      <div style={{ height: 18 }} />
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <div className="sect" style={{ marginBottom: 14 }}>조직</div>
        <div className="field"><label htmlFor="set-org-name">조직명</label><input id="set-org-name" className="in" value={name} onChange={(e) => setName(e.target.value)} disabled={!d.isOrgAdmin} aria-describedby={!d.isOrgAdmin ? 'set-org-name-hint' : undefined} /></div>
        {!d.isOrgAdmin && <p id="set-org-name-hint" className="muted" style={{ margin: '-6px 0 12px', fontSize: 12 }}>조직명은 조직 관리자만 변경할 수 있습니다.</p>}
        {d.isOrgAdmin && d.org?.inviteCode && (
          <div style={{ marginTop: 6, marginBottom: 14, padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>팀원 초대 코드</div>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.1em', background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '6px 14px' }}>{d.org.inviteCode}</code>
              <button className="btn btn-sm" onClick={() => { try { navigator.clipboard.writeText(d.org.inviteCode); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? '복사됨 \u2713' : '복사'}</button>
              <button className="btn btn-sm" onClick={() => { try { navigator.clipboard.writeText(location.origin + '/login?invite=' + d.org.inviteCode); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200); }}>초대 링크 복사</button>
              <button className="btn btn-sm" onClick={regenInvite}>코드 재발급</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', lineHeight: 1.55 }}>이 코드를 팀원에게 공유하세요. 회원가입 화면의 ‘초대 코드’에 입력하면 같은 조직에 팀원으로 합류합니다.</p>
          </div>
        )}
        <div className="row" style={{ gap: 18, fontSize: 13 }}><span className="muted">플랜</span><span className="pill p-blue np" title={`플랜: ${d.org?.plan || 'free'}`}>{PLAN_LABEL[d.org?.plan] || d.org?.plan || '무료'}</span><a className="btn btn-sm" href="/settings/billing" title="요금제·결제 상태 관리(테스트 모드)">구독 관리</a><span className="muted">내 역할</span><span className={`pill ${ROLE_BADGE[d.role] || 'p-purple'} np`} title={`역할: ${d.role}`}>{ROLE_LABEL[d.role] || d.role}</span></div>
        {d.isOrgAdmin && (() => { const nn = name.trim(); const changed = !!nn && nn !== (d.org?.name || ''); return (<div style={{ marginTop: 16 }}><button className="btn btn-pri" onClick={save} disabled={!changed}>{saved ? '저장됨 ✓' : '저장'}</button>{!nn && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>조직명은 비워둘 수 없습니다.</p>}{!!nn && !changed && !saved && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>변경된 내용이 없습니다.</p>}</div>); })()}
      </div>
      <div className="card card-pad" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="sect" style={{ marginBottom: 14 }}>내 계정</div>
        {d.me?.email && <div className="row" style={{ gap: 10, fontSize: 13, marginBottom: 12, alignItems: 'center' }}><span className="muted">로그인 이메일</span><strong>{d.me.email}</strong></div>}
        <div className="field"><label htmlFor="set-my-name">표시 이름</label><input id="set-my-name" className="in" value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="예: PM" aria-describedby="set-my-name-hint" /></div>
        <p id="set-my-name-hint" className="muted" style={{ margin: '2px 0 14px', fontSize: 12.5 }}>대시보드 인사말과 담당자 표시에 사용됩니다. 로그인 계정별로 개별 적용됩니다.</p>
        {(() => { const mn = myName.trim(); const mChanged = !!mn && mn !== (d.me?.name || ''); return (<>
          <button className="btn btn-pri" onClick={saveProfile} disabled={!mChanged}>{mySaved ? '저장됨 ✓' : '저장'}</button>
          {!mn && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>표시 이름은 비워둘 수 없습니다.</p>}
          {!!mn && !mChanged && !mySaved && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>변경된 내용이 없습니다.</p>}
        </>); })()}
      </div>
      <div className="card card-pad" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="sect" style={{ marginBottom: 14 }}>비밀번호 변경</div>
        <div className="field"><label htmlFor="set-pw-cur">현재 비밀번호</label><input id="set-pw-cur" aria-required="true" className="in" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" /></div>
        <div className="field"><label htmlFor="set-pw-new">새 비밀번호 (8자 이상)</label><input id="set-pw-new" aria-required="true" className="in" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></div>
        <div className="field"><label htmlFor="set-pw-cf">새 비밀번호 확인</label><input id="set-pw-cf" aria-required="true" className="in" type="password" value={cfPw} onChange={(e) => setCfPw(e.target.value)} autoComplete="new-password" /></div>
        <button className="btn btn-pri" onClick={changePw} disabled={!curPw || !newPw || !cfPw}>비밀번호 변경</button>
        {pwMsg && <p role={pwMsg.indexOf('✓') >= 0 ? 'status' : 'alert'} style={{ margin: '10px 0 0', fontSize: 12.5, fontWeight: 650, color: pwMsg.indexOf('\u2713') >= 0 ? 'var(--green)' : 'var(--red)' }}>{pwMsg}</p>}
      </div>
      {d.isOrgAdmin && (
        <div className="card card-pad" style={{ maxWidth: 560, marginTop: 14 }}>
          <div className="sect" style={{ marginBottom: 8 }}><Database style={{ width: 15, verticalAlign: -3, marginRight: 6, color: 'var(--brand)' }} />데모 데이터 모드</div>
          <p className="muted" style={{ margin: '0 0 14px', lineHeight: 1.6 }}>현재 조직에 샘플 프로젝트·요구사항·이슈·리스크·업무·스프린트·인력·인프라·방화벽·조달·게시판 데이터를 한 번에 채웁니다. 모든 메뉴와 대시보드·리포트에서 즉시 확인할 수 있고, 이미 있는 항목은 보존됩니다.</p>
          <button className="btn btn-pri" onClick={fillDemo} disabled={busy || done}>{busy ? '생성 중…' : done ? <><Check style={{ width: 15 }} />완료 · 새로고침하세요</> : '데모 데이터 채우기'}</button>
          {done && <p className="muted" role="status" style={{ marginTop: 10 }}>브라우저를 새로고침하면 각 메뉴에 데이터가 표시됩니다.</p>}
          {demoErr && <p role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 650, color: 'var(--red)' }}>{demoErr}</p>}
        </div>
      )}
      <div className="card card-pad" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="sect" style={{ marginBottom: 10 }}>안내</div>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>데모 계정(admin@demo.local)은 운영 전 삭제하거나 비밀번호를 변경하세요. 신규 구성원은 로그인 화면의 회원가입으로 추가됩니다. Powered by GOWON.</p>
      </div>
    </Shell>
  );
}
