import { ErrorOc, type Paquete } from "./tipos.ts"

/** Convierte "11.400.000", "1,200.50" o "3200000" en número. Devuelve null si es ambiguo o inválido. */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.trim()
  let normalizado: string | null = null
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio)) normalizado = limpio.replaceAll(".", "").replace(",", ".")
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(limpio)) normalizado = limpio.replaceAll(",", "")
  else if (/^\d+([.,]\d{1,2})?$/.test(limpio)) normalizado = limpio.replace(",", ".")
  return normalizado === null ? null : Number(normalizado)
}

/** Deja solo el cuerpo del NIT: "900.555.111-2" → "900555111". */
export function normalizarNit(nit: string): string {
  return (nit.split("-")[0] ?? "").replace(/\D/g, "")
}

/** Minúsculas, sin tildes ni puntuación: "S.A.S." → "sas". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function campo(texto: string, patron: RegExp): string | null {
  return patron.exec(texto)?.[1]?.trim() ?? null
}

function sumarDias(fecha: string, dias: number): string {
  const base = new Date(`${fecha}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

function montoObligatorio(texto: string, patron: RegExp, documento: string): { moneda: string; total: number } {
  const coincidencia = patron.exec(texto)
  const total = coincidencia?.[2] ? parsearMonto(coincidencia[2]) : null
  if (!coincidencia?.[1] || total === null) {
    throw new ErrorOc(`${documento}: el total no es numérico o no se encontró. Pide al solicitante un documento legible.`)
  }
  return { moneda: coincidencia[1].toUpperCase(), total }
}

export function parsearCotizacion(texto: string): NonNullable<Paquete["cotizacion"]> {
  const { moneda, total } = montoObligatorio(texto, /^TOTAL[^:\n]*:\s*([A-Z]{3})\s*([\d.,]+)\s*$/im, "cotizacion.txt")
  const nit = campo(texto, /^NIT:\s*(.+)$/im)
  const fecha = campo(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)
  const dias = campo(texto, /^Validez[^:\n]*:\s*(\d+)\s*d[ií]as/im)
  return {
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/im) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total,
    moneda,
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

/** Referencia del documento, necesaria para `referencia.cotizacion_ref` del payload. */
export function referenciaCotizacion(texto: string): string | null {
  return campo(texto, /^COTIZACI[ÓO]N\s+(\S+)/im)
}

export function parsearFactura(texto: string): NonNullable<Paquete["factura"]> {
  const numero = campo(texto, /No\.\s*(\S+)/i)
  const fecha = campo(texto, /^Fecha[^:\n]*:\s*(\d{4}-\d{2}-\d{2})/im)
  const { total } = montoObligatorio(texto, /^TOTAL[^:\n]*:\s*([A-Z]{3})\s*([\d.,]+)\s*$/im, "factura.txt")
  if (!numero || !fecha) throw new ErrorOc("factura.txt: falta el número o la fecha de emisión.")
  return { numero, fecha, total }
}

/** RC2: exige la palabra "Aprobado" y descarta negaciones evidentes como "no aprobado". */
export function contieneAprobado(cuerpo: string): boolean {
  if (!/\baprobado\b/i.test(cuerpo)) return false
  return !/\b(no|sin)\s+(est[aá]\s+|es\s+|queda\s+|fue\s+)?aprobado\b/i.test(cuerpo)
}

/** Texto breve de SAP: máximo 40 caracteres, cortando en un límite de palabra. */
export function textoBreveSap(descripcion: string): string {
  const texto = descripcion.replace(/\s+/g, " ").trim()
  if (texto.length <= 40) return texto
  const corte = texto.slice(0, 40)
  const espacio = corte.lastIndexOf(" ")
  return (espacio >= 20 ? corte.slice(0, espacio) : corte)
    .replace(/(\s+(de|del|la|el|los|las|y|o|a|en|con|para|por))+$/i, "")
    .replace(/[\s,;:.-]+$/, "")
}

/** La solicitud no trae unidad: se infiere de la descripción y por defecto es "UN". */
export function inferirUnidad(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  if (/\b(mensualidad(es)?|suscripci[oó]n mensual|por mes)\b/i.test(descripcion)) return "MES"
  return "UN"
}
