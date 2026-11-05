import type { Mensaje } from "../llm/adapter.ts"

export type LlamadaVisible = { nombre: string; args: unknown; ok: boolean; resumen: string; resultado: string }

export type MensajeVisible =
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }

export type Sesion = {
  id: string
  historial: Mensaje[]
  visibles: MensajeVisible[]
  /** Casos cuya creación espera una confirmación humana en el siguiente mensaje. */
  pendientes: Set<string>
  tokens: number
  ocupada: boolean
}

const MAX_SESIONES = 200

export class Sesiones {
  private readonly sesiones = new Map<string, Sesion>()

  obtener(id: string): Sesion | undefined {
    return this.sesiones.get(id)
  }

  obtenerOCrear(id: string): Sesion {
    const existente = this.sesiones.get(id)
    if (existente) return existente
    if (this.sesiones.size >= MAX_SESIONES) {
      const masAntigua = this.sesiones.keys().next().value
      if (masAntigua !== undefined) this.sesiones.delete(masAntigua)
    }
    const nueva: Sesion = { id, historial: [], visibles: [], pendientes: new Set(), tokens: 0, ocupada: false }
    this.sesiones.set(id, nueva)
    return nueva
  }
}

/** Tope global diario: sin él, abrir sesiones nuevas permitiría esquivar el tope por sesión. */
export class PresupuestoDiario {
  private dia = ""
  private usados = 0

  constructor(private readonly limite: number) {}

  private actualizar(): void {
    const hoy = new Date().toISOString().slice(0, 10)
    if (hoy !== this.dia) {
      this.dia = hoy
      this.usados = 0
    }
  }

  agotado(): boolean {
    this.actualizar()
    return this.usados >= this.limite
  }

  consumir(tokens: number): void {
    this.actualizar()
    this.usados += tokens
  }
}
