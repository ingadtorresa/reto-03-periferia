import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Hallazgo } from "./tipos.ts"

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"

export type FilaControl = {
  solicitud_id: string
  resultado: "exitoso" | "bloqueado" | "pendiente"
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
}

function celda(valor: string): string {
  // El prefijo evita que una hoja de cálculo interprete el dato como fórmula.
  const seguro = /^[=+\-@]/.test(valor) ? `'${valor}` : valor
  return /[",\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro
}

const codigos = (hallazgos: Hallazgo[]) => hallazgos.map((h) => h.codigo).join(";")

/** HU-5: cada intento (exitoso, bloqueado o pendiente) agrega una fila a out/control.csv. */
export function registrarControl(directorio: string, fila: FilaControl): void {
  const carpeta = join(directorio, "out")
  mkdirSync(carpeta, { recursive: true })
  const ruta = join(carpeta, "control.csv")
  if (!existsSync(ruta)) appendFileSync(ruta, ENCABEZADO, "utf8")
  const columnas = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    codigos(fila.bloqueos),
    codigos(fila.confirmaciones),
    new Date().toISOString(),
  ]
  appendFileSync(ruta, `${columnas.map(celda).join(",")}\n`, "utf8")
}

/** Métrica que pide la dirección: qué porcentaje de las OC creadas es retroactivo. */
export function resumenControl(directorio: string) {
  const ruta = join(directorio, "out", "control.csv")
  const filas = existsSync(ruta) ? readFileSync(ruta, "utf8").split("\n").slice(1).filter(Boolean) : []
  const creadas = new Map<string, boolean>()
  let intentos = 0
  for (const fila of filas) {
    const [solicitud = "", resultado, , retroactiva] = fila.split(",")
    intentos += 1
    if (resultado === "exitoso") creadas.set(solicitud, retroactiva === "true")
  }
  const retroactivas = [...creadas.values()].filter(Boolean).length
  const porcentaje = creadas.size === 0 ? 0 : Math.round((retroactivas / creadas.size) * 1000) / 10
  return { intentos, oc_creadas: creadas.size, retroactivas, porcentaje_retroactivas: porcentaje }
}

/** CA4: toda llamada a herramienta queda en out/log.jsonl. */
export function registrarLlamada(directorio: string, entrada: { sessionId: string; herramienta: string; args: unknown; resultado: string }): void {
  const carpeta = join(directorio, "out")
  mkdirSync(carpeta, { recursive: true })
  appendFileSync(join(carpeta, "log.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`, "utf8")
}
