'use client';
// 결제 스캐폴딩 테스트 버튼(배치125) — build now, activate on approval.
// POST /api/billing/checkout(테스트 모드)를 호출해 결제 파라미터 발급 흐름만 검증한다.
// 실결제는 발생하지 않으며(서버가 라이브 모드를 차단), 실PG 연동·SDK 결제창은 [승인 필요].
import { useState } from 'react';

export default function CheckoutButton({ planId, planName }: { planId: string; planName: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = j?.error?.message || j?.message || `HTTP ${r.status}`;
        setMsg({ ok: false, text: r.status === 401 ? '로그인 후 이용할 수 있습니다(무료 데모 로그인 지원)' : detail });
      } else {
        setMsg({ ok: true, text: `테스트 결제 파라미터 발급 완료 (${planName} · ${j?.paymentId ?? '—'}) — 실결제는 발생하지 않습니다` });
      }
    } catch {
      setMsg({ ok: false, text: '네트워크 오류 — 잠시 후 다시 시도해 주세요' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: -8, marginBottom: 14 }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="결제 연동 스캐폴딩 점검용 — 테스트 모드로 결제 파라미터 발급만 수행하며 실제 결제는 발생하지 않습니다"
        style={{
          width: '100%', fontSize: 12, fontWeight: 700, padding: '8px 10px', borderRadius: 'var(--r-sm)',
          color: 'var(--text-3)', background: 'transparent', border: '1px dashed var(--border)',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? '확인 중…' : '결제 연동 테스트 (실결제 없음)'}
      </button>
      {msg && (
        <div role="status" style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.5, color: msg.ok ? 'var(--brand-600)' : 'var(--amber)' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
