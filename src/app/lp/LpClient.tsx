'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileSearch, Compass, FileText, ShieldCheck, LayoutDashboard, TrendingUp, Layers, ScanSearch, FileCheck2,
  GitBranch, CalendarRange, Bug, Stamp, ListTree, Gauge, Users, Briefcase, BarChart3, ArrowRight, Check,
  Workflow, History, Smartphone, Server, Target, ClipboardCheck, Lock, Play,
} from 'lucide-react';

/**
 * 소개 페이지 — 2026-10-29 개편(사용자: "전문 PM 이 쓴 문구, 가운데 점과 AI 같은 표현 제거, 가독성·디자인 품질,
 * 경쟁사 벤치마킹, 막대그래프와 '아·현·설' 같은 글자 표시는 아이콘으로, 움직이는 인포그래픽").
 * 참고한 구성: Jira·Asana·monday.com·Linear·플로우의 공개 소개 페이지 — 첫 화면 제품 화면, 업무 흐름 그림, 역할별 화면, 보안·운영, 자주 묻는 질문.
 *
 * 문구 원칙(그대로 유지): 기능 서술만 쓴다. 성과·정확도 수치를 넣지 않는다 — 제안 서비스는 아직 출력 품질을 실측하지 않았다.
 * 화면 예시의 숫자는 모두 "데모 화면" 표기를 붙인다.
 */

const css = `
.lp{--ink:#111A2C;--ink-2:#3D4A5C;--ink-3:#66748A;--line:#E3E7ED;--soft:#F4F6F9;--brand:#2457C5;--brand-d:#173C8F;--brand-l:#EAF0FC;--teal:#0E9BB8;--ok:#15A34A;--warn:#D97A06;--risk:#D9394B;
  --max:1160px;--sh-1:0 1px 2px rgba(17,26,44,.05),0 6px 18px rgba(17,26,44,.06);--sh-2:0 18px 48px rgba(17,26,44,.12);
  color:var(--ink);background:#F7F8FA;overflow-x:hidden;word-break:keep-all;-webkit-font-smoothing:antialiased}
.lp *{box-sizing:border-box}
.lp .wrap{max-width:var(--max);margin:0 auto;padding:0 24px}
.lp .num{font-variant-numeric:tabular-nums}
.lp .kicker{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.02em;color:var(--brand-d)}
.lp .kicker::before{content:'';width:18px;height:2px;border-radius:2px;background:var(--brand)}
.lp h2{font-size:clamp(27px,3.4vw,40px);font-weight:800;letter-spacing:-.035em;line-height:1.28;margin:14px 0 0;text-wrap:balance}
.lp .lead{color:var(--ink-2);font-size:clamp(15px,1.4vw,17px);line-height:1.85;margin:18px 0 0;max-width:62ch}
.lp .center{text-align:center}.lp .center .lead{margin-left:auto;margin-right:auto}
.lp .accent{color:var(--brand)}
.lp section{padding:104px 0}
.lp section[id]{scroll-margin-top:76px}
.lp .band-soft{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}

/* 나타남 — 기본은 보임, 스크립트가 .anim 을 붙인 뒤에만 숨겼다가 보인다 */
.lp [data-reveal]{transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
.lp.anim [data-reveal]:not(.rvl){opacity:0;transform:translateY(24px)}

/* 버튼 */
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:14.5px;padding:12px 20px;border-radius:10px;transition:transform .16s,box-shadow .16s,background .16s;border:1px solid transparent;white-space:nowrap;cursor:pointer;font-family:inherit}
.lp-btn.pri{background:var(--brand);color:#fff;box-shadow:0 8px 20px rgba(36,87,197,.28)}
.lp-btn.pri:hover{background:var(--brand-d);transform:translateY(-1px);box-shadow:0 12px 26px rgba(36,87,197,.36)}
.lp-btn.line{background:#fff;color:var(--ink);border-color:#CDD4DD}
.lp-btn.line:hover{border-color:var(--ink-3);transform:translateY(-1px)}
.lp-btn.lg{padding:15px 26px;font-size:15.5px;border-radius:12px}
.lp-btn:focus-visible,.lp a:focus-visible,.lp summary:focus-visible{outline:3px solid rgba(36,87,197,.45);outline-offset:2px}
.lp-btn[disabled]{opacity:.7;cursor:progress}

/* 상단 */
.lp-nav{position:sticky;top:0;z-index:50;background:rgba(247,248,250,.86);backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line)}
.lp-nav .wrap{display:flex;align-items:center;height:64px;gap:14px}
.lp-brand{display:flex;align-items:center;gap:11px;color:inherit;text-decoration:none}
.lp-mark{width:36px;height:36px;border-radius:10px;background:var(--brand);display:flex;align-items:center;justify-content:center}
.lp-brand b{font-weight:800;font-size:18px;letter-spacing:-.03em;display:block;line-height:1.1}
.lp-brand span{display:block;font-size:10px;letter-spacing:.12em;color:var(--ink-3);font-weight:700;text-transform:uppercase;margin-top:3px}
.lp-nav .links{display:flex;gap:2px;margin-left:18px}
.lp-nav .links a{padding:8px 12px;border-radius:8px;font-size:14px;font-weight:600;color:var(--ink-2);text-decoration:none}
.lp-nav .links a:hover{background:#EDF0F4;color:var(--ink)}
.lp-nav .sp{flex:1}
@media(max-width:860px){.lp-nav .links{display:none}}
@media(max-width:520px){.lp-nav .lp-btn.line{display:none}}

/* 첫 화면 */
.lp-hero{padding:88px 0 0;position:relative;overflow:hidden}
.lp-hero::before{content:'';position:absolute;inset:0;background:radial-gradient(900px 420px at 50% -40px,rgba(36,87,197,.13),transparent 70%);pointer-events:none}
.lp-hero::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(17,26,44,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(17,26,44,.045) 1px,transparent 1px);background-size:44px 44px;-webkit-mask:radial-gradient(760px 380px at 50% 0,#000,transparent 78%);mask:radial-gradient(760px 380px at 50% 0,#000,transparent 78%);pointer-events:none}
.lp-hero .wrap{position:relative;z-index:1;text-align:center}
.lp-hero h1{font-size:clamp(34px,5vw,56px);font-weight:800;letter-spacing:-.04em;line-height:1.22;margin:22px auto 0;max-width:900px;text-wrap:balance}
.lp-hero .lead{margin:22px auto 0;font-size:clamp(15.5px,1.5vw,18px)}
.lp-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.lp-trust{display:flex;gap:10px 22px;justify-content:center;flex-wrap:wrap;margin-top:30px;color:var(--ink-2);font-size:14px;font-weight:600}
.lp-trust span{display:inline-flex;align-items:center;gap:7px}
.lp-trust svg{color:var(--brand)}

/* 제품 화면(데모) */
.lp-shot{margin:56px auto 0;max-width:1040px;position:relative}
.mock{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:var(--sh-2);overflow:hidden;text-align:left}
.mock .tbar{display:flex;align-items:center;gap:7px;padding:11px 16px;border-bottom:1px solid var(--line);background:#FBFCFD;font-size:12.5px;color:var(--ink-3);font-weight:600}
.mock .tbar i{width:10px;height:10px;border-radius:50%;background:#E2E6EC}
.mock .tbar b{margin-left:8px;color:var(--ink-2);font-weight:700}
.mock .tbar em{margin-left:auto;font-style:normal;font-size:11.5px;background:var(--soft);border:1px solid var(--line);padding:3px 9px;border-radius:999px}
.mock .body{padding:20px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px}
.kpi .k{font-size:12px;color:var(--ink-3);font-weight:600}
.kpi .v{font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
.kpi .d{font-size:11.5px;font-weight:700;margin-top:2px}
.kpi .d.ok{color:var(--ok)}.kpi .d.warn{color:var(--warn)}
.ring{width:46px;height:46px;flex:none;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:5}
.ring .bg{stroke:#EDF0F4}
.ring .fg{stroke-linecap:round;stroke-dasharray:113.1;stroke-dashoffset:113.1;transition:stroke-dashoffset 1.6s cubic-bezier(.2,.7,.2,1) .2s}
.rvl .ring .fg,.lp:not(.anim) .ring .fg{stroke-dashoffset:var(--off)}
.drow{display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:12px}
.panel{border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.panel .pt{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;color:var(--ink)}
.panel .pt em{font-style:normal;font-size:11.5px;color:var(--ink-3);font-weight:600}
.legend{display:flex;gap:14px;font-size:11.5px;color:var(--ink-3);font-weight:600;margin-top:8px}
.legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:5px;vertical-align:middle}
.chart{width:100%;height:150px;margin-top:6px;display:block}
.chart .grid line{stroke:#EEF1F5;stroke-width:1}
.chart .plan{fill:none;stroke:#AEB9C8;stroke-width:2;stroke-dasharray:5 5}
.chart .act{fill:none;stroke:var(--brand);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:600;stroke-dashoffset:600;transition:stroke-dashoffset 1.8s cubic-bezier(.3,.6,.2,1) .3s}
.chart .area{opacity:0;transition:opacity 1s ease 1.2s}
.chart .dot{fill:#fff;stroke:var(--brand);stroke-width:2.6;opacity:0;transition:opacity .4s ease 1.9s}
.chart .dotpulse{fill:var(--brand);opacity:0;transform-origin:center;transform-box:fill-box}
.rvl .chart .act,.lp:not(.anim) .chart .act{stroke-dashoffset:0}
.rvl .chart .area,.rvl .chart .dot,.lp:not(.anim) .chart .area,.lp:not(.anim) .chart .dot{opacity:1}
.rvl .chart .dotpulse{animation:lp-ping 2.4s ease-out 2s infinite}
@keyframes lp-ping{0%{opacity:.35;transform:scale(1)}100%{opacity:0;transform:scale(3.2)}}
.task{display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid #F0F2F5}
.task:first-of-type{border-top:0;margin-top:6px}
.task .ti{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none}
.task .ti.t1{background:#EAF0FC;color:var(--brand)}.task .ti.t2{background:#E6F6FA;color:var(--teal)}.task .ti.t3{background:#F0ECFF;color:#6A4BD8}
.task .tn{flex:1;min-width:0}
.task .tn b{display:block;font-size:13px;font-weight:700}
.task .tn span{display:block;font-size:11.5px;color:var(--ink-3);margin-top:1px}
.tag{font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;white-space:nowrap}
.tag.r{background:#FDEDEF;color:var(--risk)}.tag.a{background:#FDF3E3;color:var(--warn)}.tag.b{background:var(--brand-l);color:var(--brand-d)}
.float{position:absolute;z-index:2;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh-1);padding:11px 14px;display:flex;align-items:center;gap:10px;font-size:12.5px;animation:lp-bob 6s ease-in-out infinite}
.float b{display:block;font-size:13px}.float span{color:var(--ink-3)}
.float .fi{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.float.f1{left:-40px;bottom:36px}.float.f2{right:-32px;top:-24px;animation-delay:-3s}
@keyframes lp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@media(max-width:1100px){.float{display:none}}
@media(max-width:760px){.kpis{grid-template-columns:repeat(2,1fr)}.drow{grid-template-columns:1fr}}
@media(max-width:520px){.kpi{padding:12px;gap:9px}.kpi .ring{width:34px;height:34px}.kpi .v{font-size:19px}.kpi .k{font-size:11.5px}.mock .body{padding:14px}}

/* 관리 영역 띠 */
.lp-strip{margin-top:72px;border-top:1px solid var(--line);background:#fff}
.lp-strip .wrap{display:flex;align-items:center;gap:10px 28px;flex-wrap:wrap;justify-content:center;padding-top:22px;padding-bottom:22px}
.lp-strip .t{font-size:13px;font-weight:700;color:var(--ink-3)}
.lp-strip .c{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:650;color:var(--ink-2)}
.lp-strip .c svg{color:var(--brand)}

/* 생애주기 그림 */
.life{position:relative;margin-top:60px}
.life .rail{position:absolute;left:8.3%;right:8.3%;top:35px;height:3px;background:#E3E7ED;border-radius:3px;overflow:hidden}
.life .rail i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--brand),var(--teal));transition:width 2.2s cubic-bezier(.3,.6,.2,1) .2s}
.life.rvl .rail i,.lp:not(.anim) .life .rail i{width:100%}
.life .nodes{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;position:relative}
.node{display:flex;flex-direction:column;align-items:center;text-align:center;color:inherit;text-decoration:none;padding:0 4px}
.node .ni{width:72px;height:72px;border-radius:20px;background:#fff;border:1px solid var(--line);box-shadow:var(--sh-1);display:flex;align-items:center;justify-content:center;color:var(--brand);transition:transform .25s,box-shadow .25s,border-color .25s;transform:scale(.7);opacity:0}
.life.rvl .node .ni,.lp:not(.anim) .node .ni{transform:scale(1);opacity:1;transition:transform .6s cubic-bezier(.3,1.5,.5,1) var(--d),opacity .4s ease var(--d),box-shadow .25s,border-color .25s}
.node:hover .ni{border-color:var(--brand);box-shadow:0 10px 26px rgba(36,87,197,.18)}
.node .stage{font-size:11.5px;font-weight:700;color:var(--ink-3);margin-top:16px;letter-spacing:.04em}
.node h3{font-size:16px;font-weight:800;margin:4px 0 0;letter-spacing:-.02em}
.node p{font-size:13.5px;line-height:1.7;color:var(--ink-2);margin:8px 0 0}
.node .go{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;color:var(--brand);margin-top:10px;opacity:0;transform:translateY(4px);transition:.2s}
.node:hover .go,.node:focus-visible .go{opacity:1;transform:none}
@media(max-width:980px){.life .rail{display:none}.life .nodes{grid-template-columns:repeat(3,1fr);row-gap:40px}}
@media(max-width:560px){.life .nodes{grid-template-columns:repeat(2,1fr)}}

/* 카드 */
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:52px}
@media(max-width:900px){.grid3{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.grid3{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px 26px;transition:transform .25s,box-shadow .25s,border-color .25s}
.card:hover{transform:translateY(-3px);box-shadow:var(--sh-1);border-color:#D2D9E2}
.card .ci{width:44px;height:44px;border-radius:12px;background:var(--brand-l);color:var(--brand);display:flex;align-items:center;justify-content:center}
.card .lbl{font-size:12px;font-weight:700;color:var(--brand-d);margin-top:20px;letter-spacing:.02em}
.card h3{font-size:18px;font-weight:800;letter-spacing:-.025em;line-height:1.4;margin:8px 0 0}
.card .lbl+h3{margin-top:6px}
.card .ci+h3{margin-top:20px}
.card p{font-size:14.5px;line-height:1.8;color:var(--ink-2);margin:10px 0 0}

/* 문제 → 해결 */
.pains{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:52px}
@media(max-width:900px){.pains{grid-template-columns:1fr}}
.pain{background:#fff;border:1px solid var(--line);border-radius:16px;padding:26px;display:flex;flex-direction:column;gap:14px}
.pain .before{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.7;color:var(--ink-3)}
.pain .before b{flex:none;font-size:11.5px;font-weight:700;color:var(--risk);background:#FDEDEF;border-radius:6px;padding:2px 7px;margin-top:2px}
.pain .arrow{height:1px;background:var(--line);position:relative}
.pain .arrow::after{content:'';position:absolute;left:0;top:-1px;height:3px;width:0;background:var(--brand);border-radius:3px;transition:width 1.2s ease .4s}
.pain.rvl .arrow::after,.lp:not(.anim) .pain .arrow::after{width:100%}
.pain .after h3{font-size:17.5px;font-weight:800;letter-spacing:-.02em;margin:0;line-height:1.45}
.pain .after p{font-size:14.5px;line-height:1.8;color:var(--ink-2);margin:8px 0 0}

/* 좌우 배치 */
.split{display:grid;grid-template-columns:1.1fr 1fr;gap:64px;align-items:center}
.split.rev .txt{order:-1}
@media(max-width:900px){.split{grid-template-columns:1fr;gap:36px}.split.rev .txt{order:0}}
.ticks{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:14px}
.ticks li{display:flex;gap:12px;font-size:15px;line-height:1.75;color:var(--ink-2)}
.ticks li .ck{flex:none;width:22px;height:22px;border-radius:50%;background:var(--brand-l);color:var(--brand);display:flex;align-items:center;justify-content:center;margin-top:2px}
.ticks li b{color:var(--ink)}

/* 간트 */
.gantt{position:relative;padding:6px 0 4px}
.gantt .scale{display:grid;grid-template-columns:120px repeat(4,1fr);font-size:11.5px;color:var(--ink-3);font-weight:700;padding-bottom:8px;border-bottom:1px solid var(--line)}
.gantt .scale span:first-child{color:transparent}
.gr{display:grid;grid-template-columns:120px 1fr;align-items:center;height:46px;border-bottom:1px dashed #EEF1F5}
.gr .lb{font-size:12.5px;font-weight:700;color:var(--ink-2);display:flex;align-items:center;gap:7px}
.gr .lb svg{color:var(--ink-3)}
.gr .tr{position:relative;height:100%}
.gbar{position:absolute;top:13px;height:20px;border-radius:6px;background:var(--brand);transform-origin:left center;transform:scaleX(0);transition:transform 1.1s cubic-bezier(.3,.6,.2,1) var(--d);display:flex;align-items:center;justify-content:flex-end;padding-right:7px;color:#fff;font-size:10.5px;font-weight:700}
.gbar.base{background:transparent;border:1.5px dashed #B9C3D1;top:9px;height:28px;transform:none;transition:none}
.gbar.c2{background:#4A78DA}.gbar.c3{background:var(--teal)}.gbar.c4{background:#9AA8BC}
.rvl .gbar,.lp:not(.anim) .gbar{transform:scaleX(1)}
.ms{position:absolute;top:16px;width:13px;height:13px;background:var(--warn);transform:rotate(45deg);border-radius:2px;margin-left:-6px}
.today{position:absolute;top:0;bottom:0;left:calc(120px + (100% - 120px) * .58);width:2px;background:var(--risk);opacity:.75}
.today::before{content:'오늘';position:absolute;top:-2px;left:6px;font-size:10.5px;font-weight:700;color:var(--risk)}
.crit{position:absolute;height:2px;background:var(--risk);top:23px;opacity:.5}

/* 진행 방식 */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:56px;position:relative}
@media(max-width:900px){.steps{grid-template-columns:1fr}}
.step{background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px 26px;position:relative;overflow:hidden}
.step .sh{display:flex;align-items:center;gap:12px}
.step .si{width:44px;height:44px;border-radius:12px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center}
.step .sn{font-size:12px;font-weight:700;color:var(--ink-3)}
.step h3{font-size:18px;font-weight:800;margin:2px 0 0;letter-spacing:-.02em}
.step p{font-size:14.5px;line-height:1.8;color:var(--ink-2);margin:16px 0 0}
.step .out{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
.step .out span{font-size:12px;font-weight:650;color:var(--ink-2);background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:4px 10px}
.step .bar{position:absolute;left:0;top:0;height:3px;width:0;background:var(--brand);transition:width 1s ease var(--d)}
.step.rvl .bar,.lp:not(.anim) .step .bar{width:100%}

/* 운영·보안 */
.ops{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:52px}
@media(max-width:900px){.ops{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.ops{grid-template-columns:1fr}}
.op{border:1px solid var(--line);border-radius:14px;padding:22px;background:#fff}
.op .oi{color:var(--brand)}
.op h4{font-size:15.5px;font-weight:800;margin:14px 0 0}
.op p{font-size:13.5px;line-height:1.75;color:var(--ink-2);margin:8px 0 0}
.lp-note{font-size:12.5px;color:var(--ink-3);text-align:center;margin-top:26px;line-height:1.7}

/* 역할 */
.roles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:52px}
@media(max-width:900px){.roles{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.roles{grid-template-columns:1fr}}
.role{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px}
.role .ri{width:40px;height:40px;border-radius:11px;background:var(--soft);color:var(--ink);display:flex;align-items:center;justify-content:center}
.role h4{font-size:16px;font-weight:800;margin:16px 0 0}
.role p{font-size:14px;line-height:1.75;color:var(--ink-2);margin:8px 0 0}

/* 자주 묻는 질문 */
.faq{max-width:820px;margin:44px auto 0;display:grid;gap:10px}
.faq details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:0 22px;transition:border-color .2s}
.faq details[open]{border-color:#C9D3E0}
.faq summary{list-style:none;cursor:pointer;padding:20px 0;font-size:15.5px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:16px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'';width:9px;height:9px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);transform:rotate(45deg);transition:transform .2s;flex:none;margin-top:-4px}
.faq details[open] summary::after{transform:rotate(-135deg);margin-top:4px}
.faq .ans{font-size:14.5px;line-height:1.85;color:var(--ink-2);padding:0 0 22px}

/* 마무리 */
.final{padding:0 0 104px}
.final .box{max-width:var(--max);margin:0 auto;border-radius:22px;background:var(--ink);color:#fff;padding:64px 32px;text-align:center;position:relative;overflow:hidden}
.final .box::before{content:'';position:absolute;inset:0;background:radial-gradient(600px 260px at 50% 0,rgba(74,120,218,.35),transparent 70%)}
.final .box>*{position:relative}
.final h2{color:#fff;margin:0}
.final p{color:#C5CEDB;font-size:16px;line-height:1.8;margin:16px auto 0;max-width:56ch}
.final .lp-btn.line{background:transparent;color:#fff;border-color:rgba(255,255,255,.35)}
.final .lp-btn.line:hover{border-color:#fff}
@media(max-width:600px){.final{padding:0 16px 72px}}

/* 바닥 */
.foot{border-top:1px solid var(--line);background:#fff;padding:44px 0 30px}
.foot .wrap{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
.foot .about p{font-size:13.5px;color:var(--ink-3);line-height:1.75;max-width:40ch;margin:14px 0 0}
.foot .cols{display:flex;gap:56px}
.foot .col{display:grid;gap:10px;align-content:start}
.foot .col b{font-size:13px;color:var(--ink)}
.foot .col a{font-size:13.5px;color:var(--ink-3);text-decoration:none}
.foot .col a:hover{color:var(--ink)}
.foot .copy{font-size:12.5px;color:var(--ink-3);margin-top:28px;width:100%}

@media(max-width:600px){.lp section{padding:72px 0}.lp-hero{padding-top:56px}.lp .wrap{padding:0 16px}}
@media(prefers-reduced-motion:reduce){.lp *,.lp *::before,.lp *::after{animation:none!important;transition-duration:.001s!important;transition-delay:0s!important}.lp.anim [data-reveal]:not(.rvl){opacity:1;transform:none}}
`;

const Mark = () => (
  <div className="lp-mark" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.8" fill="#fff" />
      <rect x="14" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.8" fill="#fff" />
    </svg>
  </div>
);

/** 원형 지표 — pct(0~100) 만큼 채움. 둘레 2πr = 113.1 (r=18) */
const Ring = ({ pct, color }: { pct: number; color: string }) => (
  <svg className="ring" viewBox="0 0 46 46" aria-hidden="true">
    <circle className="bg" cx="23" cy="23" r="18" />
    <circle className="fg" cx="23" cy="23" r="18" style={{ stroke: color, ['--off' as string]: String(113.1 * (1 - pct / 100)) }} />
  </svg>
);

/* 주간 누적 진척(계획 대비 실적) — 7주. 좌표는 viewBox 420x150 */
const PLAN = [18, 30, 42, 54, 66, 78, 90];
const ACT = [16, 27, 41, 50, 63, 76, 84];
const pts = (a: number[]) => a.map((v, i) => `${20 + i * 63},${140 - v * 1.3}`).join(' ');

const DashMock = ({ uid }: { uid: string }) => (
  <div className="mock" role="img" aria-label="데모 화면: 프로젝트 대시보드 — 진행 프로젝트, 일정 성과지수, 원가 성과지수, 평균 진척, 주간 진척 추이, 마감 임박 업무">
    <div className="tbar"><i /><i /><i /><b>프로젝트 허브  대시보드</b><em>데모 화면</em></div>
    <div className="body">
      <div className="kpis">
        <div className="kpi"><Ring pct={75} color="var(--brand)" /><div><div className="k">진행 프로젝트</div><div className="v num"><span data-count="12">12</span></div><div className="d ok">정상 9건</div></div></div>
        <div className="kpi"><Ring pct={88} color="var(--ok)" /><div><div className="k">일정 성과지수 SPI</div><div className="v num"><span data-count="1.04" data-dec="2">1.04</span></div><div className="d ok">계획 대비 앞섬</div></div></div>
        <div className="kpi"><Ring pct={70} color="var(--warn)" /><div><div className="k">원가 성과지수 CPI</div><div className="v num"><span data-count="0.97" data-dec="2">0.97</span></div><div className="d warn">점검 대상 2건</div></div></div>
        <div className="kpi"><Ring pct={68} color="var(--teal)" /><div><div className="k">평균 진척률</div><div className="v num"><span data-count="68" data-suffix="%">68%</span></div><div className="d ok">전주 대비 5%p</div></div></div>
      </div>
      <div className="drow">
        <div className="panel">
          <div className="pt">주간 누적 진척 <em>최근 7주</em></div>
          <div className="legend"><span><i style={{ background: 'var(--brand)' }} />실적</span><span><i style={{ background: '#AEB9C8' }} />계획</span></div>
          <svg className="chart" viewBox="0 0 420 150" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2457C5" stopOpacity=".18" /><stop offset="1" stopColor="#2457C5" stopOpacity="0" /></linearGradient></defs>
            <g className="grid">{[20, 60, 100, 140].map((y) => <line key={y} x1="0" x2="420" y1={y} y2={y} />)}</g>
            <polygon className="area" style={{ fill: `url(#${uid})` }} points={`20,140 ${pts(ACT)} 398,140`} />
            <polyline className="plan" points={pts(PLAN)} />
            <polyline className="act" points={pts(ACT)} />
            <circle className="dotpulse" cx="398" cy={140 - 84 * 1.3} r="5" />
            <circle className="dot" cx="398" cy={140 - 84 * 1.3} r="5" />
          </svg>
        </div>
        <div className="panel">
          <div className="pt">마감 임박 및 승인 대기</div>
          <div className="task"><span className="ti t1"><Layers size={16} /></span><span className="tn"><b>아키텍처 설계</b><span>설계 단계  산출물</span></span><span className="tag r">기한 경과</span></div>
          <div className="task"><span className="ti t2"><ScanSearch size={16} /></span><span className="tn"><b>현황 분석</b><span>분석 단계  업무</span></span><span className="tag a">D-5</span></div>
          <div className="task"><span className="ti t3"><FileCheck2 size={16} /></span><span className="tn"><b>설계서 검토</b><span>산출물 승인</span></span><span className="tag b">승인 대기</span></div>
        </div>
      </div>
    </div>
  </div>
);

const GanttMock = () => (
  <div className="mock" role="img" aria-label="데모 화면: 일정표 — 기준선, 진척 막대, 마일스톤, 오늘 기준선">
    <div className="tbar"><i /><i /><i /><b>프로젝트 허브  일정</b><em>기준선 대비</em></div>
    <div className="body">
      <div className="gantt">
        <div className="scale"><span>단계</span><span>5월</span><span>6월</span><span>7월</span><span>8월</span></div>
        <div className="today" />
        <div className="gr"><div className="lb"><ListTree size={14} />요구사항 정의</div><div className="tr"><div className="gbar base" style={{ left: '1%', width: '24%' }} /><div className="gbar" style={{ left: '2%', width: '24%', ['--d' as string]: '.1s' }}>100%</div></div></div>
        <div className="gr"><div className="lb"><Layers size={14} />설계</div><div className="tr"><div className="gbar base" style={{ left: '18%', width: '26%' }} /><div className="gbar c2" style={{ left: '20%', width: '29%', ['--d' as string]: '.3s' }}>90%</div><div className="ms" style={{ left: '49%' }} /></div></div>
        <div className="gr"><div className="lb"><GitBranch size={14} />개발</div><div className="tr"><div className="gbar base" style={{ left: '38%', width: '36%' }} /><div className="gbar c3" style={{ left: '40%', width: '38%', ['--d' as string]: '.5s' }}>62%</div></div></div>
        <div className="gr"><div className="lb"><ClipboardCheck size={14} />시험 및 검수</div><div className="tr"><div className="gbar base" style={{ left: '70%', width: '25%' }} /><div className="gbar c4" style={{ left: '72%', width: '26%', ['--d' as string]: '.7s' }}>10%</div></div></div>
      </div>
    </div>
  </div>
);

const areas = [
  { ic: CalendarRange, t: '일정과 단계' },
  { ic: ListTree, t: '요구사항 추적' },
  { ic: Workflow, t: '업무 분해(WBS)' },
  { ic: Bug, t: '이슈와 리스크' },
  { ic: Stamp, t: '산출물 승인' },
  { ic: ClipboardCheck, t: '시험과 품질' },
];

/**
 * 허브가 담는 여섯 서비스 — 수주 전(제안)에서 수주 후(수행, 성과)까지 순서대로.
 * 문구는 기능 서술만(성과 수치 없음).
 */
const lifecycle = [
  { ic: FileSearch, stage: '수주 전 1', t: '제안 분석', href: '/apps/analysis', d: '제안요청서에서 요구사항, 배점 기준, 리스크를 뽑아 대응 목록을 만듭니다.' },
  { ic: Compass, stage: '수주 전 2', t: '전략 수립', href: '/apps/strategy', d: '경쟁 구도와 발주처 요구를 바탕으로 수주 전략과 차별화 요소를 정리합니다.' },
  { ic: FileText, stage: '수주 전 3', t: '제안서 작성', href: '/apps/authoring', d: '제안서와 발표본 초안, 발표 대본, 예상 질의를 만듭니다.' },
  { ic: ShieldCheck, stage: '수주 전 4', t: '품질 검토', href: '/apps/quality', d: '작성한 제안서를 평가 기준에 대조해 보완할 항목을 찾습니다.' },
  { ic: LayoutDashboard, stage: '수주 후 1', t: '수행 관리', href: '/dashboard', d: 'WBS, 일정, 성과지표, 요구사항 추적, 산출물 승인으로 사업을 운영합니다.' },
  { ic: TrendingUp, stage: '수주 후 2', t: '고객 성과', href: '/apps/performance', d: '구축 이후 성과 방문과 인터뷰, 운영 통계를 모아 고객 성과를 관리합니다.' },
];

const pains = [
  { before: '주간보고 때마다 담당자별 엑셀을 모아 진척을 다시 계산합니다.', t: '현황은 입력과 동시에 집계됩니다', d: '업무, 이슈, 리스크, 진척이 대시보드에 바로 반영됩니다. 보고 자료를 따로 취합하지 않습니다.' },
  { before: '지연은 체감으로 먼저 알고, 숫자는 나중에 맞춥니다.', t: '편차는 성과지표로 먼저 드러납니다', d: '공수 기반 획득가치(EVM)로 SPI와 CPI를 계산합니다. 기준선 대비 어긋난 구간을 회의 전에 확인합니다.' },
  { before: '산출물 승인 이력이 메일과 메신저에 흩어져 감리 때 다시 찾습니다.', t: '승인과 변경 이력이 한곳에 남습니다', d: '산출물 버전, 전자결재, 작업 기록이 함께 저장됩니다. 누가 언제 무엇을 승인했는지 바로 조회합니다.' },
];

const caps = [
  { ic: Layers, t: '프로젝트와 단계', d: '단계별 색상과 순서를 정해 사업 구조를 잡습니다. 업무가 연결된 단계는 실수로 지워지지 않게 보호합니다.' },
  { ic: ListTree, t: '요구사항 추적표(RTM)', d: '요구사항을 업무, 시험, 산출물과 양방향으로 연결합니다. 누락과 검증 공백이 표에서 바로 보입니다.' },
  { ic: Workflow, t: 'WBS와 획득가치(EVM)', d: '계층형 WBS와 공수로 PV, EV, AC를 계산하고 SPI와 CPI로 성과를 측정합니다.' },
  { ic: CalendarRange, t: '일정표(간트)', d: '끌어서 기간을 바꾸고 선후행 관계, 마일스톤, 임계 경로, 기준선을 함께 봅니다.' },
  { ic: Bug, t: '이슈, 리스크, 시험', d: '결함과 이슈, 발생 가능성과 영향도 기반 리스크, 개발자에서 PM까지 이어지는 시험 승인을 한 흐름으로 다룹니다.' },
  { ic: Stamp, t: '산출물 승인과 기록', d: '산출물 버전과 전자결재, 전체 작업 기록, 데이터 내보내기로 감리와 품질 점검에 대응합니다.' },
];

const steps = [
  { ic: Target, n: '1단계', t: '계획', d: '사업 범위를 단계와 요구사항으로 정의하고 WBS로 업무를 나눕니다. 기준선을 확정해 이후 변경을 비교할 기준을 만듭니다.', out: ['WBS', '기준선', '요구사항 목록'] },
  { ic: Play, n: '2단계', t: '실행과 추적', d: '일정표, 칸반, 달력으로 진행을 추적하고 이슈, 리스크, 시험을 관리합니다. 담당자별 업무량은 자동으로 집계됩니다.', out: ['주간 진척', '이슈 대장', '시험 결과'] },
  { ic: BarChart3, n: '3단계', t: '성과와 종료', d: 'SPI와 CPI로 성과를 측정하고 산출물을 전자결재로 확정합니다. 주간보고와 엑셀 내보내기로 종료 보고를 준비합니다.', out: ['성과지표', '승인 산출물', '종료 보고'] },
];

const diffs = [
  { ic: GitBranch, lbl: '요구사항에서 시험까지', t: '추적이 끊기지 않습니다', d: '요구사항, 업무, 시험, 산출물이 하나의 추적표로 이어집니다. 어디가 비었는지 표가 먼저 알려 줍니다.' },
  { ic: Gauge, lbl: '공수 기반 정량 관리', t: '지연을 숫자로 관리합니다', d: '체감 대신 SPI와 CPI로 일정과 원가를 봅니다. 주간 추이는 따로 만들지 않아도 쌓입니다.' },
  { ic: Briefcase, lbl: '제안과 수행의 연결', t: '수주 전 자료를 수행에 이어 씁니다', d: '제안 단계에서 정리한 요구사항과 전략을 같은 허브에서 수행 관리로 넘깁니다.' },
];

const ops = [
  { ic: Lock, t: '조직별 분리', d: '조직마다 데이터가 분리되고 역할 기반 권한으로 볼 수 있는 범위를 나눕니다.' },
  { ic: History, t: '작업 기록', d: '등록, 변경, 승인, 삭제가 시각과 사용자와 함께 남습니다.' },
  { ic: Server, t: '자동 반영', d: '배포 때 데이터 구조를 자동으로 맞춰 관리자가 따로 작업하지 않아도 됩니다.' },
  { ic: Smartphone, t: '모바일 대응', d: '전 화면이 화면 크기에 맞춰 바뀌어 현장에서도 브라우저로 바로 씁니다.' },
];

const roles = [
  { ic: Compass, t: 'PM', d: '성과지표, 진척, 리스크를 확인하고 인력 배치와 승인을 처리합니다.' },
  { ic: Users, t: 'PL', d: '팀 업무량과 시험 진행을 관리하고 요구사항과 업무의 연결을 점검합니다.' },
  { ic: ClipboardCheck, t: '실무자', d: '내 업무, 스프린트, 이슈에 집중합니다. 목록에서 바로 고치고 전체 검색으로 찾습니다.' },
  { ic: BarChart3, t: '경영진', d: '사업별 현황과 주간 추이를 요약 보고서와 엑셀로 확인합니다.' },
];

const faqs = [
  { q: '어느 규모의 조직에 맞습니까?', a: '조직별로 데이터가 분리되는 구조라 한 팀부터 여러 조직과 사업을 동시에 운영하는 회사까지 쓸 수 있습니다. 역할 기반 권한으로 조직마다 접근 범위를 나눕니다.' },
  { q: '일반 이슈 관리 도구와 무엇이 다릅니까?', a: '이슈와 칸반에 더해 요구사항 추적표, 공수 기반 성과 관리, 산출물 전자결재, 조달과 인프라 관리까지 SI와 공공 사업 수행에 필요한 관리 영역을 함께 제공합니다.' },
  { q: '성과지표와 일정표는 따로 설정해야 합니까?', a: '아닙니다. 업무에 공수를 입력하면 PV, EV, AC와 SPI, CPI가 자동으로 계산되고, 선후행 관계와 기준선이 있는 일정표가 바로 동작합니다.' },
  { q: '제안 서비스와 수행 관리는 어떻게 이어집니까?', a: '같은 로그인으로 제안 분석, 전략 수립, 제안서 작성, 품질 검토를 쓰고, 수주 뒤에는 같은 허브의 수행 관리로 넘어갑니다.' },
  { q: '가입하지 않고 먼저 볼 수 있습니까?', a: '네. "데모 보기"를 누르면 예시 데이터가 들어 있는 데모 조직을 읽기 전용으로 볼 수 있습니다. 저장이나 변경은 되지 않습니다.' },
];

export default function LpClient() {
  const [entering, setEntering] = useState(false);
  /** 데모 보기 — 회원가입 없이 데모 조직에 읽기 전용으로 들어간다(10-28 둘러보기). 실패하면 로그인 화면으로 */
  async function demo() {
    setEntering(true);
    const r = await fetch('/api/auth/guest', { method: 'POST' }).catch(() => null);
    location.href = r && r.ok ? '/dashboard' : '/login?manual=1';
  }

  useEffect(() => {
    const root = document.querySelector('.lp');
    root?.classList.add('anim');
    const vh = window.innerHeight || 800;
    const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.top < vh * 0.92 && r.bottom > 0; };
    const rio = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('rvl'); rio.unobserve(e.target); } }),
      { threshold: 0.16 }
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => { if (inView(el)) el.classList.add('rvl'); else rio.observe(el); });
    const failsafe = window.setTimeout(() => {
      document.querySelectorAll('[data-reveal]:not(.rvl)').forEach((el) => { if (el.getBoundingClientRect().top < vh) el.classList.add('rvl'); });
    }, 2600);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cio = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        const target = parseFloat(el.dataset.count || '0');
        const dec = parseInt(el.dataset.dec || '0', 10);
        const suffix = el.dataset.suffix || '';
        cio.unobserve(el);
        if (reduce) { el.textContent = target.toFixed(dec) + suffix; return; }
        const dur = 1500; const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / dur);
          el.textContent = (target * (1 - Math.pow(1 - p, 3))).toFixed(dec) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
      { threshold: 0.6 }
    );
    document.querySelectorAll('[data-count]').forEach((el) => cio.observe(el));
    return () => { rio.disconnect(); cio.disconnect(); window.clearTimeout(failsafe); };
  }, []);

  const DemoBtn = ({ lg }: { lg?: boolean }) => (
    <button type="button" className={`lp-btn pri${lg ? ' lg' : ''}`} onClick={demo} disabled={entering}>
      {entering ? '데모 여는 중' : '데모 보기'}{!entering && <ArrowRight size={lg ? 18 : 16} />}
    </button>
  );

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>

      <nav className="lp-nav" aria-label="주 메뉴">
        <div className="wrap">
          <Link href="/" className="lp-brand" aria-label="GOWON 프로젝트 허브 첫 화면">
            <Mark />
            <div><b>프로젝트 허브</b><span>GOWON Project Hub</span></div>
          </Link>
          <div className="links">
            <a href="#suite">서비스 구성</a>
            <a href="#features">수행 관리</a>
            <a href="#flow">운영 방식</a>
            <Link href="/pricing">요금제</Link>
            <a href="#faq">자주 묻는 질문</a>
          </div>
          <div className="sp" />
          <Link href="/login?manual=1" className="lp-btn line">로그인</Link>
          <DemoBtn />
        </div>
      </nav>

      <main id="main-content" tabIndex={-1}>
        <section className="lp-hero">
          <div className="wrap">
            <span className="kicker" data-reveal>제안과 수행을 잇는 프로젝트 허브</span>
            <h1 data-reveal style={{ transitionDelay: '.05s' }}>
              수주 전 제안부터 준공 후 성과까지,<br /><span className="accent">하나의 기준</span>으로 관리합니다
            </h1>
            <p className="lead" data-reveal style={{ transitionDelay: '.1s' }}>
              제안요청서 분석에서 제안서 작성, 품질 검토, 사업 수행, 고객 성과 관리까지 여섯 가지 업무를 한 허브에서 처리합니다.
              일정과 원가의 편차는 성과지표로, 요구사항의 누락은 추적표로 먼저 확인합니다.
            </p>
            <div className="lp-cta" data-reveal style={{ transitionDelay: '.15s' }}>
              <DemoBtn lg />
              <Link href="/login?manual=1" className="lp-btn line lg">로그인</Link>
            </div>
            <div className="lp-trust" data-reveal style={{ transitionDelay: '.2s' }}>
              <span><CalendarRange size={17} />일정표와 WBS</span>
              <span><Gauge size={17} />획득가치 성과지표</span>
              <span><ListTree size={17} />요구사항 추적표</span>
              <span><Stamp size={17} />전자결재와 작업 기록</span>
            </div>
            <div className="lp-shot" data-reveal style={{ transitionDelay: '.25s' }}>
              <div className="float f1"><span className="fi" style={{ background: '#E9FAF0', color: 'var(--ok)' }}><Gauge size={16} /></span><div><b className="num">SPI 1.04</b><span>일정 정상</span></div></div>
              <div className="float f2"><span className="fi" style={{ background: 'var(--brand-l)', color: 'var(--brand)' }}><Stamp size={16} /></span><div><b>승인 대기 3건</b><span>내 결재 필요</span></div></div>
              <DashMock uid="lpAreaHero" />
            </div>
          </div>
          <div className="lp-strip" data-reveal>
            <div className="wrap">
              <span className="t">한곳에서 관리하는 영역</span>
              {areas.map(({ ic: Ic, t }) => (<span className="c" key={t}><Ic size={17} />{t}</span>))}
            </div>
          </div>
        </section>

        <section id="suite">
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">서비스 구성</span>
              <h2>제안에서 수행까지,<br /><span className="accent">업무 순서대로 이어집니다</span></h2>
              <p className="lead">제안요청서를 받은 날부터 사업을 마치고 성과를 확인하는 날까지 같은 로그인, 같은 화면에서 일합니다. 단계를 누르면 해당 서비스로 이동합니다.</p>
            </div>
            <div className="life" data-reveal>
              <div className="rail"><i /></div>
              <div className="nodes">
                {lifecycle.map(({ ic: Ic, stage, t, href, d }, i) => (
                  <Link className="node" key={t} href={href} style={{ ['--d' as string]: `${0.25 + i * 0.28}s` }}>
                    <span className="ni"><Ic size={28} strokeWidth={1.8} /></span>
                    <span className="stage">{stage}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                    <span className="go">열기 <ArrowRight size={13} /></span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="band-soft" id="why">
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">도입 효과</span>
              <h2>보고를 위한 취합 대신,<br /><span className="accent">판단에 시간을 씁니다</span></h2>
              <p className="lead">엑셀, 이슈 관리 도구, 일정 도구, 결재 시스템을 오가던 작업을 한곳으로 모읍니다.</p>
            </div>
            <div className="pains">
              {pains.map((p, i) => (
                <div className="pain" key={p.t} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                  <div className="before"><b>기존</b><span>{p.before}</span></div>
                  <div className="arrow" />
                  <div className="after"><h3>{p.t}</h3><p>{p.d}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features">
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">수행 관리</span>
              <h2>계획, 실행, 검증, 종료를<br /><span className="accent">한 체계로 관리합니다</span></h2>
              <p className="lead">SI와 공공 사업 수행에 필요한 관리 영역을 따로 붙이지 않고 처음부터 함께 설계했습니다.</p>
            </div>
            <div className="grid3">
              {caps.map(({ ic: Ic, t, d }, i) => (
                <div className="card" key={t} data-reveal style={{ transitionDelay: `${(i % 3) * 0.08}s` }}>
                  <div className="ci"><Ic size={22} /></div><h3>{t}</h3><p>{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band-soft">
          <div className="wrap">
            <div className="split">
              <div className="visual" data-reveal><GanttMock /></div>
              <div className="txt" data-reveal style={{ transitionDelay: '.08s' }}>
                <span className="kicker">일정 관리</span>
                <h2>기준선과 실적의 차이를<br /><span className="accent">일정표에서 바로 봅니다</span></h2>
                <ul className="ticks">
                  <li><span className="ck"><Check size={13} strokeWidth={3} /></span><span>막대를 끌어 기간을 바꾸면 <b>선후행 일정이 다시 계산</b>됩니다.</span></li>
                  <li><span className="ck"><Check size={13} strokeWidth={3} /></span><span>점선으로 표시된 <b>기준선</b>과 실제 막대를 겹쳐 편차를 확인합니다.</span></li>
                  <li><span className="ck"><Check size={13} strokeWidth={3} /></span><span>마일스톤과 <b>임계 경로</b>로 놓치면 안 되는 일정을 구분합니다.</span></li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <div className="split rev">
              <div className="txt" data-reveal>
                <span className="kicker">현황 대시보드</span>
                <h2>회의 전에<br /><span className="accent">확인할 것만 모았습니다</span></h2>
                <ul className="ticks">
                  <li><span className="ck"><Check size={13} strokeWidth={3} /></span><span>진행 사업, 이슈, 리스크, 진척률이 <b>입력 즉시 집계</b>됩니다.</span></li>
                  <li><span className="ck"><Check size={13} strokeWidth={3} /></span><span>계획 대비 실적 추이와 <b>SPI, CPI</b>를 같은 화면에서 봅니다.</span></li>
                  <li><span className="ck"><Check size={13} strokeWidth={3} /></span><span>기한이 지난 업무와 <b>내 승인 대기</b>를 맨 위에 보여 줍니다.</span></li>
                </ul>
              </div>
              <div className="visual" data-reveal style={{ transitionDelay: '.08s' }}><DashMock uid="lpAreaDash" /></div>
            </div>
          </div>
        </section>

        <section className="band-soft" id="flow">
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">운영 방식</span>
              <h2>세 단계로<br /><span className="accent">사업을 운영합니다</span></h2>
              <p className="lead">기준선을 정하고, 실적을 추적하고, 성과지표로 마무리합니다. 단계마다 남는 산출물을 함께 표시했습니다.</p>
            </div>
            <div className="steps">
              {steps.map(({ ic: Ic, n, t, d, out }, i) => (
                <div className="step" key={t} data-reveal style={{ transitionDelay: `${i * 0.1}s`, ['--d' as string]: `${0.3 + i * 0.25}s` }}>
                  <div className="bar" />
                  <div className="sh"><span className="si"><Ic size={20} /></span><div><div className="sn">{n}</div><h3>{t}</h3></div></div>
                  <p>{d}</p>
                  <div className="out">{out.map((o) => <span key={o}>{o}</span>)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">차별점</span>
              <h2>일반 협업 도구와<br /><span className="accent">이 부분이 다릅니다</span></h2>
            </div>
            <div className="grid3">
              {diffs.map(({ ic: Ic, lbl, t, d }, i) => (
                <div className="card" key={t} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                  <div className="ci"><Ic size={22} /></div>
                  <div className="lbl">{lbl}</div>
                  <h3>{t}</h3><p>{d}</p>
                </div>
              ))}
            </div>
            <div className="ops">
              {ops.map(({ ic: Ic, t, d }, i) => (
                <div className="op" key={t} data-reveal style={{ transitionDelay: `${i * 0.06}s` }}>
                  <span className="oi"><Ic size={22} /></span><h4>{t}</h4><p>{d}</p>
                </div>
              ))}
            </div>
            <p className="lp-note">위 내용은 제품 기능과 설계 기준의 설명이며 특정 고객사의 운영 실적이 아닙니다.</p>
          </div>
        </section>

        <section className="band-soft">
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">역할별 화면</span>
              <h2>역할마다<br /><span className="accent">필요한 화면이 다릅니다</span></h2>
              <p className="lead">역할에 맞는 화면과 권한으로 각자 필요한 정보만 봅니다.</p>
            </div>
            <div className="roles">
              {roles.map(({ ic: Ic, t, d }, i) => (
                <div className="role" key={t} data-reveal style={{ transitionDelay: `${i * 0.07}s` }}>
                  <span className="ri"><Ic size={20} /></span><h4>{t}</h4><p>{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq">
          <div className="wrap">
            <div className="center" data-reveal>
              <span className="kicker">자주 묻는 질문</span>
              <h2>도입 전에 많이 묻는 내용</h2>
            </div>
            <div className="faq" data-reveal>
              {faqs.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <div className="ans">{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <div className="final">
          <div className="box" data-reveal>
            <h2>데모 조직에서 실제 화면을 먼저 확인하세요</h2>
            <p>설치나 계약 없이 예시 데이터가 들어 있는 데모 조직을 읽기 전용으로 둘러볼 수 있습니다.</p>
            <div className="lp-cta">
              <DemoBtn lg />
              <Link href="/login?manual=1" className="lp-btn line lg">로그인</Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="foot">
        <div className="wrap">
          <div className="about">
            <div className="lp-brand"><Mark /><div><b>프로젝트 허브</b><span>GOWON Project Hub</span></div></div>
            <p>제안과 프로젝트 수행을 잇는 업무 허브입니다. 일정, 성과지표, 요구사항 추적, 전자결재를 한곳에서 관리합니다.</p>
          </div>
          <div className="cols">
            <div className="col">
              <b>제품</b>
              <a href="#suite">서비스 구성</a>
              <a href="#features">수행 관리</a>
              <a href="#flow">운영 방식</a>
              <Link href="/pricing">요금제</Link>
            </div>
            <div className="col">
              <b>지원</b>
              <Link href="/login?manual=1">로그인</Link>
              <a href="#faq">자주 묻는 질문</a>
              <Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보 처리방침</Link>
            </div>
          </div>
          <div className="copy">© 2026 GOWON 프로젝트 허브. 운영 주식회사 고원(GOWON)</div>
        </div>
      </footer>
    </div>
  );
}
