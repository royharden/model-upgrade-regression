/** CORS limits browser access, while JWT and RLS enforce authorization. */
export function corsHeaders(origin: string | null, allowedOrigins: readonly string[]): Record<string, string> | null {
  if (origin !== null && !allowedOrigins.includes(origin)) return null;
  return { ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600' };
}
