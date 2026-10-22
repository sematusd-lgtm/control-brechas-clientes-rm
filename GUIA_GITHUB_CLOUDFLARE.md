# Control de Brechas Clientes RM

Proyecto preparado para publicarse desde GitHub mediante Cloudflare Workers Builds.

## Requisitos

- Cuenta de GitHub.
- Cuenta de Cloudflare.
- Node.js 22 o superior, solo si se desea probar localmente.

## Subir el proyecto a GitHub

1. Descomprimir el ZIP.
2. Crear un repositorio nuevo y vacío en GitHub.
3. En GitHub, seleccionar **Add file > Upload files**.
4. Subir el contenido de la carpeta descomprimida, no la carpeta contenedora.
5. Confirmar que `package.json`, `wrangler.jsonc`, `vite.config.ts` y la carpeta `app` queden en la raíz.
6. Confirmar la carga con **Commit changes**.

## Conectar GitHub con Cloudflare

1. Ingresar al panel de Cloudflare.
2. Abrir **Workers & Pages**.
3. Seleccionar **Create application**.
4. Elegir **GitHub** y autorizar la aplicación de Cloudflare.
5. Seleccionar el repositorio recién creado.
6. Usar la siguiente configuración:

   - Nombre del Worker: `control-brechas-clientes-rm`
   - Rama de producción: `main`
   - Root directory: dejar vacío
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Preview command: `npx wrangler preview`

7. Seleccionar **Save and Deploy**.
8. Esperar a que el estado quede en **Success** y abrir la dirección `workers.dev` entregada por Cloudflare.

## Actualizaciones futuras

Cada cambio confirmado en la rama `main` de GitHub iniciará automáticamente una nueva compilación y publicación en Cloudflare.

## Prueba local opcional

```bash
npm install
npm run dev
```

El archivo Excel se procesa dentro del navegador. La base cargada por el usuario no queda incluida en GitHub ni almacenada en Cloudflare.
