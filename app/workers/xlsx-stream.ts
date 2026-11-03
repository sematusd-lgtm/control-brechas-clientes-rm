// Lector XLSX por streaming: descomprime y recorre la hoja por partes, sin
// convertir el XML completo en un único texto. Evita el límite de longitud de
// cadenas del navegador (~536 MB) en bases muy grandes. Sin dependencias.

export type StreamCell = { v?: unknown } | undefined;

type ZipEntry = { name: string; method: number; compSize: number; size: number; offset: number };

export class StreamUnsupportedError extends Error {}

const LOCAL_SIG = 0x04034b50, CENTRAL_SIG = 0x02014b50, EOCD_SIG = 0x06054b50, Z64_LOC_SIG = 0x07064b50, Z64_EOCD_SIG = 0x06064b50;

function readZipEntries(u8: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 22 || dv.getUint32(0, true) !== LOCAL_SIG) throw new StreamUnsupportedError("No es un archivo ZIP/XLSX");
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new StreamUnsupportedError("Directorio ZIP no encontrado");
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === Z64_LOC_SIG) {
      const z = Number(dv.getBigUint64(loc + 8, true));
      if (dv.getUint32(z, true) === Z64_EOCD_SIG) {
        count = Number(dv.getBigUint64(z + 32, true));
        cdOffset = Number(dv.getBigUint64(z + 48, true));
      }
    }
  }
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== CENTRAL_SIG) break;
    const method = dv.getUint16(p + 10, true);
    let compSize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    // Campos ZIP64 (extra 0x0001) cuando algún valor no cabe en 32 bits.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(dv.getBigUint64(q, true)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(dv.getBigUint64(q, true)); }
      }
      e += 4 + len;
    }
    entries.set(name.replace(/^\/+/, "").toLowerCase(), { name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryData(u8: Uint8Array, entry: ZipEntry): Uint8Array {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const o = entry.offset;
  if (dv.getUint32(o, true) !== LOCAL_SIG) throw new Error(`Entrada ZIP dañada: ${entry.name}`);
  const start = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
  return u8.subarray(start, start + entry.compSize);
}

async function* entryChunks(u8: Uint8Array, entry: ZipEntry): AsyncGenerator<Uint8Array> {
  const data = entryData(u8, entry);
  if (entry.method === 0) { yield data; return; }
  if (entry.method !== 8) throw new StreamUnsupportedError(`Compresión ZIP no soportada (${entry.method})`);
  if (typeof DecompressionStream === "undefined") throw new StreamUnsupportedError("DecompressionStream no disponible");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) yield value;
  }
}

async function entryText(u8: Uint8Array, entry: ZipEntry): Promise<string> {
  const dec = new TextDecoder("utf-8");
  let out = "";
  for await (const chunk of entryChunks(u8, entry)) out += dec.decode(chunk, { stream: true });
  return out + dec.decode();
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  if (s.indexOf("&") >= 0) {
    s = s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e]);
  }
  if (s.indexOf("_x") >= 0) s = s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return s;
}

function richText(xml: string): string {
  const clean = xml.indexOf("<rPh") >= 0 ? xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") : xml;
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out += m[1];
  return unescapeXml(out);
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] ? richText(m[1]) : "");
  return out;
}

function resolveTarget(target: string): string {
  const t = target.replace(/\\/g, "/");
  const path = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
  const parts: string[] = [];
  for (const seg of path.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/").toLowerCase();
}

function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/**
 * Recorre la primera hoja del XLSX fila por fila.
 * onRow recibe las celdas indexadas por columna (0 = A), igual que SheetJS en modo dense.
 */
export async function streamXlsxRows(
  buffer: ArrayBuffer,
  onRow: (cells: Array<StreamCell>, rowNumber: number) => void,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const u8 = new Uint8Array(buffer);
  const entries = readZipEntries(u8);
  const get = (path: string) => entries.get(path.toLowerCase());

  // Primera hoja según el orden del libro.
  let sheetPath = "xl/worksheets/sheet1.xml";
  let sstPath = "xl/sharedstrings.xml";
  const wbEntry = get("xl/workbook.xml"), relsEntry = get("xl/_rels/workbook.xml.rels");
  if (wbEntry && relsEntry) {
    const [wbXml, relsXml] = await Promise.all([entryText(u8, wbEntry), entryText(u8, relsEntry)]);
    const rels = new Map<string, { target: string; type: string }>();
    for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const id = attr(m[1], "Id"), target = attr(m[1], "Target");
      if (id && target) rels.set(id, { target, type: attr(m[1], "Type") || "" });
    }
    const firstSheet = wbXml.match(/<sheet\b([^>]*?)\/?>/);
    const rid = firstSheet ? attr(firstSheet[1], "r:id") : null;
    const rel = rid ? rels.get(rid) : undefined;
    if (rel) sheetPath = resolveTarget(rel.target);
    for (const r of rels.values()) if (/\/sharedStrings$/i.test(r.type)) sstPath = resolveTarget(r.target);
  }
  const sheetEntry = get(sheetPath);
  if (!sheetEntry) throw new StreamUnsupportedError("Hoja no encontrada en el archivo");
  const sstEntry = get(sstPath);
  const shared = sstEntry ? parseSharedStrings(await entryText(u8, sstEntry)) : [];

  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let implicitRow = 0;

  const processRows = (text: string) => {
    rowRe.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(text))) {
      const rAttr = attr(rm[1], "r");
      const rowNumber = rAttr ? parseInt(rAttr, 10) : implicitRow + 1;
      implicitRow = rowNumber;
      const cells: Array<StreamCell> = [];
      const body = rm[2];
      if (body) {
        cellRe.lastIndex = 0;
        let cm: RegExpExecArray | null;
        let implicitCol = -1;
        while ((cm = cellRe.exec(body))) {
          const a = cm[1];
          const ref = attr(a, "r");
          const col = ref ? colIndex(ref) : implicitCol + 1;
          implicitCol = col;
          const inner = cm[2];
          if (!inner) continue;
          const t = attr(a, "t") || "n";
          let value: unknown;
          if (t === "inlineStr") {
            const is = inner.match(/<is>([\s\S]*?)<\/is>/);
            value = is ? richText(is[1]) : "";
          } else {
            const vm = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
            if (!vm) continue;
            const raw = vm[1];
            if (t === "s") value = shared[parseInt(raw, 10)] ?? "";
            else if (t === "n") { const x = Number(raw); value = Number.isFinite(x) ? x : raw; }
            else if (t === "b") value = raw === "1" || raw === "true";
            else value = unescapeXml(raw); // str, d, e
          }
          cells[col] = { v: value };
        }
      }
      onRow(cells, rowNumber);
    }
  };

  const dec = new TextDecoder("utf-8");
  let buf = "";
  let seen = 0;
  for await (const chunk of entryChunks(u8, sheetEntry)) {
    seen += chunk.byteLength;
    buf += dec.decode(chunk, { stream: true });
    const end = buf.lastIndexOf("</row>");
    if (end >= 0) {
      processRows(buf.slice(0, end + 6));
      buf = buf.slice(end + 6);
    }
    if (onProgress && sheetEntry.size) onProgress(Math.min(1, seen / sheetEntry.size));
  }
  buf += dec.decode();
  if (buf) processRows(buf);
}
