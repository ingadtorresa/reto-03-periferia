// Procesa los 6 casos llamando directamente a las herramientas, sin modelo y sin ninguna clave.
import { rmSync } from "node:fs"
import { join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { ejecutarHerramienta } from "./src/tools/registro.ts"
import type { Validacion } from "./src/oc/tipos.ts"

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string }
type Creacion = { numero_oc: string; fecha: string; idempotente: boolean; retroactiva: boolean; evidencia: string }
type Esperado = { apta: boolean; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean; numero: string | null }

const directory = process.env.DEMO_DIR ?? dirname(fileURLToPath(import.meta.url))
const ctx = { directory, sessionId: "demo" }

const ESPERADO: Record<string, Esperado> = {
  "sol-001": { apta: true, bloqueos: [], confirmaciones: [], retroactiva: false, numero: "4500000001" },
  "sol-002": { apta: false, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false, numero: null },
  "sol-003": { apta: false, bloqueos: ["RC2"], confirmaciones: [], retroactiva: false, numero: null },
  "sol-004": { apta: true, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false, numero: "4500000002" },
  "sol-005": { apta: true, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true, numero: "4500000003" },
  "sol-006": { apta: true, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false, numero: "4500000004" },
}

async function llamar<T>(herramienta: string, args: unknown): Promise<Respuesta<T>> {
  return JSON.parse(await ejecutarHerramienta(herramienta, args, ctx)) as Respuesta<T>
}

async function procesar(caso: string, esperado: Esperado): Promise<boolean> {
  console.log(`\n=== ${caso} ===`)
  const paquete = await llamar<Record<string, unknown>>("oc_leer_paquete", { caso })
  if (!paquete.ok) {
    console.log(`Error: ${paquete.error}`)
    return false
  }
  const validacion = await llamar<Validacion>("oc_validar", { caso, paquete: paquete.data })
  if (!validacion.ok) {
    console.log(`Error: ${validacion.error}`)
    return false
  }
  const v = validacion.data
  const bloqueos = v.bloqueos.map((b) => b.codigo)
  const confirmaciones = v.confirmaciones.map((c) => c.codigo)
  console.log(`apta: ${v.apta} | retroactiva: ${v.retroactiva}`)
  console.log(`bloqueos: ${v.bloqueos.map((b) => `${b.codigo} (${b.detalle})`).join(" ") || "ninguno"}`)
  console.log(`confirmaciones: ${v.confirmaciones.map((c) => `${c.codigo} (${c.detalle})`).join(" ") || "ninguna"}`)
  console.log(`derivados: ${JSON.stringify(v.derivados)}`)

  let numero: string | null = null
  if (!v.apta) {
    console.log(`Motivo: ${v.bloqueos[0]?.accion_sugerida ?? ""}`)
    const intento = await llamar<Creacion>("oc_crear", { caso, payload: {}, confirmado: true })
    console.log(`oc_crear sin payload válido, aun con confirmado=true: ${intento.ok ? "CREÓ (error)" : "rechazado"}`)
    if (intento.ok) return false
  } else {
    numero = await crear(caso, confirmaciones.length > 0)
  }

  const correcto =
    v.apta === esperado.apta &&
    bloqueos.join() === esperado.bloqueos.join() &&
    confirmaciones.join() === esperado.confirmaciones.join() &&
    v.retroactiva === esperado.retroactiva &&
    numero === esperado.numero
  console.log(`Resultado esperado: ${correcto ? "SÍ" : "NO"}`)
  return correcto
}

async function crear(caso: string, requiereConfirmacion: boolean): Promise<string | null> {
  const payload = await llamar<{ orden: unknown; ruta_trazabilidad: string }>("oc_construir_payload", { caso })
  if (!payload.ok) {
    console.log(`Error: ${payload.error}`)
    return null
  }
  const evidencia = await llamar<{ ruta: string; sha256: string }>("oc_generar_evidencia", { caso })
  if (evidencia.ok) console.log(`evidencia: ${evidencia.data.ruta} | sha256: ${evidencia.data.sha256}`)
  console.log(`trazabilidad: ${payload.data.ruta_trazabilidad}`)

  if (requiereConfirmacion) {
    const sinConfirmar = await llamar<Creacion>("oc_crear", { caso, payload: payload.data.orden })
    console.log(`sin confirmar: ${sinConfirmar.ok ? "CREÓ (error)" : "rechazado, requiere confirmación"}`)
    if (sinConfirmar.ok) return null
    console.log("confirmación humana explícita: confirmado=true")
  }
  const creada = await llamar<Creacion>("oc_crear", { caso, payload: payload.data.orden, confirmado: requiereConfirmacion })
  if (!creada.ok) {
    console.log(`Error: ${creada.error}`)
    return null
  }
  console.log(`OC: ${creada.data.numero_oc} | idempotente: ${creada.data.idempotente}`)
  if (caso === "sol-001") return (await repetir(caso, payload.data.orden, creada.data.numero_oc)) ? creada.data.numero_oc : null
  return creada.data.numero_oc
}

async function repetir(caso: string, payload: unknown, numero: string): Promise<boolean> {
  const repetida = await llamar<Creacion>("oc_crear", { caso, payload })
  if (!repetida.ok) return false
  console.log(`Segunda ejecución de ${caso}: OC ${repetida.data.numero_oc} | idempotente: ${repetida.data.idempotente}`)
  return repetida.data.numero_oc === numero && repetida.data.idempotente
}

async function main(): Promise<void> {
  rmSync(join(directory, "out"), { recursive: true, force: true })
  const resultados: boolean[] = []
  for (const [caso, esperado] of Object.entries(ESPERADO)) resultados.push(await procesar(caso, esperado))
  const correctos = resultados.filter(Boolean).length
  console.log(`\nCasos con el resultado esperado: ${correctos} de ${resultados.length}`)
  console.log("Salidas: out/control.csv, out/log.jsonl, out/sap/ordenes.jsonl y out/<caso>/")
  if (correctos !== resultados.length) process.exitCode = 1
}

await main()
