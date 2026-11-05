import { normalizarNit, normalizarNombre } from "./parsers.ts"
import type { CentroCosto, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from "./tipos.ts"

const TOLERANCIA_COTIZACION = 0.02
const TOLERANCIA_ARITMETICA = 1

export function buscarProveedor(paquete: Paquete, maestros: Maestros): Proveedor | undefined {
  const { proveedor_nit: nit, proveedor_nombre: nombre } = paquete.solicitud
  if (nit) return maestros.proveedores.find((p) => normalizarNit(p.nit) === normalizarNit(nit))
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === normalizarNombre(nombre))
}

function buscarCentro(paquete: Paquete, maestros: Maestros): CentroCosto | undefined {
  return maestros.centrosCosto.find((c) => c.centro_costo === paquete.solicitud.centro_costo)
}

function buscarAprobador(paquete: Paquete, centro: CentroCosto | undefined) {
  const email = paquete.aprobacion?.de.toLowerCase()
  return centro?.aprobadores.find((a) => a.email.toLowerCase() === email)
}

function formato(valor: number, moneda: string): string {
  return `${moneda} ${valor.toLocaleString("es-CO")}`
}

const soloFecha = (fecha: string) => fecha.slice(0, 10)

function rc1(paquete: Paquete, maestros: Maestros): Hallazgo[] {
  const { proveedor_nit: nit, proveedor_nombre: nombre } = paquete.solicitud
  const proveedor = buscarProveedor(paquete, maestros)
  if (!proveedor) {
    const criterio = nit ? `NIT ${normalizarNit(nit)}` : `nombre "${nombre}"`
    return [{
      codigo: "RC1",
      detalle: `El proveedor "${nombre}" (${criterio}) no existe en el maestro.`,
      accion_sugerida: "Solicitar la creación del proveedor en el maestro o cambiar a un proveedor registrado.",
    }]
  }
  if (proveedor.activo) return []
  return [{
    codigo: "RC1",
    detalle: `El proveedor "${proveedor.nombre}" existe, pero está inactivo.`,
    accion_sugerida: "Pedir su reactivación al área de maestros o usar un proveedor activo.",
  }]
}

function accionAprobador(centro: CentroCosto | undefined, valor: number): string {
  const conTope = centro?.aprobadores.filter((a) => a.tope >= valor) ?? []
  if (conTope.length > 0) return `Solicitar aprobación a: ${conTope.map((a) => a.email).join(", ")}.`
  return "Ningún aprobador de este centro cubre el monto: escalar a dirección o dividir la decisión de compra con el área."
}

function rc2(paquete: Paquete, maestros: Maestros): Hallazgo[] {
  const centro = buscarCentro(paquete, maestros)
  const valor = paquete.solicitud.valor_total
  const accion = accionAprobador(centro, valor)
  const { aprobacion } = paquete
  if (!aprobacion) return [{ codigo: "RC2", detalle: "No hay correo de aprobación.", accion_sugerida: accion }]
  if (!aprobacion.aprobado) {
    return [{ codigo: "RC2", detalle: `El correo de ${aprobacion.de} no contiene una aprobación ("Aprobado").`, accion_sugerida: accion }]
  }
  if (buscarAprobador(paquete, centro)) return []
  return [{
    codigo: "RC2",
    detalle: `${aprobacion.de} no es aprobador del centro ${paquete.solicitud.centro_costo}.`,
    accion_sugerida: accion,
  }]
}

function rc3(paquete: Paquete, maestros: Maestros): Hallazgo[] {
  const centro = buscarCentro(paquete, maestros)
  const aprobador = buscarAprobador(paquete, centro)
  const { valor_total: valor, moneda } = paquete.solicitud
  if (!aprobador || valor <= aprobador.tope) return []
  return [{
    codigo: "RC3",
    detalle: `${formato(valor, moneda)} supera el tope de ${aprobador.email} (${formato(aprobador.tope, moneda)}).`,
    accion_sugerida: accionAprobador(centro, valor),
  }]
}

function rc4(paquete: Paquete, maestros: Maestros): Hallazgo[] {
  const { centro_costo: centroCosto, subarea } = paquete.solicitud
  const centro = buscarCentro(paquete, maestros)
  if (!centro) {
    return [{ codigo: "RC4", detalle: `El centro de costo ${centroCosto} no existe.`, accion_sugerida: "Corregir el centro de costo en la solicitud." }]
  }
  if (centro.subareas.includes(subarea)) return []
  return [{
    codigo: "RC4",
    detalle: `La subárea "${subarea}" no pertenece a ${centroCosto}.`,
    accion_sugerida: `Usar una de estas subáreas: ${centro.subareas.join(", ")}.`,
  }]
}

function rc5(paquete: Paquete): Hallazgo[] {
  const { solicitud, cotizacion } = paquete
  if (!cotizacion) {
    return [{ codigo: "RC5", detalle: "No hay cotización para comparar con la solicitud.", accion_sugerida: "Confirmar sin cotización o pedirla al solicitante." }]
  }
  if (cotizacion.moneda !== solicitud.moneda) {
    return [{
      codigo: "RC5",
      detalle: `La cotización está en ${cotizacion.moneda} y la solicitud en ${solicitud.moneda}: no son comparables.`,
      accion_sugerida: "Aclarar la moneda con el solicitante antes de confirmar.",
    }]
  }
  const desviacion = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
  if (desviacion <= TOLERANCIA_COTIZACION) return []
  const porcentaje = (desviacion * 100).toFixed(2)
  return [{
    codigo: "RC5",
    detalle: `Solicitud ${formato(solicitud.valor_total, solicitud.moneda)} frente a cotización ${formato(cotizacion.total, cotizacion.moneda)}: diferencia de ${porcentaje} %, superior al 2 %.`,
    accion_sugerida: "Confirmar por el valor aprobado de la solicitud o devolver para corregir y reaprobar.",
  }]
}

function rc6(paquete: Paquete, maestros: Maestros): Hallazgo[] {
  if (paquete.solicitud.indicador_iva) return []
  const proveedor = buscarProveedor(paquete, maestros)
  const detalle = proveedor
    ? `La solicitud no informa IVA. Se derivó ${proveedor.indicador_iva_default} del maestro de proveedores.`
    : "La solicitud no informa IVA y no se puede derivar porque el proveedor no existe."
  return [{ codigo: "RC6", detalle, accion_sugerida: "Confirmar el indicador de IVA o corregir la solicitud." }]
}

/** Control adicional al PRD: un código desconocido produciría una OC inválida en SAP. */
function codigosMaestros(paquete: Paquete, maestros: Maestros): Hallazgo[] {
  const { indicador_iva: iva, condiciones_pago: pago } = paquete.solicitud
  const hallazgos: Hallazgo[] = []
  if (iva && !maestros.indicadoresIva.some((i) => i.codigo === iva)) {
    hallazgos.push({ codigo: "EX1", detalle: `El indicador de IVA "${iva}" no está en el maestro.`, accion_sugerida: "Confirmar o corregir el código." })
  }
  if (pago && !maestros.condicionesPago.some((c) => c.codigo === pago)) {
    hallazgos.push({ codigo: "EX1", detalle: `La condición de pago "${pago}" no está en el maestro.`, accion_sugerida: "Confirmar o corregir el código." })
  }
  return hallazgos
}

function esRetroactiva(paquete: Paquete): boolean {
  return Boolean(paquete.factura && soloFecha(paquete.factura.fecha) < soloFecha(paquete.solicitud.fecha_solicitud))
}

function rc8(paquete: Paquete): Hallazgo[] {
  if (!paquete.factura || !esRetroactiva(paquete)) return []
  return [{
    codigo: "RC8",
    detalle: `Compra retroactiva: la factura ${paquete.factura.numero} (${soloFecha(paquete.factura.fecha)}) es anterior a la solicitud (${paquete.solicitud.fecha_solicitud}).`,
    accion_sugerida: "Confirmar para crear la OC; quedará marcada retroactiva = true en el log de control.",
  }]
}

function rc9(paquete: Paquete): Hallazgo[] {
  const { aprobacion, solicitud } = paquete
  if (!aprobacion || soloFecha(aprobacion.fecha) >= soloFecha(solicitud.fecha_solicitud)) return []
  return [{
    codigo: "RC9",
    detalle: `La aprobación (${soloFecha(aprobacion.fecha)}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`,
    accion_sugerida: "Confirmar que esa aprobación corresponde a esta solicitud o pedir una nueva.",
  }]
}

function rc10(paquete: Paquete): Hallazgo[] {
  const { cantidad, valor_unitario: unitario, valor_total: total, moneda } = paquete.solicitud
  if (Math.abs(cantidad * unitario - total) <= TOLERANCIA_ARITMETICA) return []
  return [{
    codigo: "RC10",
    detalle: `${cantidad} × ${formato(unitario, moneda)} no iguala el total ${formato(total, moneda)}.`,
    accion_sugerida: "Pedir al solicitante que corrija la cantidad, el valor unitario o el total.",
  }]
}

/** RC1-RC10. Es la única fuente de verdad: las usan el chat, el demo y `oc_crear`. */
export function validar(paquete: Paquete, maestros: Maestros): Validacion {
  const proveedor = buscarProveedor(paquete, maestros)
  const bloqueos = [...rc1(paquete, maestros), ...rc2(paquete, maestros), ...rc3(paquete, maestros), ...rc4(paquete, maestros), ...rc10(paquete)]
  const confirmaciones = [...rc5(paquete), ...rc6(paquete, maestros), ...rc8(paquete), ...rc9(paquete), ...codigosMaestros(paquete, maestros)]
  const derivados: Validacion["derivados"] = {}
  if (proveedor) {
    derivados.codigo_sap = proveedor.codigo_sap
    if (!paquete.solicitud.indicador_iva) derivados.indicador_iva = proveedor.indicador_iva_default
    if (!paquete.solicitud.condiciones_pago) derivados.condiciones_pago = proveedor.condiciones_pago_default
  }
  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva: esRetroactiva(paquete) }
}
