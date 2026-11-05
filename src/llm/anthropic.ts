import Anthropic from "@anthropic-ai/sdk"
import { ErrorLlm, type HerramientaLlm, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

type MensajeApi = Anthropic.MessageParam
type BloqueResultado = Anthropic.ToolResultBlockParam

const MAX_TOKENS = 8000

/** Convierte al formato de la API y agrupa resultados consecutivos en un solo turno de usuario. */
function aMensajesApi(mensajes: Mensaje[]): MensajeApi[] {
  const salida: MensajeApi[] = []
  let resultados: BloqueResultado[] = []
  const volcar = () => {
    if (resultados.length > 0) salida.push({ role: "user", content: resultados })
    resultados = []
  }
  for (const m of mensajes) {
    if (m.rol === "tool") {
      resultados.push({ type: "tool_result", tool_use_id: m.llamadaId, content: m.resultado, is_error: m.esError })
      continue
    }
    volcar()
    if (m.rol === "user") salida.push({ role: "user", content: m.texto })
    if (m.rol === "assistant") salida.push({ role: "assistant", content: (m.crudo ?? m.texto) as MensajeApi["content"] })
  }
  volcar()
  return salida
}

function traducirError(error: unknown): ErrorLlm {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ErrorLlm("El modelo tardó demasiado en responder. Intenta de nuevo.")
  if (error instanceof Anthropic.APIConnectionError) return new ErrorLlm("No fue posible conectar con el modelo. Intenta de nuevo en un momento.")
  if (error instanceof Anthropic.AuthenticationError) return new ErrorLlm("La clave del modelo no es válida. Revisa la configuración del backend.")
  if (error instanceof Anthropic.RateLimitError) return new ErrorLlm("El modelo alcanzó su límite de uso. Espera un momento e intenta de nuevo.")
  if (error instanceof Anthropic.APIError) return new ErrorLlm(`El proveedor del modelo respondió con un error (${error.status ?? "sin estado"}). Intenta de nuevo.`)
  return new ErrorLlm("Ocurrió un error inesperado al consultar el modelo.")
}

function aFin(razon: string | null): RespuestaLlm["fin"] {
  if (razon === "tool_use") return "herramientas"
  if (razon === "max_tokens") return "truncado"
  if (razon === "refusal") return "rechazo"
  return "fin"
}

/** `input_tokens` excluye la caché: sin sumarla, los topes de tokens subestimarían el consumo real. */
function aUso(uso: Anthropic.Usage): RespuestaLlm["uso"] {
  const cacheEscrita = uso.cache_creation_input_tokens ?? 0
  const cacheLeida = uso.cache_read_input_tokens ?? 0
  return { entrada: uso.input_tokens + cacheEscrita + cacheLeida, salida: uso.output_tokens, cacheEscrita, cacheLeida }
}

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  private readonly cliente: Anthropic | null

  constructor(
    apiKey: string | undefined,
    readonly modelo: string,
    timeoutMs: number,
  ) {
    this.cliente = apiKey ? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 }) : null
  }

  async enviar(mensajes: Mensaje[], herramientas: HerramientaLlm[]): Promise<RespuestaLlm> {
    if (!this.cliente) throw new ErrorLlm("El backend no tiene configurada la clave del modelo (ANTHROPIC_API_KEY).")
    const system = mensajes.flatMap((m) => (m.rol === "system" ? [m.texto] : [])).join("\n\n")
    try {
      const respuesta = await this.cliente.messages
        .stream({
          model: this.modelo,
          max_tokens: MAX_TOKENS,
          system,
          cache_control: { type: "ephemeral" },
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          tools: herramientas.map((h) => ({
            name: h.nombre,
            description: h.descripcion,
            input_schema: h.esquema as Anthropic.Tool.InputSchema,
          })),
          messages: aMensajesApi(mensajes),
        })
        .finalMessage()
      return {
        texto: respuesta.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
        llamadas: respuesta.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, nombre: b.name, args: b.input }] : [])),
        fin: aFin(respuesta.stop_reason),
        uso: aUso(respuesta.usage),
        crudo: respuesta.content,
      }
    } catch (error) {
      throw traducirError(error)
    }
  }
}
