'use client';
import { useState } from 'react';
// Real GOWON emblem served by /api/brand-logo (fetched from the official site); falls back to a mark if unavailable.
export function GowonMark() {
  const [ok, setOk] = useState(true);
  if (ok) {
    return (
      <div className="gowon-logo">
        <img src="/api/brand-logo" alt="GOWON" onError={() => setOk(false)}
          style={{ height: 26, width: 'auto', maxWidth: 60, objectFit: 'contain', display: 'block' }} />
        <span className="gowon-word">GOWON</span>
      </div>
    );
  }
  return (
    <div className="gowon-logo">
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-label="GOWON" style={{ display: 'block' }}>
        <defs><linearGradient id="gw-em" x1="2" y1="3" x2="30" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c5cff" /><stop offset=".37" stopColor="#22b8c4" /><stop offset=".7" stopColor="#f7b733" /><stop offset="1" stopColor="#fc575e" />
        </linearGradient></defs>
        <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="url(#gw-em)" />
        <circle cx="16" cy="16" r="7.6" stroke="#fff" strokeWidth="1.9" opacity=".96" />
        <ellipse cx="16" cy="16" rx="3.1" ry="7.6" stroke="#fff" strokeWidth="1.5" opacity=".9" />
        <line x1="8.6" y1="16" x2="23.4" y2="16" stroke="#fff" strokeWidth="1.5" opacity=".9" />
      </svg>
      <span className="gowon-word">GOWON</span>
    </div>
  );
}
