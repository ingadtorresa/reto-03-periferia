import { z } from "zod"
import { generarEvidencia } from "../oc/evidencia.ts"
import { coincideParcial, construirOrden, evaluarCaso, leerPaquete, ordenesIguales, type CasoEvaluado } from "../oc/payload.ts"
import { registrarControl, type FilaControl } from "../oc/registros.ts"
import { ErrorOc, ordenCompraSchema, type Hallazgo, type OrdenCompra } from "../oc/tipos.ts"
import { SapMock } from "../sap/mock.ts"

export type ToolCtx = { directory: string; sessionId: string }

const caso = z.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-001"')
const paquete = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Paquete de oc_leer_paquete. Opcional: el backend lo relee de los fixtures y rechaza cualquier valor alterado")

/** Las herramientas nunca lanzan: todo error sale como `{ ok: false, error }`. */
async function responder(tarea: () => unknown | Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify({ ok: true, data: await tarea() })
  } catch (error) {
    if (error instanceof ErrorOc) return JSON.stringify({ ok: false, error: error.message })
    console.error("Error interno en herramienta", error)
    return JSON.stringify({ ok: false, error: "Error interno al ejecutar la herramienta. Intenta de nuevo o revisa los logs." })
  }
}

function verificarNoAlterado(enviado: unknown, real: unknown, nombre: string): void {
  if (!coincideParcial(enviado, real)) {
    throw new ErrorOc(`El ${nombre} recibido no coincide con el calculado desde los archivos. No se modifican valores: vuelve a leer el caso.`)
  }
}

/** Registra un intento sin OC creada. */
function registrarSinOc(ctx: ToolCtx, evaluado: CasoEvaluado, resultado: FilaControl["resultado"], bloqueos: Hallazgo[]): void {
  registrarControl(ctx.directory, {
    solicitud_id: evaluado.paquete.solicitud.solicitud_id,
    resultado,
    numero_oc: null,
    retroactiva: evaluado.validacion.retroactiva,
    bloqueos,
    confirmaciones: evaluado.validacion.confirmaciones,
  })
}

export const leer_paquete = {
  description: "Lee y normaliza correo, solicitud, cotización, aprobación y factura de un caso; es el primer paso para procesar una solicitud.",
  args: { caso },
  execute(args: { caso: string }, ctx: ToolCtx): Promise<string> {
    return responder(() => leerPaquete(ctx.directory, args.caso))
  },
}

export const validar = {
  description: "Aplica las reglas de control RC1 a RC10 y devuelve si la solicitud es apta, sus bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: { caso, paquete },
  execute(args: { caso: string; paquete?: Record<string, unknown> }, ctx: ToolCtx): Promise<string> {
    return responder(() => {
      const evaluado = evaluarCaso(ctx.directory, args.caso)
      verificarNoAlterado(args.paquete, evaluado.paquete, "paquete")
      const { validacion } = evaluado
      if (!validacion.apta) registrarSinOc(ctx, evaluado, "bloqueado", validacion.bloqueos)
      else if (validacion.confirmaciones.length > 0) registrarSinOc(ctx, evaluado, "pendiente", [])
      return validacion
    })
  },
}

export const construir_payload = {
  description: "Construye la orden de compra exactamente como quedaría en SAP y guarda la trazabilidad de cada valor; falla si la solicitud tiene bloqueos.",
  args: {
    caso,
    paquete,
    derivados: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Derivados de oc_validar. Opcional: el backend los recalcula y rechaza cualquier valor alterado"),
  },
  execute(args: { caso: string; paquete?: Record<string, unknown>; derivados?: Record<string, unknown> }, ctx: ToolCtx): Promise<string> {
    return responder(() => {
      const evaluado = evaluarCaso(ctx.directory, args.caso)
      verificarNoAlterado(args.paquete, evaluado.paquete, "paquete")
      verificarNoAlterado(args.derivados, evaluado.validacion.derivados, "conjunto de derivados")
      return construirOrden(ctx.directory, args.caso, evaluado)
    })
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación en texto y PDF con su hash SHA-256 y devuelve la ruta.",
  args: { caso },
  execute(args: { caso: string }, ctx: ToolCtx): Promise<string> {
    return responder(() => generarEvidencia(ctx.directory, args.caso))
  },
}

function firmarExcepciones(orden: OrdenCompra, ctx: ToolCtx, confirmado: boolean): OrdenCompra {
  const firma = confirmado ? `analista (sesión ${ctx.sessionId})` : null
  return { ...orden, excepciones: orden.excepciones.map((e) => ({ ...e, confirmado_por: firma })) }
}

async function ejecutarCreacion(args: { caso: string; payload: OrdenCompra; confirmado?: boolean }, ctx: ToolCtx) {
  const evaluado = evaluarCaso(ctx.directory, args.caso)
  const { validacion, paquete: datos } = evaluado

  if (!validacion.apta) {
    registrarSinOc(ctx, evaluado, "bloqueado", validacion.bloqueos)
    throw new ErrorOc(`OC bloqueada: ${validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" ")}`)
  }
  const { orden } = construirOrden(ctx.directory, args.caso, evaluado)
  if (!ordenesIguales(args.payload, orden)) {
    registrarSinOc(ctx, evaluado, "bloqueado", [{ codigo: "PAYLOAD_ALTERADO", detalle: "El payload no coincide.", accion_sugerida: "Reconstruirlo." }])
    throw new ErrorOc("El payload recibido no coincide con el calculado desde los archivos. Reconstrúyelo con oc_construir_payload sin cambiar valores.")
  }
  const confirmado = args.confirmado === true
  if (validacion.confirmaciones.length > 0 && !confirmado) {
    registrarSinOc(ctx, evaluado, "pendiente", [])
    throw new ErrorOc(`Requiere confirmación humana: ${validacion.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join(" ")}`)
  }

  const evidencia = await generarEvidencia(ctx.directory, args.caso)
  const sap = new SapMock(ctx.directory)
  const existente = await sap.buscarOrdenPorReferencia(datos.solicitud.solicitud_id)
  const creada = await sap.crearOrden(firmarExcepciones(orden, ctx, confirmado))
  registrarControl(ctx.directory, {
    solicitud_id: datos.solicitud.solicitud_id,
    resultado: "exitoso",
    numero_oc: creada.numero_oc,
    retroactiva: validacion.retroactiva,
    bloqueos: [],
    confirmaciones: validacion.confirmaciones,
  })
  return { ...creada, idempotente: existente !== null, retroactiva: validacion.retroactiva, evidencia: evidencia.ruta }
}

export const crear = {
  description: "Crea la OC en SAP simulado si es apta; con confirmaciones exige confirmado=true, y repetirla devuelve el número existente.",
  args: {
    caso,
    payload: ordenCompraSchema.describe("Orden exacta devuelta por oc_construir_payload, sin cambiar ningún valor"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó de forma explícita en su último mensaje"),
  },
  execute(args: { caso: string; payload: OrdenCompra; confirmado?: boolean }, ctx: ToolCtx): Promise<string> {
    return responder(() => ejecutarCreacion(args, ctx))
  },
}
