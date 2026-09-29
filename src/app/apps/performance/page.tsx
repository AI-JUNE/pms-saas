'use client';
import { AppFrame } from '@/components/AppFrame';

export default function Page() {
  return (
    <AppFrame
      appKey="performance"
      title="고객 성과관리"
      subtitle="구축 이후 성과방문·인터뷰·콜통계를 모아 고객 성과를 관리합니다."
      intranetNote="공유 저장소(cx-store :3006)를 사용합니다 — 사내망에서만 데이터가 연동됩니다."
    />
  );
}
