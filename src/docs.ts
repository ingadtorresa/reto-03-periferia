import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { Hono } from "hono"
import { especificacion } from "./openapi.ts"

const HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API de OC</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script src="/docs/init.js"></script>
</body>
</html>
`

const INICIO = 'window.ui = SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" })\n'

/** Swagger UI se sirve desde el propio servidor: la CSP no necesita permitir ningún CDN. */
export function registrarDocs(app: Hono): void {
  const base = dirname(createRequire(import.meta.url).resolve("swagger-ui-dist/package.json"))
  const estilos = readFileSync(join(base, "swagger-ui.css"))
  const script = readFileSync(join(base, "swagger-ui-bundle.js"))
  app.get("/openapi.json", (c) => c.json(especificacion))
  app.get("/docs", (c) => c.html(HTML))
  app.get("/docs/init.js", (c) => c.body(INICIO, 200, { "content-type": "text/javascript; charset=utf-8" }))
  app.get("/docs/swagger-ui.css", (c) => c.body(estilos, 200, { "content-type": "text/css; charset=utf-8" }))
  app.get("/docs/swagger-ui-bundle.js", (c) => c.body(script, 200, { "content-type": "text/javascript; charset=utf-8" }))
}
