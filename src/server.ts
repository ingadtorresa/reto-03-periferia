import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { cargarSystemPrompt } from "./agent/prompt.ts"
import { PresupuestoDiario } from "./agent/sesiones.ts"
import { crearApp } from "./app.ts"
import { AnthropicAdapter } from "./llm/anthropic.ts"

const directory = join(dirname(fileURLToPath(import.meta.url)), "..")

try {
  process.loadEnvFile(join(directory, ".env"))
} catch {
  // Sin archivo .env: en despliegue las variables vienen del entorno.
}

function entero(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto
}

const modelo = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"
const llm = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY, modelo, entero("LLM_TIMEOUT_MS", 90_000))

const app = crearApp({
  llm,
  directory,
  systemPrompt: cargarSystemPrompt(directory),
  maxIteraciones: entero("MAX_ITERACIONES", 25),
  tokensPorSesion: entero("TOKENS_POR_SESION", 60_000),
  presupuesto: new PresupuestoDiario(entero("TOKENS_POR_DIA", 400_000)),
  accessCode: process.env.ACCESS_CODE || undefined,
  peticionesPorMinuto: entero("PETICIONES_POR_MINUTO", 30),
})

const port = entero("PORT", 3000)
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`Agente de OC en http://localhost:${port} (modelo: ${modelo})`)
  if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY no está definida: el chat informará el error.")
  if (!process.env.ACCESS_CODE) console.warn("ACCESS_CODE no está definida: el chat queda sin clave de acceso.")
})
