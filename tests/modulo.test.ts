import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import * as herramientasModulo from "../modulo/tools/oc.ts"
import { contenidoAgente, contenidoSkill } from "../scripts/build-modulo.ts"
import * as herramientasApp from "../src/tools/oc.ts"

const raiz = join(import.meta.dirname, "..")

describe("módulo reutilizable", () => {
  it("usa exactamente las mismas herramientas de la aplicación", () => {
    expect(herramientasModulo.crear).toBe(herramientasApp.crear)
    expect(Object.keys(herramientasModulo).sort()).toEqual(Object.keys(herramientasApp).sort())
  })

  it("agent.md y SKILL.md están sincronizados con sus fuentes (si falla: npm run modulo)", () => {
    expect(readFileSync(join(raiz, "modulo", "agent.md"), "utf8")).toBe(contenidoAgente())
    expect(readFileSync(join(raiz, "modulo", "skill", "ordenes-compra", "SKILL.md"), "utf8")).toBe(contenidoSkill())
    expect(contenidoAgente()).toContain("mode: primary")
  })
})
