import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { HerramientaLlm, LlmAdapter, Mensaje, RespuestaLlm } from "../src/llm/adapter.ts"
import { ejecutarHerramienta } from "../src/tools/registro.ts"

const raiz = join(import.meta.dirname, "..")

/** Copia temporal del proyecto: las pruebas pueden alterar datos sin tocar fixtures/. */
export function proyectoTemporal(): string {
  const directorio = mkdtempSync(join(tmpdir(), "oc-prueba-"))
  cpSync(join(raiz, "fixtures"), join(directorio, "fixtures"), { recursive: true })
  cpSync(join(raiz, "web"), join(directorio, "web"), { recursive: true })
  return directorio
}

export function rutaCaso(directorio: string, caso: string, archivo: string): string {
  return join(directorio, "fixtures", "reto-03", "solicitudes", caso, archivo)
}

export function ajustarJson(ruta: string, cambio: (dato: Record<string, unknown>) => void): void {
  const dato = JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown>
  cambio(dato)
  writeFileSync(ruta, JSON.stringify(dato), "utf8")
}

export type RespuestaHerramienta<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string }

export function llamador(directory: string, sessionId = "prueba") {
  return async <T = Record<string, unknown>>(nombre: string, args: unknown) =>
    JSON.parse(await ejecutarHerramienta(nombre, args, { directory, sessionId })) as RespuestaHerramienta<T>
}

export type Guion = (mensajes: Mensaje[], paso: number) => Partial<RespuestaLlm>

/** Modelo simulado: permite probar el ciclo completo sin consumir la API. */
export class LlmGuionizado implements LlmAdapter {
  readonly proveedor = "simulado"
  readonly modelo = "guion"
  paso = 0
  herramientas: HerramientaLlm[] = []

  constructor(private readonly guion: Guion) {}

  async enviar(mensajes: Mensaje[], herramientas: HerramientaLlm[]): Promise<RespuestaLlm> {
    this.herramientas = herramientas
    this.paso += 1
    return { texto: "", llamadas: [], fin: "fin", uso: { entrada: 10, salida: 10 }, ...this.guion(mensajes, this.paso) }
  }
}
