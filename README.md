# Agente de órdenes de compra

Agente conversacional que lee el paquete de una solicitud de compra, lo valida contra los maestros, construye la orden, genera la evidencia de aprobación y la crea en un SAP simulado. Las excepciones se devuelven a la analista con una recomendación.

El planteamiento de la solución está en [SOLUCION.md](SOLUCION.md).

## Link de prueba

- **URL:** https://reto-03-periferia-production.up.railway.app
- **Clave de acceso:** `7b8d6a042eb01248`
- **Documentación de la API:** https://reto-03-periferia-production.up.railway.app/docs

El servicio guarda `out/` y las sesiones sin persistencia: al reiniciarse, vuelve a empezar desde la OC 4500000001.

Prueba sugerida en una sesión nueva:

```text
Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

## Cómo levantar en local

Requiere Node.js 20.12 o superior. Las pruebas requieren Node.js 22.12 o superior, por Vitest.

```bash
npm install
cp .env.example .env    # define ANTHROPIC_API_KEY
npm run dev             # front y backend en http://localhost:3000
```

## Variables de entorno

| Variable | Obligatoria | Por defecto | Uso |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Para el chat | | Clave del modelo; solo la lee el backend |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5-5` | Modelo |
| `ACCESS_CODE` | No | | Si se define, el chat exige esta clave |
| `PORT` | No | `3000` | Puerto |
| `MAX_ITERACIONES` | No | `25` | Tope de pasos por turno |
| `TOKENS_POR_SESION` | No | `200000` | Tope de tokens por sesión, incluida la caché |
| `TOKENS_POR_DIA` | No | `1000000` | Tope global diario, incluida la caché |
| `PETICIONES_POR_MINUTO` | No | `30` | Tope global de mensajes al chat |
| `LLM_TIMEOUT_MS` | No | `90000` | Tiempo máximo de respuesta del modelo |

## Verificación sin modelo

`demo.ts` procesa los 6 casos llamando a las herramientas, sin ninguna clave. Limpia `out/` al iniciar y termina con error si un caso no da el resultado esperado.

```bash
npm install
npm run demo
```

## Otros comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas de reglas, herramientas, ciclo y API, sin consumir el modelo |
| `npm run typecheck` | Verificación de tipos |
| `npm run check` | Tipos y pruebas |
| `npm run modulo` | Regenera `modulo/` desde el prompt y el conocimiento |

## API

La documentación interactiva está en `/docs` y el contrato OpenAPI en `/openapi.json`. Si `ACCESS_CODE` está definida, las rutas marcadas requieren la cabecera `x-access-code`.

| Método | Ruta | Clave | Cuerpo y respuesta |
|---|---|---|---|
| `POST` | `/api/chat` | Sí | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Sí | `{ id, mensajes[], tokens, needsConfirmation }` |
| `GET` | `/api/control` | Sí | `{ intentos, oc_creadas, retroactivas, porcentaje_retroactivas }` |
| `GET` | `/api/health` | No | `{ ok: true, provider, model }` |

Cada elemento de `toolCalls` tiene `{ nombre, args, ok, resumen, resultado }`.

## Archivos generados en `out/`

| Archivo | Contenido |
|---|---|
| `control.csv` | Log de control de cada intento |
| `log.jsonl` | Todas las llamadas a herramientas |
| `sap/ordenes.jsonl` | Órdenes creadas en el SAP simulado |
| `<caso>/trazabilidad.json` | Fuente de cada valor de la orden |
| `<caso>/aprobacion.txt` y `.pdf` | Evidencia de aprobación con SHA-256 |

## Estructura

```text
agent/prompt.md                 Comportamiento: system prompt
src/knowledge/ordenes-compra.md Conocimiento del proceso
src/tools/oc.ts                 Ejecución: herramientas con zod
src/tools/registro.ts           Nombres oc_<export>, validación y log
src/oc/                         Parsers, controles RC1-RC10, payload, evidencia y registros
src/agent/                      Ciclo del agente, confirmación y sesiones
src/llm/                        Interfaz del proveedor e implementación de Anthropic
src/sap/                        Interfaz SapAdapter e implementación simulada
src/app.ts, src/server.ts       API HTTP y arranque
web/                            Front de chat
modulo/                         Agente empaquetado como módulo reutilizable
fixtures/                       Entregados por Periferia, sin modificar
demo.ts                         Verificación sin modelo
```

## Expresiones de gratitud 🎁

* Agradezco a Periferia IT Group por su interés en mi perfil para el cargo de AI Software Engineer 🤓
* Me encantaría recibir su retroalimentación en mi correo (ingadtorresa@gmail.com). Sus opiniones son muy importantes para mi superación diaria, y también podemos tomarnos un café ☕ 🤗
