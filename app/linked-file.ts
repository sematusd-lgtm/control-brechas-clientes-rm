// Vínculo persistente a un archivo local (p. ej. la carpeta de OneDrive
// sincronizada en el PC) mediante la File System Access API de Chrome/Edge.
// El identificador del archivo se guarda solo en este navegador (IndexedDB);
// el contenido nunca sale del equipo.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type LinkedHandle = any;

const DB_NAME = "control-brechas";
const STORE = "linked-file";
const KEY = "base";

export const linkSupported = () =>
  typeof window !== "undefined" && "showOpenFilePicker" in window && "indexedDB" in window;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export async function loadHandle(): Promise<LinkedHandle | null> {
  try { return (await tx<LinkedHandle>("readonly", s => s.get(KEY))) ?? null; } catch { return null; }
}
export async function saveHandle(h: LinkedHandle) {
  try { await tx("readwrite", s => s.put(h, KEY)); } catch { /* sin persistencia: el vínculo dura la sesión */ }
}
export async function clearHandle() {
  try { await tx("readwrite", s => s.delete(KEY)); } catch { /* ignorar */ }
}

export async function pickExcel(): Promise<LinkedHandle | null> {
  try {
    const [h] = await (window as any).showOpenFilePicker({
      id: "base-despachos",
      multiple: false,
      types: [{ description: "Base de despachos Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] } }],
    });
    return h ?? null;
  } catch { return null; } // el usuario canceló
}

/** "granted" | "prompt" | "denied" sin pedir permiso. */
export async function permission(h: LinkedHandle): Promise<string> {
  try { return await h.queryPermission({ mode: "read" }); } catch { return "prompt"; }
}
/** Pide permiso de lectura; requiere un clic del usuario. */
export async function requestPermission(h: LinkedHandle): Promise<boolean> {
  try { return (await h.requestPermission({ mode: "read" })) === "granted"; } catch { return false; }
}
