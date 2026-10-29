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
  // 8자 규칙은 가입에만 — 로그인은 기존 비밀번호를 서버가 판정한다(짧은 옛 비밀번호면 버튼이 영영 꺼져 있던 문제, 10-24)
  const pwOk = mode === 'login' ? form.password.length > 0 : form.password.length >= 8;
  const agreeOk = mode === 'login' || (agree.terms && agree.privacy);
  const regOk = mode === 'login' || (form.name.trim().length > 0 && (form.orgName.trim().length > 0 || form.inviteCode.trim().length > 0));
  const canSubmit = emailOk && pwOk && regOk && agreeOk;
  const hint = !form.email && !form.password ? '' // 초기 빈 화면에서는 안내 억제
    : mode === 'register' && !form.name.trim() ? '이름을 입력하세요.'
    : mode === 'register' && !form.orgName.trim() && !form.inviteCode.trim() ? '조직명(또는 초대 코드)을 입력하세요.'
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
  async function guest() {
    setBusy(true); setErr('');
    const r = await fetch('/api/auth/guest', { method: 'POST' });
    // 화면 전환은 페이지를 통째로 다시 연다 — 운영(Vercel 보안 확인)에서 router.push 의 내부 요청이 막혀 '처리 중'에 멈춘 일(10-28)
    if (r.ok) location.href = '/dashboard'; else { const d = await r.json().catch(() => ({})); setErr(d.message || '둘러보기를 시작할 수 없습니다'); setBusy(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // 브라우저 자동 채움은 onChange 없이 값만 넣는 경우가 있다 → 제출 때 칸의 실제 값을 다시 읽는다(10-24)
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const val = (k: 'email' | 'password' | 'name' | 'orgName' | 'inviteCode') => String(fd.get(k) ?? form[k]);
    const email = val('email').trim(), password = val('password');
    // 가입 칸(이름·조직명·초대 코드)도 자동 채움이면 onChange 가 없다 → 같은 방식으로 다시 읽는다(10-28 '회원가입이 안 된다')
    const sent = { ...form, email, password, name: val('name'), orgName: val('orgName'), inviteCode: val('inviteCode') };
    if (JSON.stringify(sent) !== JSON.stringify(form)) setForm(sent);
    const regNow = mode === 'login' || (sent.name.trim().length > 0 && (sent.orgName.trim().length > 0 || sent.inviteCode.trim().length > 0));
    const okNow = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (mode === 'login' ? password.length > 0 : password.length >= 8) && regNow && agreeOk;
    if (!okNow) { setErr(hint || (!email ? '이메일을 입력하세요.' : !password ? '비밀번호를 입력하세요.' : '입력값을 확인하세요')); return; }
    setErr(''); setBusy(true);
    const res = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'register' ? { ...sent, agree } : sent) });
    setBusy(false);
    if (res.ok) router.push('/dashboard'); else { const d = await res.json().catch(() => ({})); setErr(d.message || '오류가 발생했습니다'); }
  }
  return (
    <div className="auth"><div className="auth-card">
      <div style={{ display: 'flex', justifyContent: 'center' }}><Logo /></div>
      <p className="muted" style={{ textAlign: 'center', margin: '6px 0 24px' }}>제안과 프로젝트 수행을 잇는 업무 허브</p>
      {/* 탭 접근성(배치181, 주간 수동): tablist/tab 시맨틱 + 로빙 tabIndex + 화살표·Home/End 이동. 포커스 링은 전역 [role="tab"]:focus-visible */}
      <div className="auth-tabs" role="tablist" aria-label="로그인 또는 회원가입 선택" onKeyDown={(e) => {
        const order: Array<'login' | 'register'> = ['login', 'register'];
        const i = order.indexOf(mode);
        let next: 'login' | 'register' | null = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(i + 1) % order.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(i - 1 + order.length) % order.length];
        else if (e.key === 'Home') next = order[0];
        else if (e.key === 'End') next = order[order.length - 1];
        if (!next) return;
        e.preventDefault(); setMode(next); setErr('');
        document.getElementById(`auth-tab-${next}`)?.focus();
      }}>
        {(['login', 'register'] as const).map((m) => (
          <button key={m} type="button" id={`auth-tab-${m}`} role="tab" aria-selected={mode === m} aria-controls="auth-panel" tabIndex={mode === m ? 0 : -1} className={`auth-tab ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); setErr(''); }}>
            {m === 'login' ? '로그인' : '회원가입'}
          </button>
        ))}
      </div>
      {err && <div className="err" role="alert" style={{ margin: '0 0 14px' }}>{err}</div>}
      <form onSubmit={submit} id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
        {mode === 'register' && (<>
          <div className="field"><label>이름</label><input className="in" name="name" autoComplete="name" value={form.name} onChange={set('name')} placeholder="홍길동" /></div>
          <div className="field"><label>조직명 <span style={{fontWeight:400,color:'var(--text-3)'}}>(초대 코드로 합류 시 생략 가능)</span></label><input className="in" name="orgName" autoComplete="organization" value={form.orgName} onChange={set('orgName')} placeholder="우리 회사" /></div>
          <div className="field"><label>초대 코드 <span style={{fontWeight:400,color:'var(--text-3)'}}>(선택, 팀 합류 시)</span></label><input className="in" name="inviteCode" autoComplete="off" value={form.inviteCode} onChange={set('inviteCode')} placeholder="관리자에게 받은 코드" style={{textTransform:'uppercase'}} /></div>
        </>)}
        <div className="field"><label>이메일</label><input className="in" type="email" name="email" autoComplete="username" value={form.email} onChange={set('email')} onInput={set('email')} placeholder="you@company.com" /></div>
        <div className="field"><label>비밀번호</label><input className="in" type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} onInput={set('password')} placeholder={mode === 'login' ? '비밀번호' : '8자 이상'} />
          {mode === 'login' && <a href="/reset-password" style={{ display: 'inline-block', marginTop: 6, fontSize: 12.5, color: 'var(--brand-600)', fontWeight: 700 }}>비밀번호를 잊으셨나요?</a>}
        </div>
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
        {hint && <p className="muted" style={{ textAlign: 'center', margin: '2px 0 0', fontSize: 12, color: '#2457C5' }}>{hint}</p>}
        <button className="btn btn-pri" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: 11 }} disabled={busy} aria-disabled={!canSubmit} title={!canSubmit ? (hint || '이메일과 비밀번호(8자 이상)를 입력하세요') : ''}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
      </form>
      <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 14, padding: 11 }} onClick={guest} disabled={busy}>회원가입 없이 둘러보기</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 8, fontSize: 12.5 }}>예시 데이터가 들어 있는 데모 조직을 읽기 전용으로 봅니다. 저장이나 변경은 되지 않습니다.</p>
      <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>처음 사용하는 조직은 위의 '회원가입'에서 관리자 계정을 만듭니다.</p>
    </div></div>
  );
}
