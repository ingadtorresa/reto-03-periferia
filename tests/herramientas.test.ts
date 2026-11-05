import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { contieneAprobado, inferirUnidad, normalizarNit, normalizarNombre, parsearCotizacion, parsearMonto, textoBreveSap } from "../src/oc/parsers.ts"
import type { OrdenCompra, Validacion } from "../src/oc/tipos.ts"
import { ajustarJson, llamador, proyectoTemporal, rutaCaso } from "./ayuda.ts"

async function validar(directorio: string, caso: string): Promise<Validacion> {
  const r = await llamador(directorio)<Validacion>("oc_validar", { caso })
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const codigos = (hallazgos: { codigo: string }[]) => hallazgos.map((h) => h.codigo)

describe("parsers", () => {
  it("interpreta montos en formato colombiano e internacional y rechaza texto", () => {
    expect(parsearMonto("11.400.000")).toBe(11400000)
    expect(parsearMonto("1,200.50")).toBe(1200.5)
    expect(parsearMonto("3200000")).toBe(3200000)
    expect(parsearMonto("abc")).toBeNull()
  })

  it("normaliza NIT y nombres", () => {
    expect(normalizarNit("900.555.111-2")).toBe("900555111")
    expect(normalizarNombre("  Papelería  Central LTDA. ")).toBe("papeleria central ltda")
  })

  it("calcula la validez de la cotización", () => {
    const cotizacion = parsearCotizacion("Fecha: 2026-08-18\nProveedor: X\nNIT: 900.555.111-2\nTOTAL (IVA incluido): COP 11.400.000\nValidez de la oferta: 30 días\n")
    expect(cotizacion).toMatchObject({ total: 11400000, moneda: "COP", nit: "900555111", validez_hasta: "2026-09-17" })
  })

  it('exige "Aprobado" y descarta negaciones', () => {
    expect(contieneAprobado("Aprobado, proceder.")).toBe(true)
    expect(contieneAprobado("No aprobado por ahora.")).toBe(false)
    expect(contieneAprobado("Queda pendiente.")).toBe(false)
  })

  it("recorta el texto breve a 40 caracteres e infiere la unidad", () => {
    expect(textoBreveSap("Renovación licencias antivirus corporativo 120 puestos, vigencia 12 meses").length).toBeLessThanOrEqual(40)
    expect(inferirUnidad("Bolsa de 100 horas de arquitectura")).toBe("H")
    expect(inferirUnidad("Licencias, vigencia 12 meses")).toBe("UN")
  })
})

describe("reglas sin caso propio en los fixtures", () => {
  it("RC1 bloquea un proveedor inactivo", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { s.proveedor_nit = "901777888" })
    expect(codigos((await validar(d, "sol-001")).bloqueos)).toEqual(["RC1"])
  })

  it("RC1 sin NIT encuentra por nombre y bloquea si el nombre no existe", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-006", "solicitud.json"), (s) => { s.proveedor_nombre = "tecnosuministros s.a.s" })
    expect((await validar(d, "sol-006")).apta).toBe(true)
    ajustarJson(rutaCaso(d, "sol-006", "solicitud.json"), (s) => { s.proveedor_nombre = "Otro Proveedor" })
    expect(codigos((await validar(d, "sol-006")).bloqueos)).toContain("RC1")
  })

  it("RC2 bloquea sin aprobación y cuando no dice Aprobado", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "aprobacion.json"), (a) => { a.cuerpo = "Lo reviso mañana." })
    expect(codigos((await validar(d, "sol-001")).bloqueos)).toEqual(["RC2"])
    rmSync(rutaCaso(d, "sol-001", "aprobacion.json"))
    expect(codigos((await validar(d, "sol-001")).bloqueos)).toEqual(["RC2"])
  })

  it("RC3 bloquea al superar el tope del aprobador", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { s.cantidad = 1000; s.valor_total = 95000000 })
    const v = await validar(d, "sol-001")
    expect(codigos(v.bloqueos)).toEqual(["RC3"])
    expect(v.bloqueos[0]?.accion_sugerida).toContain("dgarcia")
  })

  it("RC3 permite justo en el tope", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { s.cantidad = 1; s.valor_unitario = 50000000; s.valor_total = 50000000 })
    expect(codigos((await validar(d, "sol-001")).bloqueos)).toEqual([])
  })

  it("RC4 bloquea una subárea ajena al centro", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { s.subarea = "Marketing" })
    expect(codigos((await validar(d, "sol-001")).bloqueos)).toEqual(["RC4"])
  })

  it("RC5 acepta 2 % exacto, pide confirmar por encima y si no hay cotización", async () => {
    const d = proyectoTemporal()
    const ruta = rutaCaso(d, "sol-001", "cotizacion.txt")
    const original = readFileSync(ruta, "utf8")
    writeFileSync(ruta, original.replace("TOTAL (IVA incluido): COP 11.400.000", "TOTAL (IVA incluido): COP 11.628.000"))
    expect(codigos((await validar(d, "sol-001")).confirmaciones)).toEqual([])
    writeFileSync(ruta, original.replace("TOTAL (IVA incluido): COP 11.400.000", "TOTAL (IVA incluido): COP 11.628.001"))
    expect(codigos((await validar(d, "sol-001")).confirmaciones)).toEqual(["RC5"])
    rmSync(ruta)
    expect(codigos((await validar(d, "sol-001")).confirmaciones)).toEqual(["RC5"])
  })

  it("RC7 deriva las condiciones de pago sin pedir confirmación", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { delete s.condiciones_pago })
    const v = await validar(d, "sol-001")
    expect(v.derivados.condiciones_pago).toBe("Z030")
    expect(v.confirmaciones).toEqual([])
  })

  it("RC8 no marca retroactiva una factura posterior a la solicitud", async () => {
    const d = proyectoTemporal()
    const ruta = rutaCaso(d, "sol-005", "factura.txt")
    writeFileSync(ruta, readFileSync(ruta, "utf8").replace("2026-08-10", "2026-08-30"))
    expect((await validar(d, "sol-005")).retroactiva).toBe(false)
  })

  it("RC9 pide confirmación y compara fechas sin efecto de zona horaria", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "aprobacion.json"), (a) => { a.fecha = "2026-08-19T23:30:00-05:00" })
    expect(codigos((await validar(d, "sol-001")).confirmaciones)).toEqual(["RC9"])
    ajustarJson(rutaCaso(d, "sol-001", "aprobacion.json"), (a) => { a.fecha = "2026-08-20T23:30:00-05:00" })
    expect((await validar(d, "sol-001")).confirmaciones).toEqual([])
  })

  it("RC10 bloquea si cantidad por unitario no da el total y tolera 1 unidad", async () => {
    const d = proyectoTemporal()
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { s.valor_total = 11400001 })
    expect((await validar(d, "sol-001")).bloqueos).toEqual([])
    ajustarJson(rutaCaso(d, "sol-001", "solicitud.json"), (s) => { s.valor_total = 11400002 })
    expect(codigos((await validar(d, "sol-001")).bloqueos)).toEqual(["RC10"])
  })
})

describe("manejo de errores (HU-1 y HU-6)", () => {
  it("reporta adjuntos ausentes como null con su nombre", async () => {
    const d = proyectoTemporal()
    rmSync(rutaCaso(d, "sol-001", "cotizacion.txt"))
    const r = await llamador(d)("oc_leer_paquete", { caso: "sol-001" })
    expect(r).toMatchObject({ ok: true, data: { cotizacion: null, faltantes: ["cotizacion.txt"] } })
  })

  it("devuelve errores legibles para JSON malformado, monto no numérico y paquete incompleto", async () => {
    const d = proyectoTemporal()
    const leer = llamador(d)
    writeFileSync(rutaCaso(d, "sol-001", "solicitud.json"), "{mal")
    expect(await leer("oc_leer_paquete", { caso: "sol-001" })).toMatchObject({ ok: false, error: expect.stringContaining("JSON") })
    ajustarJson(rutaCaso(d, "sol-002", "solicitud.json"), (s) => { s.valor_total = "muchos" })
    expect(await leer("oc_leer_paquete", { caso: "sol-002" })).toMatchObject({ ok: false, error: expect.stringContaining("valor_total") })
    rmSync(rutaCaso(d, "sol-003", "solicitud.json"))
    expect(await leer("oc_leer_paquete", { caso: "sol-003" })).toMatchObject({ ok: false, error: expect.stringContaining("Paquete incompleto") })
  })

  it("rechaza rutas fuera de fixtures y argumentos inválidos sin lanzar", async () => {
    const leer = llamador(proyectoTemporal())
    expect(await leer("oc_leer_paquete", { caso: "../../secreto" })).toMatchObject({ ok: false })
    expect(await leer("oc_leer_paquete", {})).toMatchObject({ ok: false, error: expect.stringContaining("Argumentos inválidos") })
    expect(await leer("oc_inexistente", {})).toMatchObject({ ok: false })
  })
})

describe("payload y creación", () => {
  async function payloadDe(d: string, caso: string): Promise<OrdenCompra> {
    const r = await llamador(d)<{ orden: OrdenCompra }>("oc_construir_payload", { caso })
    if (!r.ok) throw new Error(r.error)
    return r.data.orden
  }

  it("construye la OC con trazabilidad completa y no permite construirla con bloqueos", async () => {
    const d = proyectoTemporal()
    const orden = await payloadDe(d, "sol-004")
    expect(orden.posiciones[0]).toMatchObject({ cantidad: 100, unidad: "H", precio_unitario: 250000 })
    expect(orden.referencia.cotizacion_ref).toBe("CA-2026-0310")
    const trazas = JSON.parse(readFileSync(join(d, "out", "sol-004", "trazabilidad.json"), "utf8")) as Record<string, { fuente: string }>
    expect(trazas["posiciones[0].precio_unitario"]?.fuente).toBe("solicitud")
    expect(trazas["proveedor.codigo_sap"]?.fuente).toBe("maestro.proveedores")
    expect(await llamador(d)("oc_construir_payload", { caso: "sol-002" })).toMatchObject({ ok: false })
  })

  it("el modelo no puede alterar montos en payload, paquete ni derivados", async () => {
    const d = proyectoTemporal()
    const llamar = llamador(d)
    const orden = await payloadDe(d, "sol-004")
    const alterada = structuredClone(orden)
    alterada.posiciones[0]!.precio_unitario = 265000
    expect(await llamar("oc_crear", { caso: "sol-004", payload: alterada, confirmado: true })).toMatchObject({ ok: false, error: expect.stringContaining("no coincide") })
    expect(await llamar("oc_validar", { caso: "sol-004", paquete: { solicitud: { valor_total: 1 } } })).toMatchObject({ ok: false })
    expect(await llamar("oc_construir_payload", { caso: "sol-006", derivados: { indicador_iva: "C0" } })).toMatchObject({ ok: false })
    expect(existsSync(join(d, "out", "sap", "ordenes.jsonl"))).toBe(false)
  })

  it("exige confirmación, firma las excepciones y marca el resultado en el log de control", async () => {
    const d = proyectoTemporal()
    const llamar = llamador(d, "sesion-1")
    const orden = await payloadDe(d, "sol-005")
    expect(await llamar("oc_crear", { caso: "sol-005", payload: orden })).toMatchObject({ ok: false, error: expect.stringContaining("Requiere confirmación") })
    expect(await llamar("oc_crear", { caso: "sol-005", payload: orden, confirmado: true })).toMatchObject({ ok: true, data: { numero_oc: "4500000001", idempotente: false, retroactiva: true } })
    const registrada = JSON.parse(readFileSync(join(d, "out", "sap", "ordenes.jsonl"), "utf8").trim()) as { orden: OrdenCompra }
    expect(registrada.orden.excepciones[0]?.confirmado_por).toContain("sesion-1")
    const filas = readFileSync(join(d, "out", "control.csv"), "utf8").trim().split("\n")
    expect(filas[0]).toBe("solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts")
    expect(filas[1]).toMatch(/^SOL-2026-005,pendiente,,true,,RC8,/)
    expect(filas[2]).toMatch(/^SOL-2026-005,exitoso,4500000001,true,,RC8,/)
  })

  it("es idempotente incluso con creaciones simultáneas", async () => {
    const d = proyectoTemporal()
    const llamar = llamador(d)
    const orden = await payloadDe(d, "sol-001")
    const [a, b] = await Promise.all([llamar<{ numero_oc: string }>("oc_crear", { caso: "sol-001", payload: orden }), llamar<{ numero_oc: string }>("oc_crear", { caso: "sol-001", payload: orden })])
    expect(a).toMatchObject({ ok: true, data: { numero_oc: "4500000001" } })
    expect(b).toMatchObject({ ok: true, data: { numero_oc: "4500000001" } })
    expect(readFileSync(join(d, "out", "sap", "ordenes.jsonl"), "utf8").trim().split("\n")).toHaveLength(1)
  })

  it("genera evidencia en txt y pdf con hash coherente con el payload", async () => {
    const d = proyectoTemporal()
    const r = await llamador(d)<{ ruta: string; ruta_pdf: string; sha256: string }>("oc_generar_evidencia", { caso: "sol-001" })
    if (!r.ok) throw new Error(r.error)
    expect(readFileSync(join(d, r.data.ruta), "utf8")).toContain(`sha256: ${r.data.sha256}`)
    expect(readFileSync(join(d, r.data.ruta_pdf)).subarray(0, 4).toString()).toBe("%PDF")
    expect((await payloadDe(d, "sol-001")).aprobador.evidencia_sha256).toBe(r.data.sha256)
  })
})
