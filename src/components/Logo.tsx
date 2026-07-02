import Link from 'next/link';
export function Logo() {
  return (
    <Link href="/dashboard" className="brand" aria-label="홈으로">
      <div className="brand-mark">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.95"/>
          <rect x="14" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.55"/>
          <rect x="3" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.55"/>
          <rect x="14" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.95"/>
        </svg>
      </div>
      <div>
        <div className="brand-name">PMS</div>
        <div className="brand-sub">by GOWON</div>
      </div>
    </Link>
  );
}
