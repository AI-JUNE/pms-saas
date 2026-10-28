import type { Metadata } from 'next';
import LpClient from './lp/LpClient';

export const metadata: Metadata = {
  title: 'GOWON 프로젝트 허브 — 계획부터 정산까지, 프로젝트 관리·제안 업무',
  description:
    'WBS·간트·EVM 성과관리·요구사항 추적(RTM)·이슈/리스크·전자결재·테스트까지. 흩어진 프로젝트 관리 도구를 하나로 잇는 통합 플랫폼.',
};

export default function Home() {
  return <LpClient />;
}
