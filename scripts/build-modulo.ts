// Genera modulo/agent.md y el SKILL.md desde las fuentes que usa la aplicación, para que no diverjan.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8")

export function contenidoAgente(): string {
  return `---
description: Prepara y crea órdenes de compra en SAP validando controles, con confirmación humana para las excepciones.
mode: primary
permission:
  edit: deny
  bash: deny
---

${leer("agent/prompt.md")}`
}

export function contenidoSkill(): string {
  return `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra, sus controles RC1 a RC10 y cómo tratar excepciones y compras retroactivas.
---

${leer("src/knowledge/ordenes-compra.md")}`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(raiz, "modulo", "skill", "ordenes-compra"), { recursive: true })
  writeFileSync(join(raiz, "modulo", "agent.md"), contenidoAgente(), "utf8")
  writeFileSync(join(raiz, "modulo", "skill", "ordenes-compra", "SKILL.md"), contenidoSkill(), "utf8")
  console.log("Módulo generado en modulo/")
}
