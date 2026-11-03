// Cliente de la base publicada para el equipo (API /api/*, protegida por Cloudflare Access).

export type PublishedMeta = { source: string; fileModified: number; publishedAt: string; publishedBy: string; bytes: number; records: number };
export type Session = { email: string; canPublish: boolean; configured: boolean; published: PublishedMeta | null };

/** Sesión actual; null si la API no está disponible (sin Access configurado o sin permiso). */
export async function fetchSession(): Promise<Session | null> {
  try {
    const r = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return null;
    return (await r.json()) as Session;
  } catch { return null; }
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export async function fetchPublished<T = never>(): Promise<{ data: T; meta: PublishedMeta } | null> {
  const r = await fetch("/api/dataset", { cache: "no-store", credentials: "same-origin" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("No se pudo descargar la base publicada.");
  const meta = JSON.parse(decodeURIComponent(r.headers.get("x-dataset-meta") || "%7B%7D")) as PublishedMeta;
  const stream = r.body!.pipeThrough(new DecompressionStream("gzip"));
  const data = JSON.parse(await new Response(stream).text()) as T;
  return { data, meta };
}

export async function publishDataset(data: { records: unknown[] }, source: string, fileModified: number): Promise<PublishedMeta> {
  const body = await gzip(JSON.stringify(data));
  const r = await fetch("/api/dataset", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/octet-stream", "x-dataset-info": encodeURIComponent(JSON.stringify({ source, fileModified, records: data.records.length })) },
    body,
  });
  const res = (await r.json().catch(() => ({}))) as { published?: PublishedMeta; error?: string };
  if (!r.ok || !res.published) throw new Error(res.error || `Error ${r.status}`);
  return res.published;
}
