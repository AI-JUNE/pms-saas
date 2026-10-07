'use client';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Shell } from './Shell';
import { forbiddenMessage, LEVEL_LABEL, type ScreenDecision } from '@/lib/screenAccess';

/** 403 화면 — 역할 등급이 모자라 열 수 없는 관리 화면. Shell 안에 그려 메뉴·탐색은 그대로 쓸 수 있게 한다. */
export function Forbidden({ decision }: { decision: ScreenDecision }) {
  return (
    <Shell title="접근 제한">
      <div className="card" role="alert" style={{ maxWidth: 560, margin: '40px auto', padding: 28, textAlign: 'center' }}>
        <ShieldAlert aria-hidden="true" style={{ width: 36, height: 36, color: '#c0414f', margin: '0 auto 10px' }} />
        <h2 className="h1" style={{ fontSize: 20, margin: '0 0 8px' }}>이 화면에 접근할 수 없습니다</h2>
        <p className="muted" style={{ margin: '0 0 6px', fontSize: 13.5 }}>{forbiddenMessage(decision)}</p>
        <p className="muted" style={{ margin: '0 0 18px', fontSize: 12.5 }}>
          요청 화면 <code className="mono">{decision.href}</code> · 필요 권한 <b>{LEVEL_LABEL[decision.required]}</b>
          {decision.reason === 'insufficient_role' && ' — 권한이 필요하면 조직 관리자에게 역할 변경을 요청해 주세요.'}
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <Link href="/dashboard" className="btn btn-pri">대시보드로</Link>
          <Link href="/settings" className="btn">내 계정·설정</Link>
        </div>
      </div>
    </Shell>
  );
}
