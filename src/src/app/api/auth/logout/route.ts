import { destroySession } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST() { return handle(async () => { await destroySession(); return ok(); }); }
