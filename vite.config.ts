import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig(async () => {
  // Mantiene el estado de Wrangler/Miniflare dentro del proyecto (sin secretos).
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler toma la ruta de logs al importar el plugin de Cloudflare.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: { host: "0.0.0.0" },
    plugins: [
      vinext(),
      // Usa wrangler.jsonc como única fuente de configuración del Worker.
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
      }),
    ],
  };
});
