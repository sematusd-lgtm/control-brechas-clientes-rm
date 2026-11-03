# Traspaso para agente Cloud

## Objetivo

Publicar este proyecto en Cloudflare Workers y dejarlo conectado a un repositorio GitHub para despliegues automáticos.

## Estado del proyecto

- Aplicación: Control Brechas Clientes RM.
- No incluye una base de datos precargada; el usuario carga el Excel desde la interfaz.
- Compilación validada localmente con `npm run build`.
- Node.js requerido: 22.13.0 o superior.
- Configuración de Cloudflare incluida en `wrangler.jsonc`.
- No depende de archivos ocultos de OpenAI.

## Publicación solicitada

1. Descomprimir y revisar el proyecto.
2. Ejecutar `npm ci` y `npm run build`.
3. Crear o actualizar un repositorio GitHub con todo el código fuente.
4. Conectar el repositorio a Cloudflare Workers, rama `main`.
5. Usar los siguientes comandos:
   - Build: `npm run build`
   - Deploy: `npx wrangler deploy`
6. Confirmar que el despliegue finalice correctamente.
7. Entregar al usuario la URL pública `workers.dev`.

## Importante

No agregar una base fija ni credenciales al código. Si Cloudflare solicita autorización, pedir al usuario que complete el inicio de sesión o proporcione un token mediante el mecanismo seguro de la plataforma.
