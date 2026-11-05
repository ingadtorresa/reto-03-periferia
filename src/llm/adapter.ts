/** Contrato neutral: el ciclo del agente no conoce ningún SDK de proveedor. */
export type LlamadaHerramienta = { id: string; nombre: string; args: unknown }

export type Mensaje =
  | { rol: "system"; texto: string }
  | { rol: "user"; texto: string }
  /** `crudo` es opaco: solo el adaptador que lo generó lo interpreta para reenviarlo tal cual. */
  | { rol: "assistant"; texto: string; llamadas: LlamadaHerramienta[]; crudo?: unknown }
  | { rol: "tool"; llamadaId: string; resultado: string; esError: boolean }

export type HerramientaLlm = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export type RespuestaLlm = {
  texto: string
  llamadas: LlamadaHerramienta[]
  fin: "fin" | "herramientas" | "truncado" | "rechazo"
  /** `entrada` es el total, incluida la caché; los dos campos opcionales la desglosan para estimar costos. */
  uso: { entrada: number; salida: number; cacheEscrita?: number; cacheLeida?: number }
  crudo?: unknown
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: HerramientaLlm[]): Promise<RespuestaLlm>
}

/** Error del proveedor con un mensaje apto para mostrar en el chat. Nunca incluye claves. */
export class ErrorLlm extends Error {}
