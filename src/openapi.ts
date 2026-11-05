const error = { type: "object", properties: { error: { type: "string" } }, required: ["error"] }
const respuestaError = (descripcion: string) => ({ description: descripcion, content: { "application/json": { schema: error } } })
const json = (schema: Record<string, unknown>) => ({ "application/json": { schema } })

const llamadaHerramienta = {
  type: "object",
  properties: {
    nombre: { type: "string", example: "oc_validar" },
    args: { type: "object" },
    ok: { type: "boolean" },
    resumen: { type: "string" },
    resultado: { type: "string", description: "JSON serializado con { ok, data } o { ok, error }" },
  },
}

/** Contrato de la API que se muestra en /docs. */
export const especificacion = {
  openapi: "3.0.3",
  info: {
    title: "Agente de órdenes de compra",
    version: "1.0.0",
    description: "API del chat. Si el servicio tiene clave de acceso, usa el botón Authorize.",
  },
  components: {
    securitySchemes: { claveAcceso: { type: "apiKey", in: "header", name: "x-access-code" } },
  },
  paths: {
    "/api/chat": {
      post: {
        summary: "Envía un mensaje al agente y ejecuta un turno completo",
        security: [{ claveAcceso: [] }],
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["sessionId", "message"],
            properties: {
              sessionId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$", example: "sesion-1" },
              message: { type: "string", maxLength: 4000, example: 'Procesa la solicitud "sol-001"' },
            },
          }),
        },
        responses: {
          200: {
            description: "Respuesta del agente",
            content: json({
              type: "object",
              properties: {
                reply: { type: "string" },
                toolCalls: { type: "array", items: llamadaHerramienta },
                needsConfirmation: { type: "boolean" },
              },
            }),
          },
          400: respuestaError("Cuerpo inválido"),
          401: respuestaError("Clave de acceso incorrecta o ausente"),
          409: respuestaError("La sesión aún procesa el mensaje anterior"),
          429: respuestaError("Demasiadas peticiones"),
        },
      },
    },
    "/api/sessions/{id}": {
      get: {
        summary: "Devuelve el historial completo de una sesión",
        security: [{ claveAcceso: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Historial",
            content: json({
              type: "object",
              properties: {
                id: { type: "string" },
                mensajes: { type: "array", items: { type: "object" } },
                tokens: { type: "integer" },
                needsConfirmation: { type: "boolean" },
              },
            }),
          },
          401: respuestaError("Clave de acceso incorrecta o ausente"),
          404: respuestaError("La sesión no existe"),
        },
      },
    },
    "/api/control": {
      get: {
        summary: "Métrica de órdenes creadas y retroactivas",
        security: [{ claveAcceso: [] }],
        responses: {
          200: {
            description: "Resumen del log de control",
            content: json({
              type: "object",
              properties: {
                intentos: { type: "integer" },
                oc_creadas: { type: "integer" },
                retroactivas: { type: "integer" },
                porcentaje_retroactivas: { type: "number" },
              },
            }),
          },
          401: respuestaError("Clave de acceso incorrecta o ausente"),
        },
      },
    },
    "/api/health": {
      get: {
        summary: "Estado del servicio, sin exponer claves",
        responses: {
          200: {
            description: "Servicio activo",
            content: json({
              type: "object",
              properties: { ok: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" } },
            }),
          },
        },
      },
    },
  },
}
