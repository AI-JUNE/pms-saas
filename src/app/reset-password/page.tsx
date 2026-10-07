'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';

/**
 * 비밀번호 재설정(공개 화면). ?token= 이 있으면 새 비밀번호 입력, 없으면 이메일로 요청.
 * 메일 발송은 MAIL_PROVIDER 미설정(기본)이면 실제로 나가지 않는다 — 서버 응답(delivery)으로 그 사실을 그대로 안내한다.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ message: string; delivery?: string } | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t && t.trim() ? t.trim() : '');
    document.title = '비밀번호 재설정 — PMS';
  }, []);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwOk = pw.length >= 8 && pw === pw2;

  async function request(e: React.FormEvent) {
    e.preventDefault();
    if (!emailOk) { setErr('이메일 형식을 확인해 주세요.'); return; }
    setBusy(true); setErr('');
    const r = await fetch('/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setDone({ message: d.message || '안내를 보냈습니다.', delivery: d.delivery });
    else setErr(d.message || '요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setErr('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (pw !== pw2) { setErr('비밀번호 확인이 일치하지 않습니다.'); return; }
    setBusy(true); setErr('');
    const r = await fetch('/api/auth/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setDone({ message: d.message || '비밀번호가 변경되었습니다.' }); setTimeout(() => router.push('/login'), 2500); }
    else setErr(d.message || '재설정에 실패했습니다.');
  }

  return (
    <div className="auth"><div className="auth-card">
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      <div style={{ display: 'flex', justifyContent: 'center' }}><Logo /></div>
      <main id="main-content" tabIndex={-1}>
        <h1 style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, margin: '10px 0 4px' }}>비밀번호 재설정</h1>
        <p className="muted" style={{ textAlign: 'center', margin: '0 0 20px', fontSize: 13 }}>
          {token === null ? '확인 중…' : token ? '새 비밀번호를 입력해 주세요.' : '가입한 이메일을 입력하시면 재설정 안내를 보내 드립니다.'}
        </p>
        {err && <div className="err" role="alert" style={{ margin: '0 0 14px' }}>{err}</div>}
        {done ? (
          <div role="status" className="card" style={{ padding: 14, fontSize: 13.5, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{done.message}</div>
            {done.delivery && done.delivery !== 'sent' && (
              <div className="muted" style={{ fontSize: 12.5, color: '#be5535' }}>
                현재 이 서비스에는 메일 발송이 연동되어 있지 않아 안내 메일이 실제로 전송되지 않습니다. 조직 관리자에게 「사용자·권한」 화면의 비밀번호 초기화를 요청해 주세요.
              </div>
            )}
            <p style={{ marginTop: 12 }}><a href="/login" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>로그인 화면으로</a></p>
          </div>
        ) : token === null ? null : token ? (
          <form onSubmit={confirm}>
            <div className="field"><label htmlFor="rp-pw">새 비밀번호</label><input id="rp-pw" className="in" type="password" autoComplete="new-password" aria-required="true" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8자 이상" /></div>
            <div className="field"><label htmlFor="rp-pw2">새 비밀번호 확인</label><input id="rp-pw2" className="in" type="password" autoComplete="new-password" aria-required="true" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
            <button className="btn btn-pri" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: 11 }} disabled={busy || !pwOk} title={!pwOk ? '8자 이상, 확인과 일치해야 합니다' : ''}>{busy ? '처리 중…' : '비밀번호 변경'}</button>
          </form>
        ) : (
          <form onSubmit={request}>
            <div className="field"><label htmlFor="rp-email">이메일</label><input id="rp-email" className="in" type="email" autoComplete="email" aria-required="true" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></div>
            <button className="btn btn-pri" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: 11 }} disabled={busy || !emailOk}>{busy ? '처리 중…' : '재설정 안내 요청'}</button>
          </form>
        )}
        {!done && <p className="muted" style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5 }}><a href="/login" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>로그인으로 돌아가기</a></p>}
      </main>
    </div></div>
  );
}
