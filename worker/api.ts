// API de la base publicada. Toda solicitud exige una identidad válida de
// Cloudflare Access (JWT firmado). Si Access no está configurado, la API se
// mantiene cerrada. Solo los correos de PUBLISHER_EMAILS pueden publicar.

export interface ApiEnv {
  DATA: KVNamespace;
  /** p. ej. https://mi-equipo.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag de la aplicación de Access */
  ACCESS_AUD?: string;
  /** Correos autorizados a publicar, separados por coma */
  PUBLISHER_EMAILS?: string;
}

const DATASET_KEY = "dataset:latest";
const META_KEY = "dataset:meta";
const MAX_BYTES = 24 * 1024 * 1024; // límite de valor KV: 25 MiB

type Jwk = JsonWebKey & { kid?: string };
let certCache: { team: string; at: number; keys: Jwk[] } | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function accessKeys(team: string): Promise<Jwk[]> {
  if (certCache && certCache.team === team && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("No fue posible obtener las claves de Cloudflare Access");
  const body = (await res.json()) as { keys?: Jwk[] };
  certCache = { team, at: Date.now(), keys: body.keys ?? [] };
  return certCache.keys;
}

function readToken(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

/** Devuelve el correo autenticado por Access, o null si la firma/expiración/audiencia no son válidas. */
async function verifiedEmail(request: Request, env: ApiEnv): Promise<string | null> {
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/+$/, "");
  const aud = env.ACCESS_AUD;
  const token = readToken(request);
  if (!team || !aud || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
    if (header.alg !== "RS256") return null;
    let jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
    if (!jwk) { certCache = null; jwk = (await accessKeys(team)).find(k => k.kid === header.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return null;
    if (!payload.exp || payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;
    if (payload.iss && payload.iss.replace(/\/+$/, "") !== team) return null;
    return payload.email ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

const publishers = (env: ApiEnv) =>
  (env.PUBLISHER_EMAILS || "").split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);

export type DatasetMeta = { source: string; fileModified: number; publishedAt: string; publishedBy: string; bytes: number; records: number };

export async function handleApi(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const configured = Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && env.DATA);
  if (!configured) return json({ error: "La publicación compartida aún no está configurada (Cloudflare Access).", configured: false }, 503);

  const email = await verifiedEmail(request, env);
  if (!email) return json({ error: "Acceso no autorizado.", configured: true }, 401);
  const canPublish = publishers(env).includes(email);

  if (url.pathname === "/api/session" && request.method === "GET") {
    const meta = await env.DATA.get<DatasetMeta>(META_KEY, "json");
    return json({ email, canPublish, configured: true, published: meta });
  }

  if (url.pathname === "/api/dataset") {
    if (request.method === "GET") {
      const { value, metadata } = await env.DATA.getWithMetadata<DatasetMeta>(DATASET_KEY, "stream");
      if (!value) return json({ error: "Aún no hay una base publicada." }, 404);
      return new Response(value, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
          "x-dataset-meta": encodeURIComponent(JSON.stringify(metadata ?? {})),
        },
      });
    }
    if (request.method === "PUT") {
      if (!canPublish) return json({ error: "Tu usuario no tiene permiso para publicar." }, 403);
      const body = await request.arrayBuffer();
      if (!body.byteLength) return json({ error: "Base vacía." }, 400);
      if (body.byteLength > MAX_BYTES) return json({ error: "La base publicada supera el máximo permitido (24 MB comprimidos)." }, 413);
      const b = new Uint8Array(body);
      if (b[0] !== 0x1f || b[1] !== 0x8b) return json({ error: "Formato inválido (se espera gzip)." }, 400);
      let info: { source?: string; fileModified?: number; records?: number } = {};
      try { info = JSON.parse(decodeURIComponent(request.headers.get("x-dataset-info") || "%7B%7D")); } catch { /* opcional */ }
      const meta: DatasetMeta = {
        source: String(info.source || "Base publicada").slice(0, 200),
        fileModified: Number(info.fileModified) || 0,
        records: Number(info.records) || 0,
        publishedAt: new Date().toISOString(),
        publishedBy: email,
        bytes: body.byteLength,
      };
      await env.DATA.put(DATASET_KEY, body, { metadata: meta });
      await env.DATA.put(META_KEY, JSON.stringify(meta));
      return json({ ok: true, published: meta });
    }
  }

  return json({ error: "Ruta no encontrada." }, 404);
}
