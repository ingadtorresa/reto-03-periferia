import { createHash, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Hono, type MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { secureHeaders } from "hono/secure-headers"
import { z } from "zod"
import { procesarTurno, type DependenciasCiclo } from "./agent/ciclo.ts"
import { Sesiones } from "./agent/sesiones.ts"
import { resumenControl } from "./oc/registros.ts"

export type ConfigApp = DependenciasCiclo & { accessCode?: string; peticionesPorMinuto: number }

const idSesion = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
const cuerpoChat = z.object({ sessionId: idSesion, message: z.string().trim().min(1).max(4000) })

const ARCHIVOS_WEB: Record<string, { archivo: string; tipo: string }> = {
  "/": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/app.js": { archivo: "app.js", tipo: "text/javascript; charset=utf-8" },
  "/styles.css": { archivo: "styles.css", tipo: "text/css; charset=utf-8" },
}

function exigirClave(accessCode: string | undefined): MiddlewareHandler {
  const digest = (texto: string) => createHash("sha256").update(texto).digest()
  return async (c, next) => {
    if (accessCode && !timingSafeEqual(digest(c.req.header("x-access-code") ?? ""), digest(accessCode))) {
      return c.json({ error: "Clave de acceso incorrecta o ausente." }, 401)
    }
    await next()
  }
}

function limitarPeticiones(porMinuto: number): MiddlewareHandler {
  let ventana = 0
  let cuenta = 0
  return async (c, next) => {
    const actual = Math.floor(Date.now() / 60_000)
    if (actual !== ventana) {
      ventana = actual
      cuenta = 0
    }
    cuenta += 1
    if (cuenta > porMinuto) return c.json({ error: "Demasiadas peticiones. Espera un minuto." }, 429)
    await next()
  }
}

export function crearApp(config: ConfigApp): Hono {
  const app = new Hono()
  const sesiones = new Sesiones()

  app.use(secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
    },
  }))

  app.onError((error, c) => {
    console.error("Error no controlado en la API", error)
    return c.json({ error: "Error interno del servidor." }, 500)
  })

  app.get("/api/health", (c) => c.json({ ok: true, provider: config.llm.proveedor, model: config.llm.modelo }))

  const protegida = exigirClave(config.accessCode)
  app.use("/api/chat", protegida, limitarPeticiones(config.peticionesPorMinuto), bodyLimit({ maxSize: 64 * 1024 }))
  app.use("/api/sessions/*", protegida)
  app.use("/api/control", protegida)

  app.post("/api/chat", async (c) => {
    const cuerpo = cuerpoChat.safeParse(await c.req.json().catch(() => null))
    if (!cuerpo.success) return c.json({ error: "Se requiere sessionId y un mensaje de hasta 4000 caracteres." }, 400)
    const sesion = sesiones.obtenerOCrear(cuerpo.data.sessionId)
    if (sesion.ocupada) return c.json({ error: "Espera la respuesta anterior antes de enviar otro mensaje." }, 409)
    sesion.ocupada = true
    try {
      return c.json(await procesarTurno(sesion, cuerpo.data.message, config))
    } finally {
      sesion.ocupada = false
    }
  })

  app.get("/api/sessions/:id", (c) => {
    const sesion = sesiones.obtener(c.req.param("id"))
    if (!sesion) return c.json({ error: "La sesión no existe." }, 404)
    return c.json({ id: sesion.id, mensajes: sesion.visibles, tokens: sesion.tokens, needsConfirmation: sesion.pendientes.size > 0 })
  })

  app.get("/api/control", (c) => c.json(resumenControl(config.directory)))

  for (const [ruta, { archivo, tipo }] of Object.entries(ARCHIVOS_WEB)) {
    const contenido = readFileSync(join(config.directory, "web", archivo))
    app.get(ruta, (c) => c.body(contenido, 200, { "content-type": tipo }))
  }
  return app
}
