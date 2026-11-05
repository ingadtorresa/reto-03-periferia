import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Comportamiento en agent/prompt.md y conocimiento en src/knowledge/: ninguno está en el código. */
export function cargarSystemPrompt(directorio: string): string {
  const comportamiento = readFileSync(join(directorio, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(directorio, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${comportamiento.trim()}\n\n<conocimiento_del_proceso>\n${conocimiento.trim()}\n</conocimiento_del_proceso>`
}
