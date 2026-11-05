import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { esConfirmacion, procesarTurno, type DependenciasCiclo } from "../src/agent/ciclo.ts"
import { PresupuestoDiario, Sesiones } from "../src/agent/sesiones.ts"
import { crearApp } from "../src/app.ts"
import { ErrorLlm, type LlmAdapter, type Mensaje } from "../src/llm/adapter.ts"
import type { OrdenCompra } from "../src/oc/tipos.ts"
import { LlmGuionizado, llamador, proyectoTemporal, type Guion } from "./ayuda.ts"

function dependencias(directory: string, llm: LlmAdapter, cambios: Partial<DependenciasCiclo> = {}): DependenciasCiclo {
  return { llm, directory, systemPrompt: "prompt", maxIteraciones: 5, tokensPorSesion: 10_000, presupuesto: new PresupuestoDiario(100_000), ...cambios }
}

const nuevaSesion = () => new Sesiones().obtenerOCrear("s1")
const herramienta = (nombre: string, args: unknown, id = `id-${nombre}`) => ({ fin: "herramientas" as const, llamadas: [{ id, nombre, args }] })

async function ordenDe(d: string, caso: string): Promise<OrdenCompra> {
  const r = await llamador(d)<{ orden: OrdenCompra }>("oc_construir_payload", { caso })
  if (!r.ok) throw new Error(r.error)
  return r.data.orden
}

describe("confirmación humana (CA3)", () => {
  it.each(["Confirmo", "sí", "Si, adelante", "ok", "procede"])("acepta %s", (t) => expect(esConfirmacion(t)).toBe(true))
  it.each(["No confirmo", "no", "¿Qué diferencia tiene?", "sí, pero no la crees", "cancela"])("no acepta %s", (t) => expect(esConfirmacion(t)).toBe(false))

  it("ignora confirmado=true si la persona no ha confirmado y lo acepta tras su confirmación", async () => {
    const d = proyectoTemporal()
    const orden = await ordenDe(d, "sol-004")
    const llm = new LlmGuionizado((_m, paso) => {
      if (paso === 1) return herramienta("oc_crear", { caso: "sol-004", payload: orden, confirmado: true })
      if (paso === 2) return { texto: "Revisa la diferencia." }
      if (paso === 3) return herramienta("oc_crear", { caso: "sol-004", payload: orden, confirmado: true })
      return { texto: "OC creada." }
    })
    const sesion = nuevaSesion()
    const deps = dependencias(d, llm)

    const primero = await procesarTurno(sesion, "Crea sol-004 ya", deps)
    expect(primero.toolCalls[0]).toMatchObject({ ok: false })
    expect(primero.needsConfirmation).toBe(true)
    expect(primero.reply).toContain("¿Confirmas")

    const segundo = await procesarTurno(sesion, "Confirmo", deps)
    expect(segundo.toolCalls[0]).toMatchObject({ ok: true })
    expect(segundo.needsConfirmation).toBe(false)
  })

  it("una respuesta distinta a confirmar no autoriza la creación", async () => {
    const d = proyectoTemporal()
    const orden = await ordenDe(d, "sol-004")
    const llm = new LlmGuionizado((_m, paso) => {
      if (paso === 1) return herramienta("oc_validar", { caso: "sol-004" })
      if (paso === 2) return { texto: "¿Confirmas?" }
      if (paso === 3) return herramienta("oc_crear", { caso: "sol-004", payload: orden, confirmado: true })
      return { texto: "No se creó." }
    })
    const sesion = nuevaSesion()
    const deps = dependencias(d, llm)
    expect((await procesarTurno(sesion, "Procesa sol-004", deps)).needsConfirmation).toBe(true)
    const respuesta = await procesarTurno(sesion, "No confirmo", deps)
    expect(respuesta.toolCalls[0]).toMatchObject({ ok: false })
  })

  it("confirmar un caso no autoriza otro", async () => {
    const d = proyectoTemporal()
    const orden = await ordenDe(d, "sol-005")
    const llm = new LlmGuionizado((_m, paso) => {
      if (paso === 1) return herramienta("oc_validar", { caso: "sol-004" })
      if (paso === 2) return { texto: "¿Confirmas?" }
      if (paso === 3) return herramienta("oc_crear", { caso: "sol-005", payload: orden, confirmado: true })
      return { texto: "fin" }
    })
    const sesion = nuevaSesion()
    const deps = dependencias(d, llm)
    await procesarTurno(sesion, "Procesa sol-004", deps)
    expect((await procesarTurno(sesion, "Confirmo", deps)).toolCalls[0]).toMatchObject({ ok: false })
  })

  it("sol-001 se crea sin confirmación humana (O1)", async () => {
    const d = proyectoTemporal()
    const orden = await ordenDe(d, "sol-001")
    const llm = new LlmGuionizado((_m, paso) => (paso === 1 ? herramienta("oc_crear", { caso: "sol-001", payload: orden }) : { texto: "OC creada." }))
    const r = await procesarTurno(nuevaSesion(), "Procesa sol-001", dependencias(d, llm))
    expect(r.toolCalls[0]).toMatchObject({ ok: true, nombre: "oc_crear" })
    expect(r.needsConfirmation).toBe(false)
  })
})

describe("ciclo del agente", () => {
  it("expone las herramientas con el nombre <archivo>_<export> y registra cada llamada (CA4)", async () => {
    const d = proyectoTemporal()
    const llm = new LlmGuionizado((_m, paso) => (paso === 1 ? herramienta("oc_leer_paquete", { caso: "sol-001" }) : { texto: "Listo." }))
    await procesarTurno(nuevaSesion(), "lee sol-001", dependencias(d, llm))
    expect(llm.herramientas.map((h) => h.nombre)).toEqual(["oc_leer_paquete", "oc_validar", "oc_construir_payload", "oc_generar_evidencia", "oc_crear"])
    expect(readFileSync(join(d, "out", "log.jsonl"), "utf8")).toContain("oc_leer_paquete")
  })

  it("detiene el turno en el tope de iteraciones e informa lo que tiene (CA1)", async () => {
    const d = proyectoTemporal()
    const llm = new LlmGuionizado((_m, paso) => herramienta("oc_leer_paquete", { caso: "sol-001" }, `id-${paso}`))
    const r = await procesarTurno(nuevaSesion(), "lee", dependencias(d, llm, { maxIteraciones: 3 }))
    expect(llm.paso).toBe(3)
    expect(r.reply).toContain("tope de pasos")
    expect(r.reply).toContain("oc_leer_paquete")
  })

  it("no ejecuta herramientas de una respuesta truncada ni la guarda en el historial", async () => {
    const d = proyectoTemporal()
    const llm = new LlmGuionizado(() => ({ fin: "truncado", llamadas: [{ id: "x", nombre: "oc_crear", args: { caso: "sol-001" } }] }))
    const sesion = nuevaSesion()
    const r = await procesarTurno(sesion, "crea", dependencias(d, llm))
    expect(r.toolCalls).toEqual([])
    expect(r.reply).toContain("incompleta")
    expect(sesion.historial.some((m) => m.rol === "assistant")).toBe(false)
  })

  it("muestra el error del proveedor y la sesión sigue viva (CA5)", async () => {
    const d = proyectoTemporal()
    let falla = true
    const llm: LlmAdapter = {
      proveedor: "x",
      modelo: "y",
      async enviar() {
        if (falla) {
          falla = false
          throw new ErrorLlm("El modelo tardó demasiado en responder. Intenta de nuevo.")
        }
        return { texto: "Hola", llamadas: [], fin: "fin", uso: { entrada: 1, salida: 1 } }
      },
    }
    const sesion = nuevaSesion()
    const deps = dependencias(d, llm)
    expect((await procesarTurno(sesion, "hola", deps)).reply).toContain("tardó demasiado")
    expect((await procesarTurno(sesion, "hola", deps)).reply).toBe("Hola")
  })

  it("respeta el tope de tokens por sesión y el presupuesto diario", async () => {
    const d = proyectoTemporal()
    const guion: Guion = () => ({ texto: "ok", uso: { entrada: 60, salida: 60 } })
    const llm = new LlmGuionizado(guion)
    const sesion = nuevaSesion()
    const deps = dependencias(d, llm, { tokensPorSesion: 100 })
    await procesarTurno(sesion, "uno", deps)
    expect((await procesarTurno(sesion, "dos", deps)).reply).toContain("tope de tokens")
    expect(llm.paso).toBe(1)

    const presupuesto = new PresupuestoDiario(100)
    await procesarTurno(nuevaSesion(), "uno", dependencias(d, llm, { presupuesto }))
    expect((await procesarTurno(nuevaSesion(), "dos", dependencias(d, llm, { presupuesto }))).reply).toContain("presupuesto diario")
  })

  it("el historial enviado incluye el prompt del sistema y el resultado de herramientas", async () => {
    const d = proyectoTemporal()
    let ultimo: Mensaje[] = []
    const llm = new LlmGuionizado((m, paso) => {
      ultimo = m
      return paso === 1 ? herramienta("oc_leer_paquete", { caso: "sol-001" }) : { texto: "Fin" }
    })
    await procesarTurno(nuevaSesion(), "lee", dependencias(d, llm))
    expect(ultimo[0]).toEqual({ rol: "system", texto: "prompt" })
    expect(ultimo.at(-1)).toMatchObject({ rol: "tool", esError: false })
  })
})

describe("API", () => {
  const app = (d: string, accessCode?: string, peticionesPorMinuto = 100) =>
    crearApp({ ...dependencias(d, new LlmGuionizado(() => ({ texto: "Hola <b>x</b>" }))), accessCode, peticionesPorMinuto })
  const postChat = (cuerpo: unknown, cabeceras: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...cabeceras },
    body: JSON.stringify(cuerpo),
  })

  it("health no expone claves", async () => {
    const r = await app(proyectoTemporal()).request("/api/health")
    expect(await r.json()).toEqual({ ok: true, provider: "simulado", model: "guion" })
  })

  it("chat responde con el contrato del PRD y la sesión queda consultable", async () => {
    const a = app(proyectoTemporal())
    const r = await a.request("/api/chat", postChat({ sessionId: "abc", message: "hola" }))
    expect(await r.json()).toEqual({ reply: "Hola <b>x</b>", toolCalls: [], needsConfirmation: false })
    const sesion = (await (await a.request("/api/sessions/abc")).json()) as { mensajes: unknown[] }
    expect(sesion.mensajes).toHaveLength(2)
    expect((await a.request("/api/sessions/otra")).status).toBe(404)
  })

  it("valida el cuerpo, exige la clave y limita las peticiones", async () => {
    const d = proyectoTemporal()
    expect((await app(d).request("/api/chat", postChat({ sessionId: "../x", message: "hola" }))).status).toBe(400)
    const protegida = app(d, "clave-segura")
    expect((await protegida.request("/api/chat", postChat({ sessionId: "a", message: "hola" }))).status).toBe(401)
    expect((await protegida.request("/api/sessions/a")).status).toBe(401)
    expect((await protegida.request("/api/health")).status).toBe(200)
    expect((await protegida.request("/api/chat", postChat({ sessionId: "a", message: "hola" }, { "x-access-code": "clave-segura" }))).status).toBe(200)
    const limitada = app(d, undefined, 1)
    await limitada.request("/api/chat", postChat({ sessionId: "a", message: "hola" }))
    expect((await limitada.request("/api/chat", postChat({ sessionId: "a", message: "hola" }))).status).toBe(429)
  })

  it("sirve el chat con CSP estricta", async () => {
    const r = await app(proyectoTemporal()).request("/")
    expect(r.status).toBe(200)
    expect(r.headers.get("content-security-policy")).toContain("script-src 'self'")
    expect(r.headers.get("content-security-policy")).not.toContain("unsafe-inline")
  })

  it("publica el contrato OpenAPI con todas las rutas y solo relaja la CSP en /docs", async () => {
    const a = app(proyectoTemporal())
    const especificacion = (await (await a.request("/openapi.json")).json()) as { paths: Record<string, unknown> }
    expect(Object.keys(especificacion.paths).sort()).toEqual(["/api/chat", "/api/control", "/api/health", "/api/sessions/{id}"])
    const docs = await a.request("/docs")
    expect(docs.status).toBe(200)
    expect(docs.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'")
    expect((await a.request("/openapi.json")).headers.get("content-security-policy")).not.toContain("unsafe-inline")
  })
})

describe("demo.ts", () => {
  it("es determinista y no necesita ninguna clave", () => {
    const d = proyectoTemporal()
    const env = { ...process.env, DEMO_DIR: d, ANTHROPIC_API_KEY: "" }
    const raiz = join(import.meta.dirname, "..")
    const correr = () => execFileSync(process.execPath, ["--import", "tsx", "demo.ts"], { cwd: raiz, env, encoding: "utf8" })
    const primera = correr()
    expect(primera).toContain("Casos con el resultado esperado: 6 de 6")
    expect(correr()).toBe(primera)
    const filtrar = (c: string) => c.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "TS")
    const control = readFileSync(join(d, "out", "control.csv"), "utf8")
    correr()
    expect(filtrar(readFileSync(join(d, "out", "control.csv"), "utf8"))).toBe(filtrar(control))
  }, 60_000)
})
