import type { Metadata } from 'next';
import LpClient from './LpClient';

export const metadata: Metadata = {
  title: 'PMS — 제안부터 정산까지, 통합 업무 포털',
  description:
    'RFP 분석·제안 품질·수주 전략·프로젝트 수행·고객 성과까지 다섯 서비스를 한 포털에서. WBS·간트·EVM 성과관리·요구사항 추적(RTM)·전자결재를 하나로 잇습니다.',
};

export default function Page() {
  return <LpClient />;
}
