import { item } from '@/lib/crud';
import { CONFIGS } from '@/lib/configs';
const h = item(CONFIGS['snapshots']);
export const PATCH = h.PATCH; export const DELETE = h.DELETE; export const dynamic = 'force-dynamic';
