import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizarNit } from "../oc/parsers.ts"
import { leerMaestros } from "../oc/repositorio.ts"
import type { OrdenCompra } from "../oc/tipos.ts"
import type { SapAdapter } from "./adapter.ts"

const PRIMER_NUMERO = 4500000001n

type Registro = { numero_oc: string; fecha: string; orden: OrdenCompra }

/** Serializa las escrituras por archivo: dos clics seguidos no pueden generar dos OC. */
const colas = new Map<string, Promise<unknown>>()

function enCola<T>(ruta: string, tarea: () => T): Promise<T> {
  const siguiente = (colas.get(ruta) ?? Promise.resolve()).then(tarea, tarea)
  colas.set(ruta, siguiente.catch(() => undefined))
  return siguiente
}

export class SapMock implements SapAdapter {
  private readonly carpeta: string
  private readonly ruta: string

  constructor(private readonly directorio: string) {
    this.carpeta = join(directorio, "out", "sap")
    this.ruta = join(this.carpeta, "ordenes.jsonl")
  }

  private leer(): Registro[] {
    if (!existsSync(this.ruta)) return []
    return readFileSync(this.ruta, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((linea) => JSON.parse(linea) as Registro)
  }

  async consultarProveedor(nit: string) {
    const proveedor = leerMaestros(this.directorio).proveedores.find((p) => normalizarNit(p.nit) === normalizarNit(nit))
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const existente = this.leer().find((r) => r.orden.referencia.solicitud_id === solicitud_id)
    return existente ? { numero_oc: existente.numero_oc } : null
  }

  /** Idempotente por `solicitud_id`: si ya existe, devuelve el número y la fecha originales. */
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return enCola(this.ruta, () => {
      const registros = this.leer()
      const existente = registros.find((r) => r.orden.referencia.solicitud_id === orden.referencia.solicitud_id)
      if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }
      const registro: Registro = {
        numero_oc: String(PRIMER_NUMERO + BigInt(registros.length)),
        fecha: new Date().toISOString(),
        orden,
      }
      mkdirSync(this.carpeta, { recursive: true })
      appendFileSync(this.ruta, `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
  }
}
