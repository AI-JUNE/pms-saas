import { collection } from '@/lib/crud';
import { CONFIGS } from '@/lib/configs';
const h = collection(CONFIGS['interfaces']);
export const GET = h.GET; export const POST = h.POST; export const dynamic = 'force-dynamic';
