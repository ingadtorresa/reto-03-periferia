import { z } from "zod"

/** Error de negocio con mensaje legible. Las herramientas lo convierten en `{ ok: false, error }`. */
export class ErrorOc extends Error {}

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "debe ser una fecha AAAA-MM-DD")

export const correoSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: fechaIso,
  adjuntos: z.array(z.string()).default([]),
})

export const solicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(),
  valor_total: z.number().positive(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: fechaIso,
})
export type Solicitud = z.infer<typeof solicitudSchema>

export const aprobacionCrudaSchema = z.object({
  de: z.string().min(1),
  para: z.string().default(""),
  fecha: fechaIso,
  asunto: z.string().default(""),
  cuerpo: z.string(),
})
export type AprobacionCruda = z.infer<typeof aprobacionCrudaSchema>

/** Paquete normalizado del PRD 7.2, más `faltantes` para cumplir HU-1. */
export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: {
    proveedor: string
    nit: string | null
    total: number
    moneda: string
    validez_hasta: string | null
    texto: string
  } | null
  aprobacion: { de: string; fecha: string; aprobado: boolean; texto: string } | null
  factura: { numero: string; fecha: string; total: number } | null
  faltantes: string[]
}

export const proveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export type Proveedor = z.infer<typeof proveedorSchema>

export const centroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
export type CentroCosto = z.infer<typeof centroCostoSchema>

export const indicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const condicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Maestros = {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: z.infer<typeof indicadorIvaSchema>[]
  condicionesPago: z.infer<typeof condicionPagoSchema>[]
}

/** Esquema del PRD 7.4. */
export const ordenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().min(1).max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof ordenCompraSchema>

export type Hallazgo = { codigo: string; detalle: string; accion_sugerida: string }

export type Derivados = {
  codigo_sap?: string
  indicador_iva?: string
  condiciones_pago?: string
}

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}
