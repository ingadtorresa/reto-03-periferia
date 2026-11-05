// Todo el contenido se inserta como texto: ni el modelo ni los documentos pueden inyectar HTML.
const chat = document.querySelector("#chat")
const formulario = document.querySelector("#formulario")
const campoMensaje = document.querySelector("#mensaje")
const campoClave = document.querySelector("#clave")
const botonEnviar = document.querySelector("#enviar")
const estado = document.querySelector("#estado")
const metrica = document.querySelector("#metrica")

let ocupado = false

function leerAlmacen(llave) {
  try {
    return sessionStorage.getItem(llave)
  } catch {
    return null
  }
}

function escribirAlmacen(llave, valor) {
  try {
    sessionStorage.setItem(llave, valor)
  } catch {
    // Sin almacenamiento: la página sigue funcionando durante esta visita.
  }
}

function nuevaSesion() {
  const id = crypto.randomUUID()
  escribirAlmacen("sessionId", id)
  return id
}

let sessionId = leerAlmacen("sessionId") ?? nuevaSesion()
campoClave.value = leerAlmacen("clave") ?? ""

function crear(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta)
  if (clase) nodo.className = clase
  if (texto !== undefined) nodo.textContent = texto
  return nodo
}

function bajar() {
  chat.scrollTop = chat.scrollHeight
}

// Formato en línea: **negrita** y `código`.
function enLinea(padre, texto) {
  for (const parte of texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (!parte) continue
    if (parte.startsWith("**")) padre.append(crear("strong", "", parte.slice(2, -2)))
    else if (parte.startsWith("`")) padre.append(crear("code", "", parte.slice(1, -1)))
    else padre.append(parte)
  }
}

const celdas = (linea) => linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
const esSeparador = (linea) => /^\s*\|?[\s:|-]+\|?\s*$/.test(linea) && linea.includes("-")

function tabla(lineas) {
  const contenedor = crear("div", "tabla")
  const t = crear("table")
  const conEncabezado = lineas.length > 1 && esSeparador(lineas[1])
  lineas.filter((l) => !esSeparador(l)).forEach((linea, indice) => {
    const fila = crear("tr")
    for (const celda of celdas(linea)) {
      const nodo = crear(conEncabezado && indice === 0 ? "th" : "td")
      enLinea(nodo, celda)
      fila.append(nodo)
    }
    t.append(fila)
  })
  contenedor.append(t)
  return contenedor
}

function lista(lineas, ordenada) {
  const nodo = crear(ordenada ? "ol" : "ul")
  for (const linea of lineas) {
    const item = crear("li")
    enLinea(item, linea.replace(/^\s*([-*]|\d+\.)\s+/, ""))
    nodo.append(item)
  }
  return nodo
}

function bloqueDeLineas(lineas, inicio, condicion) {
  let fin = inicio
  while (fin < lineas.length && condicion(lineas[fin])) fin += 1
  return fin
}

// Markdown mínimo para lo que escribe el agente: títulos, tablas y listas.
function markdown(padre, texto) {
  const lineas = texto.split("\n")
  let i = 0
  while (i < lineas.length) {
    const linea = lineas[i]
    if (!linea.trim()) {
      i += 1
      continue
    }
    const tipos = [
      [/^\s*\|/, (bloque) => tabla(bloque)],
      [/^\s*[-*]\s+/, (bloque) => lista(bloque, false)],
      [/^\s*\d+\.\s+/, (bloque) => lista(bloque, true)],
    ]
    const tipo = tipos.find(([patron]) => patron.test(linea))
    if (tipo) {
      const fin = bloqueDeLineas(lineas, i, (l) => tipo[0].test(l))
      padre.append(tipo[1](lineas.slice(i, fin)))
      i = fin
      continue
    }
    const parrafo = crear("p")
    const titulo = /^#{1,4}\s+(.*)$/.exec(linea)
    if (titulo) parrafo.append(crear("strong", "", titulo[1]))
    else enLinea(parrafo, linea)
    padre.append(parrafo)
    i += 1
  }
}

function mostrarHerramienta(llamada) {
  const nodo = crear("details", `herramienta${llamada.ok ? "" : " falla"}`)
  const resumen = crear("summary")
  resumen.append(crear("strong", "", llamada.nombre), ` ${llamada.ok ? "✓" : "✕"} ${llamada.resumen}`)
  const legible = (texto) => {
    try {
      return JSON.stringify(JSON.parse(texto), null, 2)
    } catch {
      return texto
    }
  }
  nodo.append(
    resumen,
    crear("pre", "", `Argumentos:\n${JSON.stringify(llamada.args, null, 2)}`),
    crear("pre", "", `Resultado:\n${legible(llamada.resultado)}`),
  )
  chat.append(nodo)
}

function mostrarAgente(mensaje, activo) {
  for (const llamada of mensaje.toolCalls ?? []) mostrarHerramienta(llamada)
  const burbuja = crear("div", `burbuja${mensaje.needsConfirmation ? " confirmacion" : ""}`)
  if (mensaje.needsConfirmation) burbuja.append(crear("div", "etiqueta-confirmacion", "⚠ Se requiere tu confirmación"))
  markdown(burbuja, mensaje.texto)
  if (mensaje.needsConfirmation && activo) {
    const acciones = crear("div", "acciones")
    const confirmar = crear("button", "", "Confirmo")
    const rechazar = crear("button", "secundario", "No confirmo")
    const decidir = (texto) => {
      confirmar.disabled = true
      rechazar.disabled = true
      enviar(texto)
    }
    confirmar.type = "button"
    rechazar.type = "button"
    confirmar.addEventListener("click", () => decidir("Confirmo"))
    rechazar.addEventListener("click", () => decidir("No confirmo"))
    acciones.append(confirmar, rechazar)
    burbuja.append(acciones)
  }
  chat.append(burbuja)
  bajar()
}

function encabezados() {
  const clave = campoClave.value.trim()
  return { "content-type": "application/json", ...(clave ? { "x-access-code": clave } : {}) }
}

function pedirClave(mensaje) {
  campoClave.hidden = false
  campoClave.focus()
  chat.append(crear("div", "burbuja error", mensaje))
  bajar()
}

async function actualizarMetrica() {
  const respuesta = await fetch("/api/control", { headers: encabezados() }).catch(() => null)
  if (!respuesta?.ok) return
  const r = await respuesta.json()
  metrica.textContent = `OC creadas: ${r.oc_creadas} · retroactivas: ${r.retroactivas} (${r.porcentaje_retroactivas} %)`
}

function fijarOcupado(valor) {
  ocupado = valor
  botonEnviar.disabled = valor
  document.querySelectorAll(".atajos button").forEach((b) => { b.disabled = valor })
}

async function enviar(texto) {
  if (ocupado || !texto.trim()) return
  fijarOcupado(true)
  chat.append(crear("div", "burbuja usuario", texto))
  const pensando = crear("div", "pensando", "Pensando…")
  chat.append(pensando)
  bajar()
  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: encabezados(),
      body: JSON.stringify({ sessionId, message: texto }),
    })
    const datos = await respuesta.json().catch(() => ({}))
    pensando.remove()
    if (respuesta.status === 401) {
      pedirClave("Escribe la clave de acceso y envía de nuevo.")
      return
    }
    if (!respuesta.ok) {
      chat.append(crear("div", "burbuja error", datos.error ?? "No fue posible procesar el mensaje."))
      return
    }
    escribirAlmacen("clave", campoClave.value.trim())
    campoClave.hidden = true
    mostrarAgente({ texto: datos.reply, toolCalls: datos.toolCalls, needsConfirmation: datos.needsConfirmation }, true)
    actualizarMetrica()
  } catch {
    pensando.remove()
    chat.append(crear("div", "burbuja error", "Se perdió la conexión con el servidor. Intenta de nuevo."))
  } finally {
    fijarOcupado(false)
    bajar()
  }
}

async function restaurar() {
  const respuesta = await fetch(`/api/sessions/${sessionId}`, { headers: encabezados() }).catch(() => null)
  if (respuesta?.status === 401) campoClave.hidden = false
  if (!respuesta?.ok) return
  const { mensajes } = await respuesta.json()
  mensajes.forEach((m, indice) => {
    if (m.rol === "user") chat.append(crear("div", "burbuja usuario", m.texto))
    else mostrarAgente(m, indice === mensajes.length - 1)
  })
  bajar()
}

async function iniciar() {
  const salud = await fetch("/api/health").then((r) => r.json()).catch(() => null)
  estado.textContent = salud ? `Modelo: ${salud.model}` : "Sin conexión con el servidor"
  await restaurar()
  actualizarMetrica()
}

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault()
  const texto = campoMensaje.value
  campoMensaje.value = ""
  enviar(texto)
})

campoMensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault()
    formulario.requestSubmit()
  }
})

document.querySelector("#atajos").addEventListener("click", (evento) => {
  const caso = evento.target.dataset?.caso
  if (caso) enviar(`Procesa la solicitud "${caso}".`)
})

document.querySelector("#nueva").addEventListener("click", () => {
  sessionId = nuevaSesion()
  chat.replaceChildren()
})

iniciar()
