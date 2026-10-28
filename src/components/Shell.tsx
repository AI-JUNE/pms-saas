'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, FolderKanban, Layers3, ListTodo, FileCheck2, ClipboardList,
  Bug, ShieldAlert, CalendarClock, Users, Bell, Search, LogOut, ChevronDown, Check, ClipboardCheck, CalendarDays,
  BarChart3, Activity, Settings, ShieldCheck, Command, User, GitBranch, Type, Circle, Menu, Camera,
  Share2, Server, Flame, ShoppingCart, MessageSquare, UserCheck, CalendarRange, Network, Gauge, ListChecks,
  FileSearch, Star, ArrowLeft, Presentation,
} from 'lucide-react';
import { Logo } from './Logo';
import { clearAppStorage } from '@/lib/appStorage';
import { GowonMark } from './GowonMark';
import { filterNav, canAccessScreen, type Principal } from '@/lib/screenAccess';
import { FAV_KEY, parseFavs, toggleFav, approvalBadges, type Approval } from '@/lib/shellPrefs';

const NAV = [
  { group: '현황', items: [
    { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
    { href: '/mywork', label: '내 작업', icon: UserCheck },
    { href: '/todos', label: '내 To-Do', icon: ListChecks },
    { href: '/projects', label: '프로젝트', icon: FolderKanban },
    { href: '/phases', label: '단계', icon: Layers3 },
    { href: '/reports', label: '리포트', icon: BarChart3 },
    { href: '/weekly', label: '주간보고', icon: CalendarRange },
    { href: '/snapshots', label: '기성고·스냅샷', icon: Camera },
  ]},
  { group: '실행', items: [
    { href: '/tasks', label: '업무 (WBS)', icon: ListTodo },
    { href: '/requirements', label: '요구사항', icon: ClipboardList },
    { href: '/rtm', label: '요구사항 추적(RTM)', icon: Network },
    { href: '/documents', label: '산출물·결재', icon: FileCheck2 },
    { href: '/form-definitions', label: '산출물 양식', icon: FileCheck2 },
  ]},
  { group: '통제', items: [
    { href: '/issues', label: '이슈·결함', icon: Bug },
    { href: '/tests', label: '테스트', icon: ClipboardCheck },
    { href: '/test-cycles', label: '테스트 차수', icon: Layers3 },
    { href: '/risks', label: '리스크', icon: ShieldAlert },
    { href: '/meetings', label: '회의', icon: CalendarClock },
    { href: '/calendar', label: '캘린더', icon: CalendarDays },
  ]},
  { group: '인프라·운영', items: [
    { href: '/interfaces', label: '인터페이스', icon: Share2 },
    { href: '/infra', label: '인프라 자산', icon: Server },
    { href: '/firewall', label: '방화벽', icon: Flame },
    { href: '/procurement', label: '조달', icon: ShoppingCart },
  ]},
  { group: '조직·협업', items: [
    { href: '/members', label: '인력', icon: Users },
    { href: '/workload', label: '업무 부하', icon: Gauge },
    { href: '/notifications', label: '알림', icon: Bell },
  ]},
  { group: '제안', items: [
    { href: '/apps/analysis', label: '제안분석', icon: FileSearch },
    { href: '/apps/quality', label: '제안 품질관리', icon: ClipboardCheck },
    { href: '/apps/strategy', label: '제안 전략도출', icon: GitBranch },
    { href: '/apps/performance', label: '고객 성과관리', icon: Gauge },
    { href: '/apps/authoring', label: '제안서·발표본 작성', icon: Presentation },
  ]},
  { group: '관리', items: [
    { href: '/admin', label: '사용자·권한', icon: ShieldCheck },
    { href: '/audit', label: '감사 로그', icon: Activity },
    { href: '/settings', label: '설정', icon: Settings },
  ]},
];
const nfmt = (n: number) => n.toLocaleString('ko-KR');
let SHELL_CACHE: { me?: any; projects?: any[]; notifs?: any[]; approvals?: Approval[] } = {};

export function Shell({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<any>(SHELL_CACHE.me ?? null);
  const [projects, setProjects] = useState<any[]>(SHELL_CACHE.projects ?? []);
  const [pid, setPid] = useState<number | null>(null);
  const [notifs, setNotifs] = useState<any[]>(SHELL_CACHE.notifs ?? []);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [cmd, setCmd] = useState(false);
  const [cq, setCq] = useState('');
  const [ci, setCi] = useState(0);
  const [recs, setRecs] = useState<any[]>([]);
  const [big, setBig] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 즐겨찾기(브라우저 저장)·결재 대기 배지·뒤로 가기
  const [favs, setFavs] = useState<string[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>(SHELL_CACHE.approvals ?? []);
  const [canBack, setCanBack] = useState(false);
  const trigRef = useRef<HTMLElement | null>(null); // 마지막으로 드롭다운을 연 트리거 버튼 — Escape 닫기 시 포커스 복귀용
  useEffect(() => { const b = localStorage.getItem('pms.big') === '1'; setBig(b); document.documentElement.classList.toggle('big', b); }, []);
  useEffect(() => { document.title = title ? `${title} — 프로젝트 허브` : 'GOWON 프로젝트 허브'; }, [title]);
  function toggleBig() { const b = !big; setBig(b); localStorage.setItem('pms.big', b ? '1' : '0'); document.documentElement.classList.toggle('big', b); }

  useEffect(() => {
    setPid(Number(localStorage.getItem('pms.project')) || (SHELL_CACHE.projects?.[0]?.id ?? null));
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (!d.authenticated) router.push('/login'); else { setMe(d); SHELL_CACHE.me = d; } });
    fetch('/api/projects').then((r) => r.ok ? r.json() : []).then((d) => { const a = Array.isArray(d) ? d : []; setProjects(a); SHELL_CACHE.projects = a; setPid(Number(localStorage.getItem('pms.project')) || (a[0]?.id ?? null)); });
    try { setFavs(parseFavs(localStorage.getItem(FAV_KEY))); } catch {}
    setCanBack(window.history.length > 1);
    fetch('/api/approvals').then((r) => r.ok ? r.json() : null).then((d) => { const a = Array.isArray(d?.items) ? d.items : []; setApprovals(a); SHELL_CACHE.approvals = a; }).catch(() => {});
    fetch('/api/notifications').then((r) => r.ok ? r.json() : []).then((d) => { const a = Array.isArray(d) ? d : []; setNotifs(a); SHELL_CACHE.notifs = a; });
  }, [router]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((v) => !v); setCq(''); setCi(0); }
    if (e.key === 'Escape') {
      setCmd(false);
      if (openMenu) {
        setOpenMenu(null);
        const t = trigRef.current;
        if (t && document.contains(t)) setTimeout(() => t.focus(), 0); // 메뉴 항목에 포커스가 있던 경우 트리거로 복귀
      }
      setMenuOpen(false);
    }
  }, [openMenu]);
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onKey]);

  useEffect(() => {
    if (!cmd) return;
    const q = cq.trim();
    if (q.length < 1) { setRecs([]); return; }
    const t = setTimeout(() => {
      fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.ok ? r.json() : []).then((d) => setRecs(Array.isArray(d) ? d : [])).catch(() => {});
    }, 180);
    return () => clearTimeout(t);
  }, [cq, cmd]);

  function pickProject(id: number) { localStorage.setItem('pms.project', String(id)); setPid(id); setOpenMenu(null); location.reload(); }
  // wipe=true: 공용 PC 용 — 같은 오리진의 제안 앱 브라우저 저장(결과·고객사 자료·키)까지 지운다(appStorage.ts, 외부 오픈 관문 S-1)
  async function logout(wipe = false) {
    await fetch('/api/auth/logout', { method: 'POST' });
    if (wipe) { try { clearAppStorage(window.localStorage); } catch { /* 저장소 접근 불가 — 로그아웃은 그대로 진행 */ } }
    router.push('/login');
  }
  const unread = notifs.filter((n) => !n.isRead).length;
  const curProj = projects.find((p) => p.id === pid);
  // 역할 등급(lib/screenAccess) — /api/auth/me 가 오기 전(null)에는 관리 화면을 숨긴다(업무 화면은 그대로).
  //   서버 레이아웃(ScreenGate)·API(assertScreenAccess) 가 같은 정책을 쓰므로 메뉴 숨김은 편의이고 경계는 서버다.
  const principal: Principal | null = me?.org ? { role: me.org.role, isOrgAdmin: !!me.org.isOrgAdmin, isSuperadmin: !!me.user?.isSuperadmin } : (me?.user?.isSuperadmin ? { isSuperadmin: true } : null);
  const visibleNav = NAV.map((g) => ({ ...g, items: filterNav(g.items, principal) })).filter((g) => g.items.length > 0);
  const allItems = visibleNav.flatMap((g) => g.items);
  const favItems = parseFavs(favs, allItems.map((n) => n.href)).map((h) => allItems.find((n) => n.href === h)!).filter(Boolean);
  const curItem = allItems.find((n) => path === n.href) || allItems.find((n) => n.href !== '/dashboard' && path.startsWith(n.href + '/'));
  const isFav = !!curItem && favs.includes(curItem.href);
  function flipFav() { if (!curItem) return; const n = toggleFav(favs, curItem.href); setFavs(n); try { localStorage.setItem(FAV_KEY, JSON.stringify(n)); } catch {} }
  const apBadge = approvalBadges(approvals);
  const navGroups = favItems.length ? [{ group: '즐겨찾기', items: favItems }, ...visibleNav] : visibleNav;
  const TYPE_ICON: any = { project: FolderKanban, issue: Bug, requirement: ClipboardList, risk: ShieldAlert, task: ListTodo, document: FileCheck2, member: Users, meeting: CalendarClock };
  const TYPE_KO: any = { project: '프로젝트', issue: '이슈', requirement: '요구사항', risk: '리스크', task: '업무', document: '산출물', member: '인력', meeting: '회의' };
  const _q = cq.trim();
  const navItems = visibleNav.flatMap((g) => g.items).filter((n) => n.label.toLowerCase().includes(_q.toLowerCase())).map((n) => ({ kind: 'nav', href: n.href, label: n.label, icon: n.icon, tag: '' }));
  const recItems = recs.map((r: any) => ({ kind: 'rec', href: r.href, label: (r.code ? r.code + ' · ' : '') + (r.title || ''), icon: TYPE_ICON[r.type] || Search, tag: TYPE_KO[r.type] || r.type }));
  const cmdResults = _q.length >= 1 ? [...navItems, ...recItems] : navItems;

  return (
    <div className="app" onClick={() => setOpenMenu(null)}>
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Logo />
        {navGroups.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((n) => { const Icon = n.icon; const active = path === n.href || (n.href !== '/dashboard' && path.startsWith(n.href));
              return (<Link key={n.href} href={n.href} prefetch onClick={() => setMenuOpen(false)} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon /><span>{n.label}</span>{n.href === '/notifications' && unread > 0 && <span className="nav-badge" title={`안 읽은 알림 ${nfmt(unread)}건`}>{nfmt(unread)}</span>}{apBadge[n.href] > 0 && <span className="nav-badge ap" title={`내 결재 대기 ${nfmt(apBadge[n.href])}건`}>{nfmt(apBadge[n.href])}</span>}</Link>); })}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="statusblock">
          <div className="row" style={{ gap: 6 }}><Circle style={{ width: 8, height: 8, fill: '#2f8f5b', color: '#2f8f5b' }} /><span style={{ fontWeight: 700, fontSize: 11.5 }}>연결됨 · Vercel</span></div>
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>구축 · 주식회사 <b style={{ color: 'var(--brand)' }}>고원(GOWON)</b></div>
          <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>빌드 <b style={{ color: 'var(--text-3)' }}>v17</b> · 2026-07-01</div>
        </div>
        <div className="gowon-foot">
          <div className="gowon-cap">운영 법인</div>
          <GowonMark />
        </div>
      </aside>

      {menuOpen && <div className="menu-scrim" onClick={() => setMenuOpen(false)} />}
      <div className="main">
        {me?.guest && <div className="guest-bar" role="status">둘러보기 모드 — 데모 조직을 읽기 전용으로 보고 있습니다. 저장·변경은 되지 않습니다. <a href="/login" onClick={async (e) => { e.preventDefault(); await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}>회원가입·로그인 →</a></div>}
        <header className="topbar">
          <button className="iconbtn menu-btn" onClick={() => setMenuOpen(true)} aria-label="메뉴" aria-expanded={menuOpen}><Menu style={{ width: 20 }} /></button>
          {canBack && path !== '/dashboard' && <button className="iconbtn tb-back" onClick={() => router.back()} aria-label="이전 화면으로" title="이전 화면으로"><ArrowLeft style={{ width: 18 }} /></button>}
          <div className="tb-title">{title}</div>
          {curItem && <button className={`iconbtn tb-fav${isFav ? ' on' : ''}`} onClick={flipFav} aria-pressed={isFav} aria-label={isFav ? '즐겨찾기에서 빼기' : '이 화면을 즐겨찾기에 추가'} title={isFav ? '즐겨찾기에서 빼기' : '이 화면을 즐겨찾기에 추가(메뉴 맨 위에 표시)'}><Star style={{ width: 17 }} /></button>}
          {projects.length > 0 && (
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={openMenu === 'proj'} onClick={(e) => { trigRef.current = e.currentTarget; setOpenMenu(openMenu === 'proj' ? null : 'proj'); }}>
                <FolderKanban style={{ color: 'var(--brand)' }} />
                <span className="proj-btn-text" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{curProj ? `${curProj.code} · ${curProj.name}` : '프로젝트 선택'}</span>
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
            <button className="iconbtn" aria-label={unread > 0 ? `알림 (안 읽음 ${nfmt(unread)}건)` : '알림'} aria-haspopup="menu" aria-expanded={openMenu === 'notif'} onClick={(e) => { trigRef.current = e.currentTarget; setOpenMenu(openMenu === 'notif' ? null : 'notif'); }}><Bell style={{ width: 19 }} />{unread > 0 && <span className="dot" />}</button>
            {openMenu === 'notif' && (
              <div className="menu" style={{ minWidth: 300 }}>
                <div style={{ padding: '6px 10px', fontWeight: 750, fontSize: 13 }}>알림 {unread > 0 ? `(${nfmt(unread)})` : ''}</div><div className="menu-sep" />
                {notifs.slice(0, 6).map((n) => (<div key={n.id} className="menu-item" style={{ alignItems: 'flex-start', cursor: 'default' }}><span style={{ width: 7, height: 7, borderRadius: 9, background: n.isRead ? 'var(--text-4)' : 'var(--brand)', marginTop: 6 }} /><span style={{ fontWeight: n.isRead ? 500 : 700 }}>{n.message}</span></div>))}
                {notifs.length === 0 && <div className="muted" style={{ padding: 10 }}>알림이 없습니다.</div>}
                <div className="menu-sep" /><Link href="/notifications" className="menu-item">모두 보기</Link>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button className="avatar" aria-label="내 메뉴" aria-haspopup="menu" aria-expanded={openMenu === 'user'} onClick={(e) => { trigRef.current = e.currentTarget; setOpenMenu(openMenu === 'user' ? null : 'user'); }}><User style={{ width: 18, height: 18 }} /></button>
            {openMenu === 'user' && (
              <div className="menu" style={{ minWidth: 236 }}>
                <div style={{ padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="avatar" style={{ width: 36, height: 36 }}><User style={{ width: 18, height: 18 }} /></span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 750, fontSize: 14 }}>{me?.user?.name || '사용자'}</div><div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.user?.email}</div></div>
                </div>
                <div className="menu-sep" />
                <Link href="/mywork" className="menu-item" onClick={() => setOpenMenu(null)}><UserCheck style={{ width: 16 }} />내 작업</Link>
                <Link href="/notifications" className="menu-item" onClick={() => setOpenMenu(null)}><Bell style={{ width: 16 }} />알림{unread > 0 && <span className="nav-badge" style={{ marginLeft: 'auto' }} title={`안 읽은 알림 ${nfmt(unread)}건`}>{nfmt(unread)}</span>}</Link>
                <Link href="/settings" className="menu-item" onClick={() => setOpenMenu(null)}><Settings style={{ width: 16 }} />내 계정·설정</Link>
                {canAccessScreen(principal, '/audit') && <Link href="/audit" className="menu-item" onClick={() => setOpenMenu(null)}><Activity style={{ width: 16 }} />감사 로그</Link>}
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => logout()}><LogOut style={{ width: 16 }} />로그아웃</button>
                <button className="menu-item" title="공용 PC 에서 사용할 때 — 제안 앱의 분석 결과·고객사 자료·API 키를 이 브라우저에서 지웁니다" onClick={() => { if (window.confirm('이 PC 의 제안 앱 데이터(분석 결과·고객사 자료·API 키)를 지우고 로그아웃할까요? 지운 데이터는 되살릴 수 없습니다.')) logout(true); }}><LogOut style={{ width: 16 }} />로그아웃 + 이 PC 앱 데이터 삭제</button>
              </div>
            )}
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="content">{children}</main>
        <nav className="mobiletabs" aria-label="모바일 탐색">
          {[
            { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
            { href: '/mywork', label: '내 작업', icon: UserCheck },
            { href: '/tasks', label: '업무', icon: ListTodo },
            { href: '/notifications', label: '알림', icon: Bell },
          ].map((t) => {
            const Icon = t.icon;
            const active = path === t.href || (t.href !== '/dashboard' && path.startsWith(t.href));
            return (
              <Link key={t.href} href={t.href} prefetch className={`mobiletab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
                <Icon />
                {t.href === '/notifications' && unread > 0 && <span className="mt-badge">{nfmt(unread)}</span>}
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {cmd && (
        <div className="cmdk-scrim" onClick={() => setCmd(false)}>
          <div className="cmdk" role="dialog" aria-modal="true" aria-label="검색 / 이동" onClick={(e) => e.stopPropagation()}>
            <div className="cmdk-in"><Command style={{ width: 18, color: 'var(--text-3)' }} />
              <input autoFocus placeholder="화면·데이터 검색 / 이동…" value={cq}
                onChange={(e) => { setCq(e.target.value); setCi(0); }}
                onKeyDown={(e) => { if (e.key === 'ArrowDown') setCi((i) => Math.min(i + 1, cmdResults.length - 1)); if (e.key === 'ArrowUp') setCi((i) => Math.max(i - 1, 0)); if (e.key === 'Enter' && cmdResults[ci]) { router.push(cmdResults[ci].href); setCmd(false); } }} />
              <span className="kbd">ESC</span></div>
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
              {cmdResults.map((n: any, i: number) => { const Icon = n.icon; return (<div key={n.kind + ':' + n.href + ':' + i} className={`cmdk-item ${i === ci ? 'sel' : ''}`} onMouseEnter={() => setCi(i)} onClick={() => { router.push(n.href); setCmd(false); }}><Icon style={{ width: 17 }} /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>{n.tag && <span className="muted" style={{ fontSize: 11 }}>{n.tag}</span>}</div>); })}
              {cmdResults.length === 0 && <div className="muted" style={{ padding: 14 }}>결과 없음</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
