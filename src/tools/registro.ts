import { z } from "zod"
import { registrarLlamada } from "../oc/registros.ts"
import * as oc from "./oc.ts"
import type { ToolCtx } from "./oc.ts"

type Herramienta = {
  description: string
  args: z.ZodRawShape
  execute(args: never, ctx: ToolCtx): Promise<string>
}

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

/** El nombre que ve el modelo es `<archivo>_<export>`. */
function conPrefijo(archivo: string, modulo: Record<string, unknown>): Map<string, Herramienta> {
  return new Map(
    Object.entries(modulo)
      .filter(([, valor]) => typeof valor === "object" && valor !== null && "execute" in valor)
      .map(([nombre, valor]) => [`${archivo}_${nombre}`, valor as Herramienta]),
  )
}

const herramientas = conPrefijo("oc", oc)

export function definicionesHerramientas(): DefinicionHerramienta[] {
  return [...herramientas].map(([nombre, h]) => ({
    nombre,
    descripcion: h.description,
    esquema: z.toJSONSchema(z.object(h.args)) as Record<string, unknown>,
  }))
}

/** Único punto de ejecución: valida con zod, ejecuta y registra. El chat y demo.ts pasan por aquí. */
export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: ToolCtx): Promise<string> {
  const resultado = await ejecutarSinLog(nombre, args, ctx)
  registrarLlamada(ctx.directory, { sessionId: ctx.sessionId, herramienta: nombre, args, resultado })
  return resultado
}

async function ejecutarSinLog(nombre: string, args: unknown, ctx: ToolCtx): Promise<string> {
  const herramienta = herramientas.get(nombre)
  if (!herramienta) return JSON.stringify({ ok: false, error: `La herramienta "${nombre}" no existe.` })
  const validados = z.object(herramienta.args).safeParse(args)
  if (!validados.success) {
    const detalle = validados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return JSON.stringify({ ok: false, error: `Argumentos inválidos para ${nombre}: ${detalle}` })
  }
  return herramienta.execute(validados.data as never, ctx)
}
