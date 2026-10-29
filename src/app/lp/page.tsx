import type { Metadata } from 'next';
import LpClient from './LpClient';

export const metadata: Metadata = {
  title: 'GOWON 프로젝트 허브 — 제안부터 수행, 고객 성과까지 하나의 기준으로',
  description:
    '제안요청서 분석, 전략 수립, 제안서 작성, 품질 검토, 사업 수행, 고객 성과 관리를 한 허브에서. WBS와 일정표, 획득가치 성과지표, 요구사항 추적표, 전자결재를 함께 제공합니다.',
};

export default function Page() {
  return <LpClient />;
}
