# Control de Brechas Clientes RM

Comparador mensual de volumen por cliente y obra para la Región Metropolitana.
Aplicación Next.js (vinext) desplegada en **Cloudflare Workers**.

- No incluye una base de datos precargada: el usuario carga un Excel compatible desde la interfaz.
- El Excel se procesa **dentro del navegador** (Web Worker + `xlsx`); no se envía ni se almacena en Cloudflare.
- No contiene credenciales, tokens ni contraseñas.

## Requisitos

- Node.js 22.13.0 o superior (`.node-version` fija 22.16.0 para Cloudflare Builds).

## Comandos

```bash
npm ci            # instala dependencias según package-lock.json
npm run dev       # servidor local
npm run build     # vinext build → dist/
npx wrangler deploy
```

## Despliegue automático (Cloudflare Workers Builds)

| Campo | Valor |
|---|---|
| Worker | `control-brechas-clientes-rm` |
| Rama de producción | `main` |
| Root directory | raíz del repositorio |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

La configuración del Worker está en `wrangler.jsonc`. Cada commit en `main` compila y publica automáticamente.

## Estructura

- `app/page.tsx` — interfaz y cálculos de brechas.
- `app/workers/xlsx-parser.worker.ts` — lectura del Excel y reglas de contabilización.
- `app/data/*.json` — catálogos de referencia (ejecutivos, margen, plantas).
- `worker/index.ts` — punto de entrada del Worker.
- `CLOUD_HANDOFF.md`, `GUIA_GITHUB_CLOUDFLARE.md` — notas de traspaso.
