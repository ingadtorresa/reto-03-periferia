import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buscarProveedor, validar } from "./controles.ts"
import { hashEvidencia } from "./evidencia.ts"
import { inferirUnidad, referenciaCotizacion, textoBreveSap } from "./parsers.ts"
import { leerAprobacionCruda, leerMaestros, leerPaquete } from "./repositorio.ts"
import { ErrorOc, ordenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Validacion } from "./tipos.ts"

type Fuente = "solicitud" | "cotizacion" | `maestro.${string}` | "derivado"
type Traza = { valor: string | number | null; fuente: Fuente; detalle?: string }

export type CasoEvaluado = { paquete: Paquete; maestros: Maestros; validacion: Validacion }

/** Toda decisión se recalcula desde fixtures: nunca desde lo que envíe el modelo. */
export function evaluarCaso(directorio: string, caso: string): CasoEvaluado {
  const paquete = leerPaquete(directorio, caso)
  const maestros = leerMaestros(directorio)
  return { paquete, maestros, validacion: validar(paquete, maestros) }
}

function trazaDerivable(valor: string | undefined, porDefecto: string, campoMaestro: string): Traza {
  return valor
    ? { valor, fuente: "solicitud" }
    : { valor: porDefecto, fuente: "maestro.proveedores", detalle: campoMaestro }
}

/** Construye la OC y su trazabilidad. Falla si la solicitud tiene bloqueos. */
export function construirOrden(directorio: string, caso: string, evaluado: CasoEvaluado) {
  const { paquete, maestros, validacion } = evaluado
  if (!validacion.apta) {
    throw new ErrorOc(`La solicitud tiene bloqueos: ${validacion.bloqueos.map((b) => b.codigo).join(", ")}. No se construye la OC.`)
  }
  const proveedor = buscarProveedor(paquete, maestros)
  const aprobacion = leerAprobacionCruda(directorio, caso)
  if (!proveedor || !aprobacion) throw new ErrorOc("Faltan datos de proveedor o aprobación para construir la OC.")

  const { solicitud, cotizacion } = paquete
  const iva = trazaDerivable(solicitud.indicador_iva, proveedor.indicador_iva_default, "indicador_iva_default")
  const pago = trazaDerivable(solicitud.condiciones_pago, proveedor.condiciones_pago_default, "condiciones_pago_default")
  const cotizacionRef = cotizacion ? referenciaCotizacion(cotizacion.texto) : null
  const descripcion = textoBreveSap(solicitud.descripcion)
  const unidad = inferirUnidad(solicitud.descripcion)
  const sha256 = hashEvidencia(aprobacion)

  const orden: OrdenCompra = ordenCompraSchema.parse({
    referencia: { solicitud_id: solicitud.solicitud_id, correo_id: paquete.correo.id, cotizacion_ref: cotizacionRef },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago: pago.valor,
    aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: sha256 },
    posiciones: [{
      numero: 10,
      descripcion,
      cantidad: solicitud.cantidad,
      unidad,
      precio_unitario: solicitud.valor_unitario,
      centro_costo: solicitud.centro_costo,
      subarea: solicitud.subarea,
      indicador_iva: iva.valor,
    }],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  })

  const trazabilidad: Record<string, Traza> = {
    "referencia.solicitud_id": { valor: solicitud.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: paquete.correo.id, fuente: "derivado", detalle: "correo.json" },
    "referencia.cotizacion_ref": { valor: cotizacionRef, fuente: "cotizacion" },
    sociedad: { valor: "1000", fuente: "derivado", detalle: "constante del PRD 7.4" },
    organizacion_compras: { valor: "1000", fuente: "derivado", detalle: "constante del PRD 7.4" },
    "proveedor.codigo_sap": { valor: proveedor.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: proveedor.nit, fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: proveedor.nombre, fuente: "maestro.proveedores" },
    moneda: { valor: solicitud.moneda, fuente: "solicitud" },
    condiciones_pago: pago,
    "aprobador.email": { valor: aprobacion.de, fuente: "derivado", detalle: "aprobacion.json, validado contra maestro.centros-costo" },
    "aprobador.fecha_aprobacion": { valor: aprobacion.fecha, fuente: "derivado", detalle: "aprobacion.json" },
    "aprobador.evidencia_sha256": { valor: sha256, fuente: "derivado", detalle: "SHA-256 del contenido de la evidencia" },
    "posiciones[0].numero": { valor: 10, fuente: "derivado", detalle: "numeración SAP de 10 en 10" },
    "posiciones[0].descripcion": { valor: descripcion, fuente: "derivado", detalle: `texto breve de 40 caracteres; original en solicitud: "${solicitud.descripcion}"` },
    "posiciones[0].cantidad": { valor: solicitud.cantidad, fuente: "solicitud" },
    "posiciones[0].unidad": { valor: unidad, fuente: "derivado", detalle: "inferida de la descripción de la solicitud" },
    "posiciones[0].precio_unitario": { valor: solicitud.valor_unitario, fuente: "solicitud" },
    "posiciones[0].centro_costo": { valor: solicitud.centro_costo, fuente: "solicitud" },
    "posiciones[0].subarea": { valor: solicitud.subarea, fuente: "solicitud" },
    "posiciones[0].indicador_iva": iva,
  }

  const carpeta = join(directorio, "out", caso)
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(join(carpeta, "trazabilidad.json"), `${JSON.stringify(trazabilidad, null, 2)}\n`, "utf8")
  return { orden, ruta_trazabilidad: `out/${caso}/trazabilidad.json` }
}

/** JSON con llaves ordenadas: compara por contenido, sin depender del orden que use el modelo. */
function canonico(valor: unknown): string {
  return JSON.stringify(valor, (_llave, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v
    const objeto = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(objeto).sort().map((k) => [k, objeto[k]]))
  })
}

/** Compara solo los campos que llegaron. Sirve para detectar datos alterados en tránsito por el modelo. */
export function coincideParcial(enviado: unknown, real: unknown): boolean {
  if (enviado === undefined) return true
  if (enviado === null || typeof enviado !== "object" || Array.isArray(enviado)) return canonico(enviado) === canonico(real)
  if (real === null || typeof real !== "object") return false
  const base = real as Record<string, unknown>
  return Object.entries(enviado).every(([k, v]) => coincideParcial(v, base[k]))
}

/** El payload debe ser exactamente el calculado; `confirmado_por` lo asigna el backend. */
export function ordenesIguales(enviada: OrdenCompra, real: OrdenCompra): boolean {
  const sinFirma = (o: OrdenCompra) => ({ ...o, excepciones: o.excepciones.map((e) => ({ ...e, confirmado_por: null })) })
  return canonico(sinFirma(enviada)) === canonico(sinFirma(real))
}

export { leerPaquete }
