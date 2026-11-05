import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { z } from "zod"
import { contieneAprobado, parsearCotizacion, parsearFactura } from "./parsers.ts"
import {
  aprobacionCrudaSchema,
  centroCostoSchema,
  condicionPagoSchema,
  correoSchema,
  ErrorOc,
  indicadorIvaSchema,
  proveedorSchema,
  solicitudSchema,
  type AprobacionCruda,
  type Maestros,
  type Paquete,
} from "./tipos.ts"

const raizFixtures = (directorio: string) => join(directorio, "fixtures", "reto-03")

function rutaCaso(directorio: string, caso: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(caso)) throw new ErrorOc(`Nombre de caso inválido: "${caso}".`)
  const ruta = join(raizFixtures(directorio), "solicitudes", caso)
  if (!existsSync(ruta)) throw new ErrorOc(`No existe el caso "${caso}". Verifica el nombre, por ejemplo "sol-001".`)
  return ruta
}

function leerJson<T>(ruta: string, nombre: string, esquema: z.ZodType<T>): T {
  let crudo: unknown
  try {
    crudo = JSON.parse(readFileSync(ruta, "utf8"))
  } catch {
    throw new ErrorOc(`${nombre} no es un JSON válido. Pide al solicitante que reenvíe el archivo.`)
  }
  const resultado = esquema.safeParse(crudo)
  if (resultado.success) return resultado.data
  const detalle = resultado.error.issues.map((i) => `${i.path.join(".") || "archivo"}: ${i.message}`).join("; ")
  throw new ErrorOc(`${nombre} tiene datos inválidos (${detalle}). Pide al solicitante que lo corrija.`)
}

function leerJsonOpcional<T>(ruta: string, nombre: string, esquema: z.ZodType<T>): T | null {
  return existsSync(ruta) ? leerJson(ruta, nombre, esquema) : null
}

function leerTextoOpcional(ruta: string): string | null {
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

export function leerAprobacionCruda(directorio: string, caso: string): AprobacionCruda | null {
  return leerJsonOpcional(join(rutaCaso(directorio, caso), "aprobacion.json"), "aprobacion.json", aprobacionCrudaSchema)
}

/** Lee y normaliza el paquete. Un adjunto ausente queda en null; un paquete sin base lanza ErrorOc. */
export function leerPaquete(directorio: string, caso: string): Paquete {
  const ruta = rutaCaso(directorio, caso)
  const correo = leerJsonOpcional(join(ruta, "correo.json"), "correo.json", correoSchema)
  const solicitud = leerJsonOpcional(join(ruta, "solicitud.json"), "solicitud.json", solicitudSchema)
  if (!correo || !solicitud) {
    const falta = [!correo && "correo.json", !solicitud && "solicitud.json"].filter(Boolean).join(" y ")
    throw new ErrorOc(`Paquete incompleto: falta ${falta}. Pídelo al solicitante.`)
  }

  const textoCotizacion = leerTextoOpcional(join(ruta, "cotizacion.txt"))
  const textoFactura = leerTextoOpcional(join(ruta, "factura.txt"))
  const aprobacion = leerAprobacionCruda(directorio, caso)
  const facturaDeclarada = correo.adjuntos.some((a) => /^factura\./i.test(a))

  const faltantes = [
    textoCotizacion === null && "cotizacion.txt",
    aprobacion === null && "aprobacion.json",
    textoFactura === null && facturaDeclarada && "factura.txt",
  ].filter((f): f is string => Boolean(f))

  return {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: textoCotizacion === null ? null : parsearCotizacion(textoCotizacion),
    aprobacion: aprobacion && {
      de: aprobacion.de,
      fecha: aprobacion.fecha,
      aprobado: contieneAprobado(aprobacion.cuerpo),
      texto: aprobacion.cuerpo,
    },
    factura: textoFactura === null ? null : parsearFactura(textoFactura),
    faltantes,
  }
}

export function leerMaestros(directorio: string): Maestros {
  const ruta = (archivo: string) => join(raizFixtures(directorio), "maestros", archivo)
  return {
    proveedores: leerJson(ruta("proveedores.json"), "proveedores.json", proveedorSchema.array()),
    centrosCosto: leerJson(ruta("centros-costo.json"), "centros-costo.json", centroCostoSchema.array()),
    indicadoresIva: leerJson(ruta("indicadores-iva.json"), "indicadores-iva.json", indicadorIvaSchema.array()),
    condicionesPago: leerJson(ruta("condiciones-pago.json"), "condiciones-pago.json", condicionPagoSchema.array()),
  }
}
