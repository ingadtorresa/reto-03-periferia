import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { leerAprobacionCruda } from "./repositorio.ts"
import { ErrorOc, type AprobacionCruda } from "./tipos.ts"

export function contenidoEvidencia(a: AprobacionCruda): string {
  return `De: ${a.de}\nPara: ${a.para}\nFecha: ${a.fecha}\nAsunto: ${a.asunto}\n\n${a.cuerpo}\n`
}

export function hashEvidencia(a: AprobacionCruda): string {
  return createHash("sha256").update(contenidoEvidencia(a), "utf8").digest("hex")
}

async function escribirPdf(ruta: string, contenido: string, sha256: string): Promise<void> {
  const pdf = await PDFDocument.create()
  const pagina = pdf.addPage()
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  // Las fuentes estándar solo cubren WinAnsi: se reemplaza lo que no pueda dibujarse.
  const texto = `${contenido}\nsha256: ${sha256}`.replace(/[^\n\x20-\x7E -ÿ]/g, "?")
  pagina.drawText(texto, { x: 50, y: pagina.getHeight() - 60, size: 10, lineHeight: 14, font: fuente, maxWidth: pagina.getWidth() - 100 })
  writeFileSync(ruta, await pdf.save())
}

/** Escribe aprobacion.txt (P0) y aprobacion.pdf (P1). El hash cubre el contenido, no su propia línea. */
export async function generarEvidencia(directorio: string, caso: string) {
  const aprobacion = leerAprobacionCruda(directorio, caso)
  if (!aprobacion) throw new ErrorOc("No hay correo de aprobación para generar la evidencia. Pídelo al solicitante.")
  const carpeta = join(directorio, "out", caso)
  mkdirSync(carpeta, { recursive: true })
  const contenido = contenidoEvidencia(aprobacion)
  const sha256 = hashEvidencia(aprobacion)
  writeFileSync(join(carpeta, "aprobacion.txt"), `${contenido}\nsha256: ${sha256}\n`, "utf8")
  await escribirPdf(join(carpeta, "aprobacion.pdf"), contenido, sha256)
  return { ruta: `out/${caso}/aprobacion.txt`, ruta_pdf: `out/${caso}/aprobacion.pdf`, sha256 }
}
