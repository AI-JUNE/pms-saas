export const dynamic = 'force-dynamic';
// Fetches the official GOWON emblem from the company site (server-side, no CORS) and serves it.
let cache: { buf: Uint8Array; type: string } | null = null;

export async function GET() {
  try {
    if (!cache) {
      const html = await fetch('https://www.gowon.co.kr/', { headers: { 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' }).then((r) => r.text());
      let mime = 'png', b64 = '';
      const scoped = html.match(/brand-img[\s\S]{0,300}?url\(\s*["']?(data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+))/i);
      if (scoped) { mime = scoped[2]; b64 = scoped[3]; }
      else {
        const all = [...html.matchAll(/data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]{200,})/gi)];
        if (all.length) { const best = all.sort((a, b) => b[2].length - a[2].length)[0]; mime = best[1]; b64 = best[2]; }
      }
      if (b64) cache = { type: 'image/' + mime, buf: Uint8Array.from(Buffer.from(b64, 'base64')) };
    }
    if (cache) return new Response(cache.buf as unknown as BodyInit, { headers: { 'Content-Type': cache.type, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
  } catch {}
  return new Response('', { status: 404 });
}
