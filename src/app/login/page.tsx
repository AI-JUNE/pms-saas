'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', orgName: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const res = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
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
          <div className="field"><label>조직명</label><input className="in" value={form.orgName} onChange={set('orgName')} placeholder="우리 회사" /></div>
        </>)}
        <div className="field"><label>이메일</label><input className="in" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" /></div>
        <div className="field"><label>비밀번호</label><input className="in" type="password" value={form.password} onChange={set('password')} placeholder="8자 이상" /></div>
        <button className="btn btn-pri" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: 11 }} disabled={busy}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
      </form>
      <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>데모: admin@demo.local / admin1234</p>
    </div></div>
  );
}
