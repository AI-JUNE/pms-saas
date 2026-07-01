import { collection } from '@/lib/crud';
import { CONFIGS } from '@/lib/configs';
const h = collection(CONFIGS['firewall']);
export const GET = h.GET; export const POST = h.POST; export const dynamic = 'force-dynamic';
