'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, Layers3, ListTodo, FileCheck2, ClipboardList,
  Bug, ShieldAlert, CalendarClock, Users, Bell, Search, LogOut, ChevronDown, Check,
  BarChart3, Activity, Settings, ShieldCheck, Command, User, GitBranch, Type, Circle, Menu,
  Share2, Server, Flame, ShoppingCart, MessageSquare,
} from 'lucide-react';
import { Logo } from './Logo';
import { GowonMark } from './GowonMark';

const NAV = [
  { group: '현황', items: [
    { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
    { href: '/projects', label: '프로젝트', icon: FolderKanban },
    { href: '/phases', label: '단계', icon: Layers3 },
    { href: '/reports', label: '리포트', icon: BarChart3 },
  ]},
  { group: '실행', items: [
    { href: '/tasks', label: '업무 (WBS)', icon: ListTodo },
    { href: '/backlog', label: '백로그·스프린트', icon: GitBranch },
    { href: '/requirements', label: '요구사항', icon: ClipboardList },
    { href: '/documents', label: '산출물·결재', icon: FileCheck2 },
  ]},
  { group: '통제', items: [
    { href: '/issues', label: '이슈·결함', icon: Bug },
    { href: '/risks', label: '리스크', icon: ShieldAlert },
    { href: '/meetings', label: '회의', icon: CalendarClock },
  ]},
  { group: '인프라·운영', items: [
    { href: '/interfaces', label: '인터페이스', icon: Share2 },
    { href: '/infra', label: '인프라 자산', icon: Server },
    { href: '/firewall', label: '방화벽', icon: Flame },
    { href: '/procurement', label: '조달', icon: ShoppingCart },
  ]},
  { group: '조직·협업', items: [
    { href: '/members', label: '인력', icon: Users },
    { href: '/boards', label: '게시판', icon: MessageSquare },
    { href: '/notifications', label: '알림', icon: Bell },
  ]},
  { group: '관리', items: [
    { href: '/admin', label: '사용자·권한', icon: ShieldCheck },
    { href: '/audit', label: '감사 로그', icon: Activity },
    { href: '/settings', label: '설정', icon: Settings },
  ]},
];
const ALL = NAV.flatMap((g) => g.items);

export function Shell({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [cmd, setCmd] = useState(false);
  const [cq, setCq] = useState('');
  const [ci, setCi] = useState(0);
  const [big, setBig] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { const b = localStorage.getItem('pms.big') === '1'; setBig(b); document.documentElement.classList.toggle('big', b); }, []);
  function toggleBig() { const b = !big; setBig(b); localStorage.setItem('pms.big', b ? '1' : '0'); document.documentElement.classList.toggle('big', b); }

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (!d.authenticated) router.push('/login'); else setMe(d); });
    fetch('/api/projects').then((r) => r.ok ? r.json() : []).then((d) => { const a = Array.isArray(d) ? d : []; setProjects(a); setPid(Number(localStorage.getItem('pms.project')) || (a[0]?.id ?? null)); });
    fetch('/api/notifications').then((r) => r.ok ? r.json() : []).then((d) => setNotifs(Array.isArray(d) ? d : []));
  }, [router]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((v) => !v); setCq(''); setCi(0); }
    if (e.key === 'Escape') setCmd(false);
  }, []);
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onKey]);

  function pickProject(id: number) { localStorage.setItem('pms.project', String(id)); setPid(id); setOpenMenu(null); location.reload(); }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); }
  const unread = notifs.filter((n) => !n.isRead).length;
  const curProj = projects.find((p) => p.id === pid);
  const cmdResults = ALL.filter((n) => n.label.toLowerCase().includes(cq.toLowerCase()));

  return (
    <div className="app" onClick={() => setOpenMenu(null)}>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Logo />
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((n) => { const Icon = n.icon; const active = path === n.href || (n.href !== '/dashboard' && path.startsWith(n.href));
              return (<a key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className={`nav-item ${active ? 'active' : ''}`}><Icon /><span>{n.label}</span>{n.href === '/notifications' && unread > 0 && <span className="nav-badge">{unread}</span>}</a>); })}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="statusblock">
          <div className="row" style={{ gap: 6 }}><Circle style={{ width: 8, height: 8, fill: '#2f8f5b', color: '#2f8f5b' }} /><span style={{ fontWeight: 700, fontSize: 11.5 }}>연결됨 · Vercel</span></div>
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>구축 · 주식회사 <b style={{ color: 'var(--brand)' }}>고원(GOWON)</b></div>
        </div>
        <div className="gowon-foot">
          <div className="gowon-cap">운영 법인</div>
          <GowonMark />
        </div>
      </aside>

      {menuOpen && <div className="menu-scrim" onClick={() => setMenuOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="iconbtn menu-btn" onClick={() => setMenuOpen(true)} aria-label="메뉴"><Menu style={{ width: 20 }} /></button>
          <div className="tb-title">{title}</div>
          {projects.length > 0 && (
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setOpenMenu(openMenu === 'proj' ? null : 'proj')}>
                <FolderKanban style={{ color: 'var(--brand)' }} />
                <span style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{curProj ? `${curProj.code} · ${curProj.name}` : '프로젝트 선택'}</span>
                <ChevronDown style={{ width: 14, color: 'var(--text-3)' }} />
              </button>
              {openMenu === 'proj' && (
                <div className="menu" style={{ left: 0, right: 'auto', minWidth: 280 }}>
                  {projects.map((p) => (<button key={p.id} className="menu-item" onClick={() => pickProject(p.id)}><span className="mono" style={{ minWidth: 64 }}>{p.code}</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>{p.id === pid && <Check style={{ width: 15, color: 'var(--brand)' }} />}</button>))}
                </div>
              )}
            </div>
          )}
          <div className="tb-spacer" />
          <button className="search" onClick={() => { setCmd(true); setCq(''); setCi(0); }} style={{ cursor: 'pointer' }}>
            <Search style={{ width: 16, height: 16 }} /><span style={{ flex: 1, textAlign: 'left' }}>검색 / 이동…</span><span className="kbd">⌘K</span>
          </button>
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button className="iconbtn" onClick={() => setOpenMenu(openMenu === 'notif' ? null : 'notif')}><Bell style={{ width: 19 }} />{unread > 0 && <span className="dot" />}</button>
            {openMenu === 'notif' && (
              <div className="menu" style={{ minWidth: 300 }}>
                <div style={{ padding: '6px 10px', fontWeight: 750, fontSize: 13 }}>알림 {unread > 0 ? `(${unread})` : ''}</div><div className="menu-sep" />
                {notifs.slice(0, 6).map((n) => (<div key={n.id} className="menu-item" style={{ alignItems: 'flex-start', cursor: 'default' }}><span style={{ width: 7, height: 7, borderRadius: 9, background: n.isRead ? 'var(--text-4)' : 'var(--brand)', marginTop: 6 }} /><span style={{ fontWeight: n.isRead ? 500 : 700 }}>{n.message}</span></div>))}
                {notifs.length === 0 && <div className="muted" style={{ padding: 10 }}>알림이 없습니다.</div>}
                <div className="menu-sep" /><a href="/notifications" className="menu-item">모두 보기</a>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button className="avatar" onClick={() => setOpenMenu(openMenu === 'user' ? null : 'user')} aria-label="내 메뉴"><User style={{ width: 18, height: 18 }} /></button>
            {openMenu === 'user' && (
              <div className="menu" style={{ minWidth: 200 }}>
                <div style={{ padding: '8px 11px' }}><div style={{ fontWeight: 750, fontSize: 13.5 }}>{me?.user?.name}</div><div className="muted">{me?.user?.email}</div></div>
                <div className="menu-sep" /><button className="menu-item" onClick={logout}><LogOut style={{ width: 16 }} />로그아웃</button>
              </div>
            )}
          </div>
        </header>
        <div className="content">{children}</div>
      </div>

      {cmd && (
        <div className="cmdk-scrim" onClick={() => setCmd(false)}>
          <div className="cmdk" onClick={(e) => e.stopPropagation()}>
            <div className="cmdk-in"><Command style={{ width: 18, color: 'var(--text-3)' }} />
              <input autoFocus placeholder="화면 검색 / 이동…" value={cq}
                onChange={(e) => { setCq(e.target.value); setCi(0); }}
                onKeyDown={(e) => { if (e.key === 'ArrowDown') setCi((i) => Math.min(i + 1, cmdResults.length - 1)); if (e.key === 'ArrowUp') setCi((i) => Math.max(i - 1, 0)); if (e.key === 'Enter' && cmdResults[ci]) { router.push(cmdResults[ci].href); setCmd(false); } }} />
              <span className="kbd">ESC</span></div>
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
              {cmdResults.map((n, i) => { const Icon = n.icon; return (<div key={n.href} className={`cmdk-item ${i === ci ? 'sel' : ''}`} onMouseEnter={() => setCi(i)} onClick={() => { router.push(n.href); setCmd(false); }}><Icon style={{ width: 17 }} />{n.label}</div>); })}
              {cmdResults.length === 0 && <div className="muted" style={{ padding: 14 }}>결과 없음</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
