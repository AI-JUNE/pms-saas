import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
// 공개 자동로그인 비활성화(실서비스). 정상 로그인/회원가입만 허용합니다.
export async function POST() {
  return handle(async () => ok({ ok: false, disabled: true }));
}
