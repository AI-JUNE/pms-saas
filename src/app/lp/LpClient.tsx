'use client';
import { useEffect } from 'react';
import Link from 'next/link';

const css = `
.lp{--lp-max:1160px;color:var(--text-1);background:var(--bg);overflow-x:hidden}
.lp *{box-sizing:border-box}
.lp .wrap{max-width:var(--lp-max);margin:0 auto;padding:0 24px}
.lp .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;letter-spacing:.01em;color:var(--brand-600);background:transparent;border:1px solid var(--brand-100);padding:7px 15px;border-radius:999px}
.lp .eyebrow::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 4px var(--brand-50);animation:lp-pulse 2s ease-in-out infinite}
@keyframes lp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.lp .sec-tag{font-size:11.5px;font-weight:850;letter-spacing:.16em;color:var(--brand-600);text-transform:uppercase}
.lp h2{font-size:clamp(27px,3.9vw,42px);font-weight:880;letter-spacing:-.04em;line-height:1.14;margin:14px 0 0}
.lp .lead{color:var(--text-2);font-size:clamp(14.5px,1.5vw,16.5px);line-height:1.72;margin:16px 0 0;max-width:640px}
.lp .hl{background:linear-gradient(120deg,#be5535,#e6915f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}

/* reveal + motion : visible by default; hidden only once JS marks .lp.anim */
[data-reveal]{transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.lp.anim [data-reveal]:not(.rvl){opacity:0;transform:translateY(28px)}
@media(prefers-reduced-motion:reduce){.lp.anim [data-reveal]:not(.rvl){opacity:1;transform:none}.lp *{animation:none!important;transition-duration:.001s!important}}

/* nav */
.lp-nav{position:sticky;top:0;z-index:50;background:rgba(247,245,242,.82);backdrop-filter:saturate(1.5) blur(12px);border-bottom:1px solid var(--border)}
.lp-nav .wrap{display:flex;align-items:center;height:66px;gap:16px}
.lp-brand{display:flex;align-items:center;gap:11px}
.lp-mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(140deg,#be5535,#e6915f);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(190,85,53,.32)}
.lp-brand b{font-weight:880;font-size:20px;letter-spacing:-.04em;display:block;line-height:1}
.lp-brand span{display:block;font-size:9px;letter-spacing:.14em;color:var(--text-3);font-weight:800;text-transform:uppercase;margin-top:3px}
.lp-nav .navlinks{display:flex;gap:2px;margin-left:20px}
.lp-nav .navlinks a{padding:8px 13px;border-radius:9px;font-size:13.5px;font-weight:650;color:var(--text-2);transition:.13s}
.lp-nav .navlinks a:hover{background:var(--surface-3);color:var(--text-1)}
.lp-nav .spacer{flex:1}
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:800;font-size:14px;padding:11px 19px;border-radius:12px;transition:.16s;border:1px solid transparent;white-space:nowrap}
.lp-btn.pri{background:linear-gradient(135deg,#e6915f,#be5535);color:#fff;box-shadow:0 10px 22px rgba(190,85,53,.32)}
.lp-btn.pri:hover{background:linear-gradient(135deg,#e0824c,#a8472b);transform:translateY(-2px);box-shadow:0 14px 30px rgba(190,85,53,.42)}
.lp-btn.ghost{background:#fff;color:var(--text-1);border-color:var(--border-strong);box-shadow:var(--sh-sm)}
.lp-btn.ghost:hover{background:var(--surface-2);border-color:var(--border-2);transform:translateY(-1px)}
.lp-btn.lg{padding:14px 27px;font-size:15px;border-radius:14px}
@media(max-width:760px){.lp-nav .navlinks{display:none}}

/* hero */
.lp-hero{padding:88px 0 46px;text-align:center;position:relative}
.lp-hero::before{content:'';position:absolute;left:50%;top:-160px;transform:translateX(-50%);width:1200px;height:620px;background:
  radial-gradient(closest-side at 50% 30%,rgba(230,145,95,.22),rgba(230,145,95,.08) 55%,transparent 72%);
  pointer-events:none;animation:lp-float 16s ease-in-out infinite alternate;z-index:0}
@keyframes lp-float{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(0,16px,0) scale(1.05)}}
.lp-hero .wrap{position:relative}
.lp-hero h1{font-size:clamp(33px,5vw,56px);font-weight:820;letter-spacing:-.035em;line-height:1.14;margin:22px auto 0;max-width:840px}
.lp-hero .lead{margin:22px auto 0;text-align:center}
.lp-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:32px}
.lp-chips{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;margin-top:28px}
.lp-chip{display:inline-flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:9px 15px;font-size:12.5px;font-weight:750;color:var(--text-2);box-shadow:var(--sh-sm)}
.lp-chip::before{content:'✓';color:var(--green);font-weight:900;font-size:11px}
.lp-chip b{color:var(--brand-600)}

/* hero product shot */
.lp-shot{margin:52px auto 0;max-width:1000px;position:relative}
.lp-shot::after{content:'';position:absolute;left:6%;right:6%;bottom:-26px;height:60px;background:radial-gradient(60% 100% at 50% 0,rgba(138,58,35,.22),transparent 70%);filter:blur(6px);z-index:-1}

/* channels strip */
.lp-strip{margin-top:52px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface-2)}
.lp-strip .wrap{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;padding:18px 24px}
.lp-strip .t{font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);margin-right:6px}
.lp-strip .c{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:750;color:var(--text-2)}
.lp-strip .c i{width:6px;height:6px;border-radius:50%;background:var(--brand);opacity:.7}

/* bands */
.lp-band{padding:82px 0}
.lp-band.tint{background:linear-gradient(180deg,var(--surface-2),var(--bg) 60%)}
.lp-band.grad{background:linear-gradient(150deg,#fbe7dc 0%,#faf1e9 45%,var(--bg) 100%)}
.lp-center{text-align:center;max-width:720px;margin:0 auto}
.lp-center .lead{margin-left:auto;margin-right:auto}

/* cards */
.lp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:46px}
.lp-card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:24px;box-shadow:var(--sh-sm);transition:transform .18s,box-shadow .18s,border-color .18s}
.lp-card:hover{transform:translateY(-4px);box-shadow:var(--sh-md);border-color:var(--brand-100)}
.lp-card .ic{width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:23px;background:linear-gradient(145deg,var(--brand-50),#fff);border:1px solid var(--brand-100);margin-bottom:15px;box-shadow:var(--sh-sm)}
.lp-card h3{font-size:17px;font-weight:820;letter-spacing:-.025em;margin:0}
.lp-card p{color:var(--text-2);font-size:13.5px;line-height:1.68;margin:9px 0 0}
@media(max-width:900px){.lp-grid{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.lp-grid{grid-template-columns:1fr}}

/* split (mockup + bullets) */
.lp-split{display:grid;grid-template-columns:1.08fr 1fr;gap:48px;align-items:center;margin-top:12px}
.lp-split.rev{grid-template-columns:1fr 1.08fr}
.lp-split .txt h2{margin-top:12px}
.lp-bullets{margin:22px 0 0;display:flex;flex-direction:column;gap:13px;padding:0}
.lp-bullets li{list-style:none;display:flex;gap:11px;align-items:flex-start;font-size:14px}
.lp-bullets li .ck{flex-shrink:0;width:22px;height:22px;border-radius:7px;background:var(--brand-50);color:var(--brand);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;margin-top:1px}
.lp-bullets li span{color:var(--text-2);font-weight:600;line-height:1.55}
@media(max-width:880px){.lp-split,.lp-split.rev{grid-template-columns:1fr;gap:30px}.lp-split.rev .visual{order:2}}

/* browser-window mock */
.mock{background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--sh-lg);overflow:hidden}
.lp-tbar{display:flex;align-items:center;gap:8px;padding:11px 15px;border-bottom:1px solid var(--border);background:var(--surface-2)}
.lp-tbar i{width:11px;height:11px;border-radius:50%;display:block;background:var(--border-strong)}
.lp-tbar i:nth-child(1){background:#e0625b}.lp-tbar i:nth-child(2){background:#e3ab3a}.lp-tbar i:nth-child(3){background:#3bb35a}
.lp-tbar span{margin-left:6px;font-size:11.5px;color:var(--text-3);font-weight:750}
.lp-tbar .url{margin-left:auto;font-size:10.5px;color:var(--text-3);font-weight:650;background:var(--surface-3);padding:3px 10px;border-radius:999px;white-space:nowrap;max-width:46%;overflow:hidden;text-overflow:ellipsis}
.mock .body{padding:16px}

/* avatars */
.lp-av{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0}
.lp-av.a1{background:linear-gradient(140deg,#be5535,#e6915f)}.lp-av.a2{background:linear-gradient(140deg,#7c4dff,#a98bff)}
.lp-av.a3{background:linear-gradient(140deg,#0e9bb8,#4bc6dd)}.lp-av.a4{background:linear-gradient(140deg,#15a34a,#54c47d)}

/* dashboard mock */
.dash .krow{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
.dash .lp-kpi{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:11px 12px}
.dash .lp-kpi .k{font-size:10px;color:var(--text-3);font-weight:750}
.dash .lp-kpi .v{font-size:21px;font-weight:880;letter-spacing:-.035em;margin-top:4px;line-height:1}
.dash .lp-kpi .d{font-size:9.5px;font-weight:800;margin-top:4px}
.dash .lp-kpi .d.up{color:var(--green)}.dash .lp-kpi .d.dn{color:var(--red)}
.dash .drow{display:grid;grid-template-columns:1.2fr 1fr;gap:10px;margin-top:10px}
.dash .lp-panel{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:13px}
.dash .lp-panel .pt{font-size:11px;font-weight:800;color:var(--text-2);letter-spacing:.01em;display:flex;justify-content:space-between;align-items:center}
.dash .lp-panel .pt em{font-size:9.5px;color:var(--text-3);font-style:normal;font-weight:700}
.dash .bars{display:flex;align-items:flex-end;gap:7px;height:70px;margin-top:12px}
.dash .bars .cb{flex:1;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#e6915f,#be5535);transform:scaleY(1);transform-origin:bottom;transition:transform .8s cubic-bezier(.2,.7,.2,1)}
.lp.anim .visual:not(.rvl) .dash .bars .cb{transform:scaleY(0)}
.dash .mrow{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px}
.dash .mrow:first-of-type{margin-top:12px}
.dash .mrow .lp-nm{color:var(--text-1);font-weight:650;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dash .tp{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:999px;white-space:nowrap}
.dash .tp.r{background:var(--red-50);color:var(--red)}.dash .tp.a{background:var(--amber-50);color:var(--amber)}.dash .tp.b{background:var(--brand-50);color:var(--brand-600)}
@media(max-width:520px){.dash .drow{grid-template-columns:1fr}.dash .krow{grid-template-columns:1fr 1fr}}

/* gantt mock */
.lp-gantt{position:relative}
.lp-gantt .scale{display:flex;justify-content:space-between;font-size:9.5px;font-weight:750;color:var(--text-3);padding:0 0 8px 118px;border-bottom:1px dashed var(--border-2);margin-bottom:10px}
.lp-gantt .today{position:absolute;top:22px;bottom:6px;width:2px;background:var(--red);opacity:.5;left:60%}
.lp-gantt .today::after{content:'TODAY';position:absolute;top:-2px;left:4px;font-size:7px;font-weight:800;color:var(--red);letter-spacing:.05em}
.lp-gantt .gr{display:flex;align-items:center;gap:10px;margin-top:11px;position:relative}
.lp-gantt .gr .lbl{width:100px;font-size:11.5px;font-weight:700;color:var(--text-2);flex-shrink:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-gantt .gr .track{flex:1;height:22px;background:var(--surface-3);border-radius:7px;position:relative}
.lp-gantt .gr .bar2{position:absolute;top:0;height:22px;border-radius:7px;background:linear-gradient(90deg,#be5535,#e6915f);transform:scaleX(1);transform-origin:left;transition:transform .9s cubic-bezier(.2,.7,.2,1);display:flex;align-items:center;padding:0 7px;gap:5px}
.lp.anim .visual:not(.rvl) .lp-gantt .gr .bar2{transform:scaleX(0)}
.lp-gantt .gr .bar2.b2{background:linear-gradient(90deg,#7c4dff,#a98bff)}
.lp-gantt .gr .bar2.b3{background:linear-gradient(90deg,#0e9bb8,#4bc6dd)}
.lp-gantt .gr .bar2.b4{background:linear-gradient(90deg,#15a34a,#54c47d)}
.lp-gantt .gr .bar2 .pct{font-size:9px;font-weight:800;color:#fff;opacity:.95}
.lp-gantt .ms{position:absolute;top:1px;width:14px;height:14px;background:var(--brand-700);transform:rotate(45deg);border-radius:3px;box-shadow:0 0 0 3px var(--surface)}
.lp-gantt .dep{position:absolute;height:2px;background:var(--text-4);opacity:.6}

/* workflow */
.lp-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:46px}
.flow-step{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:26px;box-shadow:var(--sh-sm);position:relative;overflow:hidden}
.flow-step::after{content:attr(data-big);position:absolute;right:14px;bottom:-16px;font-size:78px;font-weight:900;color:var(--brand-50);letter-spacing:-.05em;line-height:1;pointer-events:none}
.flow-step .no{position:relative;font-size:13px;font-weight:900;color:#fff;background:linear-gradient(140deg,#be5535,#e6915f);width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(190,85,53,.28)}
.flow-step h3{position:relative;font-size:18px;font-weight:840;margin:16px 0 0;letter-spacing:-.025em}
.flow-step p{position:relative;color:var(--text-2);font-size:13.5px;line-height:1.62;margin:9px 0 0}
@media(max-width:820px){.lp-flow{grid-template-columns:1fr}}

/* stats */
.lp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:46px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:26px 20px;text-align:center;box-shadow:var(--sh-sm)}
.stat .n{font-size:clamp(30px,4.2vw,44px);font-weight:900;letter-spacing:-.045em;background:linear-gradient(120deg,#be5535,#e6915f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.stat .l{font-size:13px;font-weight:780;color:var(--text-1);margin-top:12px}
.stat .s{font-size:11px;color:var(--text-3);margin-top:5px;font-weight:650}
.lp-note{text-align:center;font-size:11.5px;color:var(--text-3);margin-top:18px;font-weight:600}
@media(max-width:820px){.lp-stats{grid-template-columns:1fr 1fr}}

/* voices */
.lp-tg{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:46px}
.tcard{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:24px;box-shadow:var(--sh-sm);display:flex;flex-direction:column}
.tcard .stars{color:#e6915f;font-size:13px;letter-spacing:2px}
.tcard .q{font-size:14px;line-height:1.7;color:var(--text-1);font-weight:600;margin:14px 0 18px;flex:1}
.tcard .who{display:flex;align-items:center;gap:10px}
.tcard .who .lp-av{width:34px;height:34px;font-size:12px}
.tcard .who b{font-size:13px;font-weight:800;display:block}
.tcard .who span{font-size:11.5px;color:var(--text-3);font-weight:650}
@media(max-width:820px){.lp-tg{grid-template-columns:1fr}}

/* roles */
.lp-roles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:46px}
.role{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:22px;box-shadow:var(--sh-sm);transition:transform .18s,box-shadow .18s}
.role:hover{transform:translateY(-4px);box-shadow:var(--sh-md)}
.role .em{font-size:27px}
.role h4{font-size:15.5px;font-weight:840;margin:11px 0 0}
.role p{font-size:12.5px;color:var(--text-2);line-height:1.62;margin:7px 0 0}
@media(max-width:900px){.lp-roles{grid-template-columns:1fr 1fr}}

/* faq */
.lp-faq{max-width:800px;margin:42px auto 0}
.faq{background:var(--surface);border:1px solid var(--border);border-radius:15px;margin-top:11px;overflow:hidden;box-shadow:var(--sh-sm);transition:border-color .15s}
.faq[open]{border-color:var(--brand-100)}
.faq summary{list-style:none;cursor:pointer;padding:18px 22px;font-weight:780;font-size:15px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-size:22px;font-weight:500;color:var(--brand);transition:transform .22s;flex-shrink:0}
.faq[open] summary::after{transform:rotate(135deg)}
.faq .ans{padding:0 22px 19px;color:var(--text-2);font-size:13.5px;line-height:1.72}

/* final cta */
.lp-final{margin:90px auto;max-width:var(--lp-max)}
.lp-final .box{margin:0 24px;background:linear-gradient(135deg,#be5535 0%,#a8472b 55%,#8a3a23 100%);border-radius:26px;padding:66px 32px;text-align:center;color:#fff;box-shadow:0 30px 70px rgba(138,58,35,.36);position:relative;overflow:hidden}
.lp-final .box::before{content:'';position:absolute;inset:0;background:radial-gradient(460px 220px at 78% -10%,rgba(255,255,255,.2),transparent 66%)}
.lp-final .box::after{content:'';position:absolute;left:-40px;bottom:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.12),transparent 70%)}
.lp-final h2{color:#fff;position:relative;font-size:clamp(27px,4vw,42px)}
.lp-final p{color:rgba(255,255,255,.92);margin:16px auto 0;max-width:540px;position:relative;font-size:15.5px;line-height:1.6}
.lp-final .lp-cta{margin-top:30px;position:relative}
.lp-final .lp-btn.pri{background:#fff;color:var(--brand-700)}
.lp-final .lp-btn.pri:hover{background:#fff;transform:translateY(-2px);box-shadow:0 14px 30px rgba(0,0,0,.18)}
.lp-final .lp-btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}
.lp-final .lp-btn.ghost:hover{background:rgba(255,255,255,.14)}

/* footer */
.lp-foot{border-top:1px solid var(--border);padding:48px 0 42px;background:var(--surface-2)}
.lp-foot .wrap{display:flex;flex-wrap:wrap;gap:30px;justify-content:space-between}
.lp-foot .about{max-width:340px}
.lp-foot .about p{color:var(--text-2);font-size:13px;line-height:1.68;margin:13px 0 0}
.lp-foot .cols{display:flex;gap:56px;flex-wrap:wrap}
.lp-foot .col b{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--text-3);font-weight:850}
.lp-foot .col a{display:block;margin-top:12px;font-size:13.5px;color:var(--text-2);font-weight:650}
.lp-foot .col a:hover{color:var(--brand-600)}
.lp-copy{border-top:1px solid var(--border);margin-top:38px;padding-top:22px;font-size:12px;color:var(--text-3);font-weight:650}
`;

const Mark = () => (
  <div className="lp-mark">
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.95" />
      <rect x="14" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.55" />
      <rect x="3" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.55" />
      <rect x="14" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.95" />
    </svg>
  </div>
);

const DashMock = () => (
  <div className="mock">
    <div className="lp-tbar"><i /><i /><i /><span>PMS · 대시보드</span><em className="url">prism-pms · PRJ-0002 데이터 플랫폼</em></div>
    <div className="body dash">
      <div className="krow">
        <div className="lp-kpi"><div className="k">진행 프로젝트</div><div className="v"><span data-count="12">12</span></div><div className="d up">▲ 정상 9</div></div>
        <div className="lp-kpi"><div className="k">SPI · 일정</div><div className="v"><span data-count="1.04" data-dec="2">1.04</span></div><div className="d up">▲ 계획대비</div></div>
        <div className="lp-kpi"><div className="k">CPI · 비용</div><div className="v"><span data-count="0.97" data-dec="2">0.97</span></div><div className="d dn">▼ 주의 2</div></div>
        <div className="lp-kpi"><div className="k">평균 진척</div><div className="v"><span data-count="68" data-suffix="%">68%</span></div><div className="d up">▲ +5</div></div>
      </div>
      <div className="drow">
        <div className="lp-panel">
          <div className="pt">주간 진척 추이 <em>최근 7주</em></div>
          <div className="bars">
            {[38, 52, 46, 63, 58, 74, 82].map((h, i) => (<div className="cb" key={i} style={{ height: `${h}%`, transitionDelay: `${i * 0.06}s` }} />))}
          </div>
        </div>
        <div className="lp-panel">
          <div className="pt">마감 임박 · 결재</div>
          <div className="mrow"><span className="lp-av a1">아</span><span className="lp-nm">아키텍처 설계</span><span className="tp r">마감초과</span></div>
          <div className="mrow"><span className="lp-av a3">현</span><span className="lp-nm">현황분석</span><span className="tp a">D-5</span></div>
          <div className="mrow"><span className="lp-av a2">설</span><span className="lp-nm">설계서 검토</span><span className="tp b">결재대기</span></div>
        </div>
      </div>
    </div>
  </div>
);

const GanttMock = () => (
  <div className="mock">
    <div className="lp-tbar"><i /><i /><i /><span>PMS · 일정(간트)</span><em className="url">베이스라인 · 임계경로</em></div>
    <div className="body">
      <div className="lp-gantt">
        <div className="scale"><span>5월</span><span>6월</span><span>7월</span><span>8월</span></div>
        <div className="today" />
        <div className="gr"><div className="lbl">요구사항 정의</div><div className="track"><div className="bar2" style={{ left: '2%', width: '24%' }}><span className="lp-av a1" style={{ width: 14, height: 14, fontSize: 8 }}>김</span><span className="pct">100%</span></div></div></div>
        <div className="gr"><div className="lbl">설계</div><div className="track"><div className="bar2 b2" style={{ left: '20%', width: '28%' }}><span className="pct">90%</span></div><div className="ms" style={{ left: '48%' }} /></div></div>
        <div className="gr"><div className="lbl">개발 · 구현</div><div className="track"><div className="bar2 b3" style={{ left: '40%', width: '38%' }}><span className="lp-av a3" style={{ width: 14, height: 14, fontSize: 8 }}>이</span><span className="pct">62%</span></div></div></div>
        <div className="gr"><div className="lbl">테스트 · 검수</div><div className="track"><div className="bar2 b4" style={{ left: '70%', width: '26%' }}><span className="pct">10%</span></div></div></div>
      </div>
    </div>
  </div>
);

const channels = ['프로젝트·단계', '요구사항·RTM', '업무·WBS', '이슈·리스크', '산출물·결재', '테스트·품질'];

const benefits = [
  { ic: '🔎', t: '현황이 한눈에', d: '대시보드가 프로젝트·이슈·리스크·진척을 실시간 집계합니다. 흩어진 엑셀을 하나씩 열어볼 필요가 없습니다.' },
  { ic: '📉', t: '계획과 실적의 차이를 즉시', d: '공수 기반 EVM(SPI·CPI)이 일정·비용 편차를 자동 계산합니다. 지연을 느낌이 아니라 숫자로 먼저 봅니다.' },
  { ic: '🗂', t: '승인과 이력이 남습니다', d: '산출물 전자결재와 감사로그로 누가 언제 무엇을 승인·변경했는지 모두 기록되고 추적됩니다.' },
];

const caps = [
  { ic: '📁', t: '프로젝트 · 단계 관리', d: '프로젝트와 단계(Phase)를 색상·정렬로 구성하고, 사용 중인 단계는 삭제가드로 안전하게 보호합니다.' },
  { ic: '🔗', t: '요구사항 + RTM', d: '요구사항을 업무·테스트·산출물과 추적 매트릭스(RTM)로 양방향 연결해 누락과 공백을 드러냅니다.' },
  { ic: '📊', t: 'WBS 공수 · EVM', d: '계층형 WBS(1·1.1)와 공수로 PV·EV·AC를 계산하고, SPI·CPI로 성과를 정량 측정합니다.' },
  { ic: '📅', t: '인터랙티브 간트', d: '드래그·줌·의존선·마일스톤·임계경로·베이스라인·스와이레인을 실시간으로 다룹니다.' },
  { ic: '🐞', t: '이슈 · 리스크 · 테스트', d: '이슈/결함, 확률×영향 리스크, 개발→PL→PM 테스트 파이프라인을 하나의 흐름으로 관리합니다.' },
  { ic: '🖊', t: '산출물 · 결재 · 감사', d: '산출물 버전과 전자결재 경계, 전 작업 감사로그, 데이터 내보내기까지 규정과 품질을 함께 관리합니다.' },
];

const flow = [
  { n: '01', t: '계획', d: '프로젝트·단계·요구사항을 정의하고 WBS로 업무를 분해합니다. 베이스라인을 잡아 기준선을 고정합니다.' },
  { n: '02', t: '실행 · 추적', d: '간트·칸반·캘린더로 진행을 추적하고 이슈·리스크·테스트를 실시간 관리합니다. 내 작업과 업무부하가 자동 집계됩니다.' },
  { n: '03', t: '성과 · 정산', d: 'EVM(SPI·CPI)으로 성과를 측정하고 산출물을 전자결재로 확정합니다. 주간보고·엑셀 내보내기로 마무리합니다.' },
];

const diffs = [
  { ic: '🧬', tag: '요구사항 → 테스트 일관성', t: '한 줄로 이어지는 추적', d: 'RTM으로 요구사항·업무·테스트·산출물이 한 줄로 연결됩니다. 빠진 항목과 검증 공백이 표에서 그대로 드러납니다.' },
  { ic: '📐', tag: '공수 기반 정량관리', t: 'EVM으로 지연을 숫자로', d: '느낌이 아니라 SPI·CPI 숫자로 일정·비용을 관리합니다. 주간 추이 차트까지 자동으로 쌓입니다.' },
  { ic: '⚙️', tag: '실제로 돌아가는 운영', t: '무인 자동배포 · 자가정합', d: '멱등 스키마 자가정합과 무인 자동배포. 스키마가 바뀐 배포도 관리자 개입 없이 무중단으로 반영됩니다.' },
];

const voices = [
  { av: 'a1', ini: 'PM', q: '주간회의 전에 SPI·CPI만 보면 어디가 밀리는지 바로 나와요. 엑셀 취합 작업이 통째로 사라졌습니다.', who: 'PM', ctx: 'SI 구축 프로젝트' },
  { av: 'a3', ini: 'PL', q: '요구사항부터 테스트까지 RTM으로 이어져서, 빠진 항목이 표에 그대로 보여요. 검증 누락 걱정이 줄었습니다.', who: 'PL', ctx: '공공 정보화 사업' },
  { av: 'a2', ini: 'QA', q: '산출물 결재와 감사로그가 남아, 감리·품질 대응 자료를 따로 만들 필요가 없어졌어요.', who: 'PMO', ctx: '품질 · 감리' },
];

const roles = [
  { em: '🧭', t: 'PM', d: '대시보드에서 SPI·CPI·진척·리스크를 한눈에. 자원 배분과 결재를 한 화면에서 처리합니다.' },
  { em: '🛠️', t: 'PL', d: '팀 업무부하와 테스트 파이프라인을 관리하고, 요구사항–업무 연결을 검증합니다.' },
  { em: '👩‍💻', t: '실무자', d: '내 작업·스프린트·이슈에 집중. 인라인 편집과 ⌘K 전역검색으로 빠르게 움직입니다.' },
  { em: '📈', t: '경영진', d: '프로젝트 포트폴리오와 주간 추이를 요약 리포트·엑셀로 즉시 확인합니다.' },
];

const faqs = [
  { q: '어떤 규모의 팀에 맞나요?', a: '멀티테넌트(조직별 격리) 구조라 소규모 팀부터 여러 조직·프로젝트를 동시에 운영하는 기업까지 대응합니다. 역할 기반 권한(RBAC)으로 조직마다 접근 범위를 분리합니다.' },
  { q: '일반 이슈 트래커·보드 도구와 무엇이 다른가요?', a: '이슈 관리와 칸반뿐 아니라 요구사항 추적(RTM), 공수 기반 EVM 성과관리, 산출물 전자결재, 조달·인프라·방화벽까지 SI·공공 프로젝트에 필요한 관리 영역을 한 제품에 담았습니다.' },
  { q: 'EVM·간트 같은 고급 기능도 바로 쓸 수 있나요?', a: '네. 공수를 입력하면 PV·EV·AC와 SPI·CPI가 자동 계산되고, 의존성·베이스라인·임계경로를 갖춘 인터랙티브 간트가 즉시 동작합니다. 별도 설정 없이 기본 제공됩니다.' },
  { q: '스키마 변경이나 데이터 정합은 어떻게 되나요?', a: '배포 시 서버가 멱등 DDL로 스키마를 자동 정합합니다. 관리자가 별도 마이그레이션을 실행하지 않아도 스키마가 바뀐 배포까지 무중단으로 반영됩니다.' },
  { q: '모바일에서도 쓸 수 있나요?', a: '전 화면이 반응형이며 모바일은 하단 탭바·44px 터치 타깃·포커스링으로 최적화되어 있습니다. 앱 설치 없이 브라우저로 바로 사용합니다.' },
];

export default function LpClient() {
  useEffect(() => {
    const root = document.querySelector('.lp');
    root?.classList.add('anim');
    const vh = window.innerHeight || 800;
    const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.top < vh * 0.92 && r.bottom > 0; };

    const rio = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('rvl'); rio.unobserve(e.target); } }),
      { threshold: 0.14 }
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => { if (inView(el)) el.classList.add('rvl'); else rio.observe(el); });
    const failsafe = window.setTimeout(() => {
      document.querySelectorAll('[data-reveal]:not(.rvl)').forEach((el) => { if (el.getBoundingClientRect().top < vh) el.classList.add('rvl'); });
    }, 2600);

    const cio = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        const target = parseFloat(el.dataset.count || '0');
        const dec = parseInt(el.dataset.dec || '0', 10);
        const suffix = el.dataset.suffix || '';
        const dur = 1500; const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (target * eased).toFixed(dec) + suffix;
          if (p < 1) requestAnimationFrame(tick); else el.textContent = target.toFixed(dec) + suffix;
        };
        requestAnimationFrame(tick);
        cio.unobserve(el);
      }),
      { threshold: 0.6 }
    );
    document.querySelectorAll('[data-count]').forEach((el) => cio.observe(el));

    return () => { rio.disconnect(); cio.disconnect(); window.clearTimeout(failsafe); };
  }, []);

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <nav className="lp-nav">
        <div className="wrap">
          <Link href="/dashboard" className="lp-brand" aria-label="홈으로">
            <Mark />
            <div><b>PMS</b><span>Project Management</span></div>
          </Link>
          <div className="navlinks">
            <a href="#why">도입 이유</a>
            <a href="#features">핵심 기능</a>
            <a href="#flow">진행 방식</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="spacer" />
          <Link href="/login" className="lp-btn ghost">로그인</Link>
          <Link href="/dashboard" className="lp-btn pri">데모 둘러보기</Link>
        </div>
      </nav>

      <section className="lp-hero">
        <div className="wrap">
          <span className="eyebrow" data-reveal>프로젝트 관리 통합 플랫폼</span>
          <h1 data-reveal style={{ transitionDelay: '.05s' }}>
            계획부터 정산까지,<br /><span className="hl">하나의 화면</span>에서 관리합니다
          </h1>
          <p className="lead" data-reveal style={{ transitionDelay: '.1s' }}>
            일정이 밀려도, 요구사항이 바뀌어도 놓치지 않습니다. PMS는 프로젝트·요구사항·업무·이슈·산출물을
            하나로 잇고, 계획과 실적의 차이를 성과지표로 먼저 보여주는 프로젝트 관리 플랫폼입니다.
          </p>
          <div className="lp-cta" data-reveal style={{ transitionDelay: '.15s' }}>
            <Link href="/dashboard" className="lp-btn pri lg">데모 둘러보기 →</Link>
            <Link href="/login" className="lp-btn ghost lg">로그인</Link>
          </div>
          <div className="lp-chips" data-reveal style={{ transitionDelay: '.2s' }}>
            <span className="lp-chip"><b>WBS·간트</b> 내장</span>
            <span className="lp-chip"><b>EVM</b> 성과관리</span>
            <span className="lp-chip"><b>요구사항 추적</b> RTM</span>
            <span className="lp-chip"><b>전자결재</b>·감사로그</span>
          </div>
          <div className="lp-shot visual" data-reveal style={{ transitionDelay: '.25s' }}>
            <DashMock />
          </div>
        </div>
        <div className="lp-strip" data-reveal>
          <div className="wrap">
            <span className="t">한 곳에서 관리되는 영역</span>
            {channels.map((c) => (<span className="c" key={c}><i />{c}</span>))}
          </div>
        </div>
      </section>

      <section className="lp-band" id="why">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">Why PMS</span>
            <h2>관리 도구는 늘어나는데,<br /><span className="hl">현황은 흩어집니다</span></h2>
            <p className="lead">엑셀·이슈트래커·간트툴·결재 시스템을 오가며 취합하지 마세요. 프로젝트의 모든 정보를 한 곳에 모으고, 필요한 답은 지표로 바로 확인합니다.</p>
          </div>
          <div className="lp-grid">
            {benefits.map((b, i) => (
              <div className="lp-card" key={b.t} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className="ic">{b.ic}</div><h3>{b.t}</h3><p>{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band grad" id="features">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">Core Capabilities</span>
            <h2>프로젝트의 처음부터 끝까지,<br /><span className="hl">한 플랫폼에서</span></h2>
            <p className="lead">계획하고, 실행하고, 추적하고, 검증하고, 정산합니다. 흩어진 솔루션 대신 하나로 연결된 관리 스택.</p>
          </div>
          <div className="lp-grid">
            {caps.map((f, i) => (
              <div className="lp-card" key={f.t} data-reveal style={{ transitionDelay: `${(i % 3) * 0.08}s` }}>
                <div className="ic">{f.ic}</div><h3>{f.t}</h3><p>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band">
        <div className="wrap">
          <div className="lp-split">
            <div className="visual" data-reveal><GanttMock /></div>
            <div className="txt" data-reveal style={{ transitionDelay: '.08s' }}>
              <span className="sec-tag">Schedule</span>
              <h2>일정과 의존관계를,<br /><span className="hl">한눈에</span></h2>
              <ul className="lp-bullets">
                <li><span className="ck">✓</span><span>드래그로 기간을 조정하면 의존선이 자동으로 재계산됩니다.</span></li>
                <li><span className="ck">✓</span><span>베이스라인 대비 편차와 임계경로를 색으로 즉시 구분합니다.</span></li>
                <li><span className="ck">✓</span><span>마일스톤·스와이레인으로 큰 그림과 세부 일정을 함께 봅니다.</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-band tint">
        <div className="wrap">
          <div className="lp-split rev">
            <div className="txt" data-reveal>
              <span className="sec-tag">Dashboard</span>
              <h2>프로젝트 현황을,<br /><span className="hl">실시간으로</span></h2>
              <ul className="lp-bullets">
                <li><span className="ck">✓</span><span>프로젝트·이슈·리스크·진척을 실시간으로 집계합니다.</span></li>
                <li><span className="ck">✓</span><span>SPI·CPI 성과지표와 상태·유형 분포를 차트로 봅니다.</span></li>
                <li><span className="ck">✓</span><span>내 작업·마감 임박·결재 대기를 한 곳에서 처리합니다.</span></li>
              </ul>
            </div>
            <div className="visual" data-reveal style={{ transitionDelay: '.08s' }}><DashMock /></div>
          </div>
        </div>
      </section>

      <section className="lp-band" id="flow">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">How it works</span>
            <h2>계획 · 실행 · 성과,<br /><span className="hl">끊김 없이</span></h2>
            <p className="lead">기준선을 잡고, 실시간으로 추적하고, 정량 지표로 마무리합니다. 담당자는 한 곳에서 프로젝트 전 과정을 운영합니다.</p>
          </div>
          <div className="lp-flow">
            {flow.map((s, i) => (
              <div className="flow-step" key={s.n} data-big={s.n} data-reveal style={{ transitionDelay: `${i * 0.1}s` }}>
                <div className="no">{s.n}</div><h3>{s.t}</h3><p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band grad">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">Why it's different</span>
            <h2>다른 관리 도구와<br /><span className="hl">다른 세 가지</span></h2>
            <p className="lead">아이디어가 아니라, 이미 현장에서 돌아가는 추적·성과·운영 기술이 PMS의 차이입니다.</p>
          </div>
          <div className="lp-grid">
            {diffs.map((d, i) => (
              <div className="lp-card" key={d.t} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className="ic">{d.ic}</div>
                <div className="sec-tag" style={{ fontSize: 10.5 }}>{d.tag}</div>
                <h3 style={{ marginTop: 6 }}>{d.t}</h3><p>{d.d}</p>
              </div>
            ))}
          </div>
          <div className="lp-stats">
            <div className="stat" data-reveal><div className="n"><span data-count="15" data-suffix="+">15+</span></div><div className="l">통합 관리 영역</div><div className="s">프로젝트 ~ 조달까지</div></div>
            <div className="stat" data-reveal style={{ transitionDelay: '.08s' }}><div className="n"><span data-count="130" data-suffix="ms">130ms</span></div><div className="l">Warm 평균 응답</div><div className="s">sin1 리전 · 핵심 인덱스</div></div>
            <div className="stat" data-reveal style={{ transitionDelay: '.16s' }}><div className="n">24/7</div><div className="l">무중단 자동 운영</div><div className="s">멱등 마이그레이션 · 자동배포</div></div>
            <div className="stat" data-reveal style={{ transitionDelay: '.24s' }}><div className="n"><span data-count="100" data-suffix="%">100%</span></div><div className="l">반응형 · 모바일 대응</div><div className="s">하단탭바 · 44px 터치</div></div>
          </div>
          <p className="lp-note">※ 수치는 운영 환경·설정 기준의 참고값입니다.</p>
        </div>
      </section>

      <section className="lp-band">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">Voices</span>
            <h2>현장의 목소리로,<br /><span className="hl">달라진 것</span></h2>
            <p className="lead">프로젝트를 운영하는 사람들이 PMS로 바뀐 점을 정리했습니다.</p>
          </div>
          <div className="lp-tg">
            {voices.map((v, i) => (
              <div className="tcard" key={v.who} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className="stars">★★★★★</div>
                <div className="q">“{v.q}”</div>
                <div className="who"><span className={`lp-av ${v.av}`}>{v.ini}</span><div><b>{v.who}</b><span>{v.ctx}</span></div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band tint">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">For every role</span>
            <h2>모든 역할이,<br /><span className="hl">각자의 화면</span>에서</h2>
            <p className="lead">PM부터 실무자, 경영진까지. 역할에 맞는 뷰와 권한으로 필요한 정보만 정확히 봅니다.</p>
          </div>
          <div className="lp-roles">
            {roles.map((r, i) => (
              <div className="role" key={r.t} data-reveal style={{ transitionDelay: `${i * 0.07}s` }}>
                <div className="em">{r.em}</div><h4>{r.t}</h4><p>{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band grad" id="faq">
        <div className="wrap">
          <div className="lp-center" data-reveal>
            <span className="sec-tag">FAQ</span>
            <h2>궁금한 점,<br /><span className="hl">먼저 답해드려요</span></h2>
          </div>
          <div className="lp-faq" data-reveal>
            {faqs.map((f) => (
              <details className="faq" key={f.q}>
                <summary>{f.q}</summary>
                <div className="ans">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="box" data-reveal>
          <h2>오늘, 프로젝트를 한 곳으로 모으세요</h2>
          <p>설치도 계약도 필요 없습니다. 데모에서 실제 화면을 보고 전체 기능을 바로 둘러보세요.</p>
          <div className="lp-cta">
            <Link href="/dashboard" className="lp-btn pri lg">데모 둘러보기 →</Link>
            <Link href="/login" className="lp-btn ghost lg">로그인</Link>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="wrap">
          <div className="about">
            <div className="lp-brand"><Mark /><div><b>PMS</b><span>Project Management</span></div></div>
            <p>계획·실행·성과를 잇는 프로젝트 관리 플랫폼. WBS·간트·EVM·RTM·전자결재를 한 화면에서 관리합니다.</p>
          </div>
          <div className="cols">
            <div className="col">
              <b>제품</b>
              <a href="#why">도입 이유</a>
              <a href="#features">핵심 기능</a>
              <a href="#flow">진행 방식</a>
            </div>
            <div className="col">
              <b>바로가기</b>
              <Link href="/dashboard">대시보드</Link>
              <Link href="/login">로그인</Link>
              <a href="#faq">자주 묻는 질문</a>
            </div>
          </div>
        </div>
        <div className="wrap"><div className="lp-copy">© 2026 PMS · 운영 주식회사 고원(GOWON) · Project Management Platform</div></div>
      </footer>
    </div>
  );
}
