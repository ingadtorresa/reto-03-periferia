import { ErrorLlm, type HerramientaLlm, type LlamadaHerramienta, type LlmAdapter } from "../llm/adapter.ts"
import { definicionesHerramientas, ejecutarHerramienta } from "../tools/registro.ts"
import type { LlamadaVisible, PresupuestoDiario, Sesion } from "./sesiones.ts"

export type DependenciasCiclo = {
  llm: LlmAdapter
  directory: string
  systemPrompt: string
  maxIteraciones: number
  tokensPorSesion: number
  presupuesto: PresupuestoDiario
}

export type RespuestaTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }

type Resultado = { ok: true; data: unknown } | { ok: false; error: string }
type Registro = Record<string, unknown>

const PREFIJO_REQUIERE_CONFIRMACION = "Requiere confirmación humana"

/** CA3: la confirmación es decisión del backend según el texto de la persona, nunca del modelo. */
export function esConfirmacion(mensaje: string): boolean {
  const texto = mensaje.trim().toLowerCase()
  if (/\b(no|cancela\w*|rechaz\w*|detente|espera)\b/.test(texto)) return false
  // Lookahead en vez de \b: en JavaScript, \b no reconoce el límite después de una vocal con tilde.
  return /^[¡\s]*(s[ií]|confirm[oóa]\w*|adelante|procede\w*|de acuerdo|ok|dale)(?![\p{L}\d])/u.test(texto)
}

function casoDe(args: unknown): string {
  const caso = (args as Registro | null)?.caso
  return typeof caso === "string" ? caso : ""
}

function resumir(nombre: string, resultado: Resultado): string {
  if (!resultado.ok) return resultado.error
  const data = resultado.data as Registro
  const codigos = (lista: unknown) => (lista as { codigo: string }[]).map((h) => h.codigo).join(", ") || "ninguna"
  switch (nombre) {
    case "oc_leer_paquete":
      return `Paquete leído. Faltantes: ${(data.faltantes as string[]).join(", ") || "ninguno"}`
    case "oc_validar":
      return `apta=${String(data.apta)} · bloqueos: ${codigos(data.bloqueos)} · confirmaciones: ${codigos(data.confirmaciones)} · retroactiva=${String(data.retroactiva)}`
    case "oc_construir_payload":
      return `Payload construido. Trazabilidad: ${String(data.ruta_trazabilidad)}`
    case "oc_generar_evidencia":
      return `Evidencia: ${String(data.ruta)}`
    case "oc_crear":
      return `OC ${String(data.numero_oc)}${data.idempotente ? " (ya existía, sin duplicar)" : ""}`
    default:
      return "Ejecutada"
  }
}

/** El valor `confirmado` del modelo solo vale si la persona confirmó ese caso en su último mensaje. */
function aplicarCompuerta(llamada: LlamadaHerramienta, autorizados: Set<string>): unknown {
  if (llamada.nombre !== "oc_crear" || llamada.args === null || typeof llamada.args !== "object") return llamada.args
  const args = llamada.args as Registro
  return { ...args, confirmado: args.confirmado === true && autorizados.has(casoDe(args)) }
}

function actualizarPendientes(llamada: LlamadaHerramienta, resultado: Resultado, sesion: Sesion, autorizados: Set<string>): void {
  const caso = casoDe(llamada.args)
  if (llamada.nombre === "oc_validar" && resultado.ok) {
    const data = resultado.data as { apta: boolean; confirmaciones: unknown[] }
    const pendiente = data.apta && data.confirmaciones.length > 0 && !autorizados.has(caso)
    if (pendiente) sesion.pendientes.add(caso)
  }
  if (llamada.nombre !== "oc_crear") return
  if (resultado.ok) {
    sesion.pendientes.delete(caso)
    autorizados.delete(caso)
  } else if (resultado.error.startsWith(PREFIJO_REQUIERE_CONFIRMACION)) {
    sesion.pendientes.add(caso)
  }
}

async function ejecutarLlamada(llamada: LlamadaHerramienta, sesion: Sesion, autorizados: Set<string>, directory: string): Promise<LlamadaVisible> {
  const args = aplicarCompuerta(llamada, autorizados)
  const texto = await ejecutarHerramienta(llamada.nombre, args, { directory, sessionId: sesion.id })
  const resultado = JSON.parse(texto) as Resultado
  actualizarPendientes(llamada, resultado, sesion, autorizados)
  sesion.historial.push({ rol: "tool", llamadaId: llamada.id, resultado: texto, esError: !resultado.ok })
  return { nombre: llamada.nombre, args, ok: resultado.ok, resumen: resumir(llamada.nombre, resultado), resultado: texto }
}

function cerrarConPregunta(texto: string, sesion: Sesion): string {
  if (sesion.pendientes.size === 0 || texto.trimEnd().endsWith("?")) return texto
  const casos = [...sesion.pendientes].join(", ")
  return `${texto}\n\n¿Confirmas la creación de la OC de ${casos}?`.trim()
}

function mensajeTope(llamadas: LlamadaVisible[]): string {
  const hechas = llamadas.map((l) => `${l.nombre}: ${l.resumen}`).join("\n- ")
  return `Alcancé el tope de pasos de este turno y no terminé.\n\nLo que tengo:\n- ${hechas || "sin resultados"}\n\nFalta completar la solicitud: escribe "continúa" para seguir.`
}

type Salida = { texto: string; continuar: false } | { continuar: true }

async function iterar(sesion: Sesion, deps: DependenciasCiclo, herramientas: HerramientaLlm[], autorizados: Set<string>, llamadas: LlamadaVisible[]): Promise<Salida> {
  if (sesion.tokens >= deps.tokensPorSesion) return { continuar: false, texto: "Esta sesión alcanzó su tope de tokens. Abre una sesión nueva para seguir." }
  if (deps.presupuesto.agotado()) return { continuar: false, texto: "Se alcanzó el presupuesto diario de tokens de este servicio. Intenta de nuevo mañana." }

  const respuesta = await deps.llm.enviar([{ rol: "system", texto: deps.systemPrompt }, ...sesion.historial], herramientas)
  const tokens = respuesta.uso.entrada + respuesta.uso.salida
  sesion.tokens += tokens
  deps.presupuesto.consumir(tokens)

  // Una respuesta incompleta no se ejecuta ni se guarda: su tool_use parcial dañaría el historial.
  if (respuesta.fin === "truncado") return { continuar: false, texto: "La respuesta del modelo quedó incompleta, así que no ejecuté ninguna acción. Intenta de nuevo con una solicitud más corta." }
  if (respuesta.fin === "rechazo") return { continuar: false, texto: "El modelo no pudo atender esa solicitud. Reformúlala, por favor." }

  sesion.historial.push({ rol: "assistant", texto: respuesta.texto, llamadas: respuesta.llamadas, crudo: respuesta.crudo })
  if (respuesta.llamadas.length === 0) return { continuar: false, texto: respuesta.texto }
  for (const llamada of respuesta.llamadas) llamadas.push(await ejecutarLlamada(llamada, sesion, autorizados, deps.directory))
  return { continuar: true }
}

/** Un turno: modelo → herramientas → modelo, hasta responder o llegar al tope (CA1). */
export async function procesarTurno(sesion: Sesion, mensaje: string, deps: DependenciasCiclo): Promise<RespuestaTurno> {
  const autorizados = esConfirmacion(mensaje) ? new Set(sesion.pendientes) : new Set<string>()
  sesion.pendientes.clear()
  sesion.historial.push({ rol: "user", texto: mensaje })
  sesion.visibles.push({ rol: "user", texto: mensaje })

  const herramientas = definicionesHerramientas()
  const llamadas: LlamadaVisible[] = []
  let texto: string | null = null
  try {
    for (let i = 0; i < deps.maxIteraciones && texto === null; i++) {
      const salida = await iterar(sesion, deps, herramientas, autorizados, llamadas)
      if (!salida.continuar) texto = salida.texto
    }
    texto ??= mensajeTope(llamadas)
  } catch (error) {
    // CA5: el error se explica en el chat y la sesión sigue viva.
    if (!(error instanceof ErrorLlm)) console.error("Error en el ciclo del agente", error)
    texto = error instanceof ErrorLlm ? error.message : "Ocurrió un error inesperado. Puedes intentar de nuevo en esta misma sesión."
  }

  const reply = cerrarConPregunta(texto, sesion)
  const needsConfirmation = sesion.pendientes.size > 0
  sesion.visibles.push({ rol: "assistant", texto: reply, toolCalls: llamadas, needsConfirmation })
  return { reply, toolCalls: llamadas, needsConfirmation }
}
