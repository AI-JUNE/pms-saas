'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', orgName: '', inviteCode: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  // 약관·개인정보 처리방침 동의(가입 시). 서버는 기본 관측 모드지만 화면은 미리 동의를 받아 둔다
  const [agree, setAgree] = useState({ terms: false, privacy: false });
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  // 클라이언트 입력 검증(서버 왕복 전 빈 값·형식 오류 색출) — 순수 표시/게이트, API·스키마 무영향
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const pwOk = form.password.length >= 8;
  const agreeOk = mode === 'login' || (agree.terms && agree.privacy);
  const regOk = mode === 'login' || (form.name.trim().length > 0 && (form.orgName.trim().length > 0 || form.inviteCode.trim().length > 0));
  const canSubmit = emailOk && pwOk && regOk && agreeOk;
  const hint = !form.email && !form.password ? '' // 초기 빈 화면에서는 안내 억제
    : mode === 'register' && !form.name.trim() ? '이름을 입력하세요.'
    : mode === 'register' && !form.orgName.trim() ? '조직명을 입력하세요.'
    : !form.email.trim() ? '이메일을 입력하세요.'
    : !emailOk ? '이메일 형식을 확인하세요.'
    : !form.password ? '비밀번호를 입력하세요.'
    : !pwOk ? '비밀번호는 8자 이상이어야 합니다.'
    : !agreeOk ? '이용약관과 개인정보 처리방침에 동의해야 가입할 수 있습니다.'
    : '';
  useEffect(() => {
    const inv = new URLSearchParams(window.location.search).get('invite');
    if (inv) { setMode('register'); setForm((f) => ({ ...f, inviteCode: inv.toUpperCase() })); }
    (async () => {
      const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => null);
      if (me?.authenticated) router.replace('/dashboard');
    })();
    // eslint-disable-next-line
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) { setErr(hint || '입력값을 확인하세요'); return; }
    setErr(''); setBusy(true);
    const res = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'register' ? { ...form, agree } : form) });
    setBusy(false);
    if (res.ok) router.push('/dashboard'); else { const d = await res.json().catch(() => ({})); setErr(d.message || '오류가 발생했습니다'); }
  }
  return (
    <div className="auth"><div className="auth-card">
      <div style={{ display: 'flex', justifyContent: 'center' }}><Logo /></div>
      <p className="muted" style={{ textAlign: 'center', margin: '6px 0 24px' }}>프로젝트 관리 시스템</p>
      <div className="auth-tabs">
        <div className={`auth-tab ${mode === 'login' ? 'on' : ''}`} onClick={() => setMode('login')}>로그인</div>
        <div className={`auth-tab ${mode === 'register' ? 'on' : ''}`} onClick={() => setMode('register')}>회원가입</div>
      </div>
      {err && <div className="err" style={{ margin: '0 0 14px' }}>{err}</div>}
      <form onSubmit={submit}>
        {mode === 'register' && (<>
          <div className="field"><label>이름</label><input className="in" value={form.name} onChange={set('name')} placeholder="홍길동" /></div>
          <div className="field"><label>조직명 <span style={{fontWeight:400,color:'var(--text-3)'}}>(초대 코드로 합류 시 생략 가능)</span></label><input className="in" value={form.orgName} onChange={set('orgName')} placeholder="우리 회사" /></div>
          <div className="field"><label>초대 코드 <span style={{fontWeight:400,color:'var(--text-3)'}}>(선택 · 팀 합류 시)</span></label><input className="in" value={form.inviteCode} onChange={set('inviteCode')} placeholder="관리자에게 받은 코드" style={{textTransform:'uppercase'}} /></div>
        </>)}
        <div className="field"><label>이메일</label><input className="in" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" /></div>
        <div className="field"><label>비밀번호</label><input className="in" type="password" value={form.password} onChange={set('password')} placeholder="8자 이상" /></div>
        {mode === 'register' && (
          <div className="field" style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 13 }}>
              <input type="checkbox" checked={agree.terms} onChange={(e) => setAgree({ ...agree, terms: e.target.checked })} />
              <span><a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>이용약관</a>에 동의합니다 (필수)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 13 }}>
              <input type="checkbox" checked={agree.privacy} onChange={(e) => setAgree({ ...agree, privacy: e.target.checked })} />
              <span><a href="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>개인정보 처리방침</a>에 동의합니다 (필수)</span>
            </label>
          </div>
        )}
        {hint && <p className="muted" style={{ textAlign: 'center', margin: '2px 0 0', fontSize: 12, color: '#be5535' }}>{hint}</p>}
        <button className="btn btn-pri" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: 11 }} disabled={busy || !canSubmit} title={!canSubmit ? (hint || '이메일·비밀번호(8자 이상)를 입력하세요') : ''}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
      </form>
      <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>처음이신가요? 상단 '회원가입'으로 관리자 계정을 만드세요.</p>
    </div></div>
  );
}
