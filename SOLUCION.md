# Solución: agente de órdenes de compra

## 1. Problema en una frase

Crear una orden de compra exige digitar datos a mano y validar de memoria quién puede aprobar qué, lo que le duele a la analista por el tiempo, a contabilidad por los errores y a la dirección porque no puede medir cuántas órdenes se crean después de la factura.

## 2. Arquitectura

```text
Front de chat (web/) ──HTTP──> API (src/app.ts)
                                 │
                                 ▼
                       Ciclo del agente (src/agent/)
                         │                 │
                         ▼                 ▼
          Adaptador LLM (src/llm/)   Registro de herramientas (src/tools/registro.ts) <── demo.ts
                         │                 │
                         ▼                 ▼
                      Anthropic      Herramientas zod (src/tools/oc.ts)
                                           │
                                           ▼
                       Dominio (src/oc/): parsers, RC1-RC10, payload, evidencia
                            │                     │
                            ▼                     ▼
                  fixtures/ (solo lectura)   SapAdapter ──> out/ (escritura)
```

| Pieza | Dónde vive | Cómo se separa |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Se cambia sin tocar código |
| Conocimiento | `src/knowledge/ordenes-compra.md` | Se agrega al prompt al arrancar; también es la skill de `modulo/` |
| Ejecución | `src/tools/` y `src/oc/` | Sin dependencia del servidor; las importan `demo.ts` y `modulo/` |

El modelo decide qué herramienta llamar y explica los resultados. Las reglas, los montos y los números de OC salen del código.

## 3. Ciclo del agente

1. **Entrada.** El backend decide si el mensaje confirma lo pendiente, antes de que lo vea el modelo, y lo agrega al historial.
2. **Modelo.** Se envían el prompt, el historial y las herramientas por medio de `LlmAdapter.enviar`.
3. **Salida incompleta.** Si la respuesta se truncó o fue rechazada, no se ejecuta nada ni se guarda en el historial, porque una llamada a medias dañaría los turnos siguientes.
4. **Herramientas.** Cada llamada pasa por el registro: valida con zod, ejecuta y escribe en `out/log.jsonl`. Un error vuelve al modelo como resultado, y este lo explica.
5. **Repetición.** El ciclo sigue hasta que el modelo responde o llega al tope de 25 pasos (configurable). Al llegar al tope, informa lo que tiene y lo que falta.
6. **Límites.** Antes de cada llamada se revisan el tope de tokens por sesión y el presupuesto diario global. Este último evita esquivar el tope abriendo sesiones nuevas.

**Confirmación humana.** El argumento `confirmado` de `oc_crear` no basta en el chat, porque el modelo podría enviarlo por su cuenta:

- Cuando `oc_validar` u `oc_crear` detectan confirmaciones pendientes, el backend registra el caso en la sesión y marca `needsConfirmation`.
- Si el modelo no cerró con una pregunta, el backend la agrega. El front resalta ese estado.
- `confirmado` solo llega a la herramienta como `true` si había una confirmación pendiente de ese caso y el siguiente mensaje de la persona la confirma. En cualquier otro caso, se convierte en `false`.
- `demo.ts` llama directamente a la herramienta y pasa `confirmado`, lo que representa la decisión humana explícita de esa prueba.

## 4. Elección del modelo

**Anthropic, `claude-sonnet-5-5`** ($2 por millón de tokens de entrada y $10 por millón de salida), con esfuerzo bajo y caché de prompt.

Las decisiones de negocio ya están en código, así que el modelo solo orquesta y redacta. No hace falta pagar `claude-opus-5-5` ($4/$20) para eso. Cambiar de modelo es una variable de entorno, y cambiar de proveedor solo requiere otra implementación de `LlmAdapter`.

**Costo por caso, medido:** unos **$0,03**. Ejecuté los 6 casos más una repetición de `sol-001` con el modelo real, en sesiones separadas:

| Tipo de caso | Llamadas al modelo | Costo |
|---|---|---|
| Bloqueado (`sol-002`, `sol-003`) | 2 | $0,02 |
| Sin excepciones (`sol-001`) | 4 | $0,03 |
| Con confirmación (`sol-004`, `sol-005`, `sol-006`) | 5 | $0,04 |
| Total de las 7 ejecuciones | 27 | $0,20 |

El costo se calculó con los tokens que reportó la API, asumiendo escritura de caché a 1,25 veces y lectura a 0,1 veces el precio de entrada. Es una muestra pequeña: varía según la extensión de cada respuesta y según si la caché sigue activa.

Con los topes por defecto, unos 1.000.000 de tokens diarios cuestan alrededor de $1,20 con este mismo uso de caché, y hasta unos $3 si casi no hay caché.

## 5. Matriz de controles

`src/oc/controles.ts` es la única implementación: la usan el chat, `demo.ts` y `oc_crear`, que vuelve a validar antes de crear.

| Regla | Implementación | Tipo | Se verifica en |
|---|---|---|---|
| RC1 | Busca por NIT normalizado, sin puntos ni dígito de verificación. Si no hay NIT, por nombre sin tildes ni puntuación. Exige `activo` | Bloqueo | `sol-002`; `sol-006` por nombre; inactivo en pruebas |
| RC2 | Exige aprobación, la palabra "Aprobado" sin negación y un remitente listado en ese centro | Bloqueo | `sol-003`; ausente y sin "Aprobado" en pruebas |
| RC3 | Compara con el tope del aprobador en ese centro | Bloqueo | Pruebas, incluido el valor justo en el tope |
| RC4 | La subárea debe pertenecer al centro | Bloqueo | Pruebas |
| RC5 | Diferencia mayor a 2 %, cotización ausente o monedas distintas; muestra ambos valores | Confirmación | `sol-004`; límite exacto en pruebas |
| RC6 | Deriva el IVA del proveedor y pide confirmar | Confirmación y derivado | `sol-006` |
| RC7 | Deriva las condiciones de pago y solo informa | Derivado | `sol-006` |
| RC8 | Factura anterior a la solicitud: `retroactiva = true` en el log | Confirmación | `sol-005` |
| RC9 | Compara la fecha local escrita en el documento, sin convertir a UTC | Confirmación | Pruebas |
| RC10 | `cantidad × valor_unitario` contra el total, con tolerancia de 1 | Bloqueo | Pruebas, incluido el límite |
| EX1 | Código de IVA o de pago desconocido. **No está en el PRD**: se agregó porque produciría una OC inválida en SAP | Confirmación | Pruebas |

**Resultado de `npm run demo`:**

| Caso | Hallazgo | Resultado |
|---|---|---|
| `sol-001` | Sin excepciones | OC 4500000001; la segunda ejecución devuelve el mismo número |
| `sol-002` | Proveedor inexistente | Bloqueada por RC1 |
| `sol-003` | Aprobador de otro centro | Bloqueada por RC2 |
| `sol-004` | Cotización 6 % mayor | Rechazada sin confirmar; OC 4500000002 al confirmar |
| `sol-005` | Factura anterior a la solicitud | OC 4500000003 al confirmar, con `retroactiva = true` |
| `sol-006` | Sin NIT, IVA ni condiciones de pago | OC 4500000004 al confirmar, con C1 y Z030 derivados |

**La más difícil: RC2 junto con RC3 en `sol-003`.** Felipe Vargas tiene un tope de 80 M, suficiente para los 74 M de la compra, pero ese tope es del centro CC-3030 y la compra es de CC-2020. Una validación que busque al aprobador en todos los centros la dejaría pasar. Por eso el aprobador se busca solo en el centro de la solicitud, y la acción sugerida avisa que ningún aprobador de CC-2020 cubre el monto: la única, Rocío Torres, tiene un tope de 30 M.

## 6. Diseño del adaptador SAP real

### Opción de integración

**Recomiendo OData `API_PURCHASEORDER_PROCESS_SRV` si el cliente tiene S/4HANA**, porque es una API estándar y no exige conectividad RFC. Si tiene ECC, usaría `BAPI_PO_CREATE1` expuesta por SAP Integration Suite, para no acoplar el agente a RFC.

Como la viabilidad no está confirmada, el orden sería:

1. Confirmar versión de SAP, usuario técnico y conectividad.
2. Empezar con el plan B, que da valor sin depender de esa respuesta.
3. Conectar la API en un entorno de pruebas y pasar a producción al validar el contrato.

### Mapeo

| Campo de la OC (7.4) | OData | BAPI |
|---|---|---|
| `sociedad` | `CompanyCode` | `POHEADER-COMP_CODE` |
| `organizacion_compras` | `PurchasingOrganization` | `POHEADER-PURCH_ORG` |
| `proveedor.codigo_sap` | `Supplier` | `POHEADER-VENDOR` |
| `moneda` | `DocumentCurrency` | `POHEADER-CURRENCY` |
| `condiciones_pago` | `PaymentTerms` | `POHEADER-PMNTTRMS` |
| `posiciones[].numero` | `PurchaseOrderItem` | `POITEM-PO_ITEM` |
| `posiciones[].descripcion` | `PurchaseOrderItemText` | `POITEM-SHORT_TEXT` |
| `posiciones[].cantidad` y `unidad` | `OrderQuantity`, `PurchaseOrderQuantityUnit` | `POITEM-QUANTITY`, `PO_UNIT` |
| `posiciones[].precio_unitario` | `NetPriceAmount` | `POITEM-NET_PRICE` |
| `posiciones[].indicador_iva` | `TaxCode` | `POITEM-TAX_CODE` |
| `posiciones[].centro_costo` | `CostCenter` en la imputación | `POACCOUNT-COSTCENTER` |
| `referencia.solicitud_id` | Campo de referencia externa | `POHEADER-REF_1` |

Estos nombres se validarían contra el metadata de la instancia real. Hay tres brechas que el payload simplificado no cubre:

- **Datos faltantes:** clase de documento, grupo de compras, centro logístico, cuenta contable y tipo de imputación. Saldrían de una tabla de configuración.
- **Subárea:** no tiene un campo estándar. Hay que acordar si corresponde a un centro de costo hijo, a una orden interna o a un campo personalizado.
- **Precio con IVA:** los fixtures traen el precio con IVA incluido, y SAP espera precio neto. El adaptador debe dividir por `1 + tasa`, o el impuesto se contaría dos veces.

### Autenticación y credenciales

OAuth 2.0 con un usuario técnico de privilegios mínimos, limitado a crear órdenes en esa sociedad. Las credenciales viven en un gestor de secretos y solo las lee el adaptador. El agente, el prompt y el modelo nunca las ven.

### Idempotencia y errores parciales

SAP no garantiza por sí solo que crear una OC sea idempotente, así que:

1. Se registra la intención en una tabla outbox, con `solicitud_id` como llave única, antes de llamar a SAP.
2. Se consulta `buscarOrdenPorReferencia` antes de cada intento.
3. Solo se reintenta ante errores transitorios, con espera exponencial. Un error de negocio de SAP nunca se reintenta: se devuelve a la analista.
4. Ante un timeout, el resultado es incierto: se consulta por referencia antes de reintentar y, si sigue sin respuesta, queda para conciliación.

Casos de error parcial:

- **BAPI:** se revisa la tabla `RETURN` y solo se llama a `BAPI_TRANSACTION_COMMIT` si no hay errores.
- **OC creada, adjunto fallido:** es un error parcial. La OC no se vuelve a crear; la evidencia queda en una cola de reintento y la OC se marca como pendiente de adjunto.

La aprobación que verifica el agente no reemplaza la estrategia de liberación de SAP.

### Plan B si la conexión no es viable

El agente hace igual lectura, controles, payload, evidencia y log de control. Solo cambia el último paso: una implementación de `SapAdapter` genera un archivo de carga masiva, o la OC lista para pegar, y la analista registra el número al crearla en SAP. Se pierde el último paso automático, pero se conservan los controles y la medición de retroactivas sin cambiar el agente.

## 7. Lectura del proceso

**Qué le diría a la dirección:** una OC retroactiva no es un error de digitación. Es un control que llega tarde: el gasto ya ocurrió cuando alguien lo aprueba, así que la aprobación pierde su capacidad de frenarlo y se convierte en un trámite para poder radicar la factura.

`sol-005` lo muestra con claridad:

| Fecha | Hecho |
|---|---|
| 05/08 | Cotización |
| 10/08 | Factura, a crédito de 15 días |
| 25/08 | Vence el plazo de pago de esa factura |
| 27/08 | Solicitud |
| 28/08 | Aprobación: "Ya llegó la factura, por favor crear la OC para poder radicarla" |

El plazo de pago venció dos días antes de la solicitud. A esa altura, rechazar ya no evitaría la obligación con el proveedor, y por eso nadie tiene un incentivo real para hacerlo.

**Cifra y su límite:** en los fixtures, 1 de las 4 OC creadas es retroactiva (25 %). Son datos de prueba y no sirven como estimación. Lo valioso es que `out/control.csv` y `/api/control` ya permiten medirlo con datos reales.

**Lo que no sabemos todavía:** un solo caso no permite afirmar la causa. Las hipótesis que comprobaría son compras recurrentes sin un contrato marco, proveedores que facturan antes de recibir la OC y un proceso de OC percibido como lento.

**Qué propongo:**

1. **Medir 4 a 8 semanas** con la marca actual, por área, proveedor y monto, junto con los días entre factura y OC. Sin cortar pagos.
2. **Atacar la causa según los datos:** contratos marco u órdenes abiertas para gastos recurrentes, y exigir a los proveedores el número de OC en cada factura.
3. **Pasar a "sin OC no se radica"** cuando exista la vía rápida, con excepciones justificadas y aprobadas por un nivel superior. Antes de eso, solo castigaría a quienes hoy no tienen alternativa.

La decisión entre tolerar con marca o rechazar es de la dirección. El agente ya la soporta: hoy pide confirmación, y pasar a rechazar sería mover RC8 de confirmación a bloqueo.

## 8. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| El backend recalcula todo desde los archivos y rechaza `paquete`, `derivados` o `payload` alterados | Confiar en lo que envía el modelo | Es el riesgo del PRD: un modelo que "arregla" un monto. El costo es releer archivos en cada llamada, irrelevante aquí |
| La confirmación la decide el backend según el mensaje de la persona | Confiar en el `confirmado` del modelo | La regla CA3 se cumple aunque el modelo se equivoque. El costo es que una pregunta intermedia obliga a validar y confirmar de nuevo |
| Reconocer la confirmación con un patrón explícito | Que el modelo interprete la respuesta | Es verificable y falla de forma segura. Una frase ambigua no autoriza nada; basta con decir "confirmo" |
| Ciclo propio | Framework de agentes o Tool Runner del SDK | La confirmación necesita intervenir antes de cada herramienta, y así el ciclo se prueba sin modelo |
| Respuesta HTTP completa | Streaming | El PRD lo deja opcional. Se pierde ver los pasos en vivo, pero el API y el front quedan más simples y menos propensos a fallar en 2 horas |
| Persistencia en archivos y sesiones en memoria | Base de datos | El PRD lo pide así. Al reiniciar se pierde la conversación; una confirmación pendiente nunca se da por hecha |

### Dependencias

| Paquete | Para qué | Por qué este |
|---|---|---|
| `zod` | Esquemas de herramientas y de los archivos de entrada | Obligatorio en el PRD |
| `@anthropic-ai/sdk` | Conexión al modelo | SDK oficial; solo lo importa `src/llm/anthropic.ts` |
| `hono`, `@hono/node-server` | API HTTP y cabeceras de seguridad | Liviano y permite probar la API sin abrir un puerto |
| `pdf-lib` | Evidencia en PDF (P1) | Sugerido en el PRD, sin dependencias nativas |
| `swagger-ui-dist` | Documentación en `/docs` | Se sirve desde el propio servidor, sin depender de un CDN |
| `tsx` | Ejecutar TypeScript en Node | Evita un paso de compilación en un servicio pequeño |
| `typescript`, `vitest`, `@types/node` (desarrollo) | Tipos y pruebas | Estándar del ecosistema |

## 9. Supuestos

1. **Valor de la OC:** es el de la solicitud. En `sol-004` sale por los 25 M aprobados, y los 26,5 M quedan en la excepción. El líder aprobó "por 25 millones", así que una compra por 26,5 M necesitaría otra aprobación.
2. **Precio unitario:** se conserva con IVA incluido, como en los fixtures. Ver la brecha de la sección 6.
3. **Unidad:** no viene en la solicitud. Se infiere de la descripción (`H` si habla de horas) y por defecto es `UN`. "Vigencia 12 meses" no significa `MES`, porque se compran licencias.
4. **Descripción:** se recorta a 40 caracteres en un límite de palabra. El original queda en la trazabilidad.
5. **"Aprobado":** se exige como palabra completa y se descartan negaciones como "no aprobado". Es más estricto que "contiene".
6. **Intentos en `control.csv`:** cada `oc_validar` con bloqueos o confirmaciones y cada `oc_crear` cuentan como intento, para que `sol-002` quede registrada aunque el agente no llame a `oc_crear`. Por eso un caso puede tener varias filas; la métrica cuenta las solicitudes distintas.
7. **Paquete incompleto:** sin `correo.json` o `solicitud.json` no hay nada que normalizar y se devuelve `{ ok: false, error }`. Los demás adjuntos ausentes quedan en `null` y se listan en el campo adicional `faltantes`.
8. **Cotización vencida:** ninguna regla la controla, así que se informa `validez_hasta` sin bloquear.
9. **`confirmado_por`:** al no haber autenticación, registra "analista (sesión X)". No identifica a una persona.
10. **Solicitante y analista:** en `sol-005` la solicitante es Camila Ortiz y el correo saluda a "Camila". Si fuera la misma persona que crea la OC, habría un problema de segregación de funciones. Ninguna regla lo cubre; solo lo señalo.
11. **Runtime:** Node en lugar de Bun, ambos permitidos. Por eso `demo.ts` corre con `npm run demo`.

## 10. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Leer `.xlsx`, PDF y correo reales; `oc_leer_excel` (P1 opcional) no se hizo |
| HU-2 Validar | Hecho | Consultar maestros en SAP en tiempo real |
| HU-3 Payload | Hecho | Campos de la brecha de la sección 6 |
| HU-4 Evidencia | Hecho, txt y pdf | Convertir el correo original; evaluar firma digital |
| HU-5 Crear OC | Hecho, en simulado | Adaptador real y outbox |
| HU-6 Errores | Hecho | Monitoreo y alertas |

También se entrega el bonus: `modulo/` reutiliza las herramientas por reexportación, y `agent.md` y `SKILL.md` se generan desde sus fuentes. Una prueba falla si dejan de coincidir.

**Verificación:** 53 pruebas automatizadas sin modelo, `demo.ts`, una prueba de navegador del chat con modelo simulado, y una ejecución manual de los 6 casos con el modelo real, con el resultado esperado en todos. Esa ejecución real incluyó el prompt de la sección 11 y una instrucción maliciosa agregada a una copia de la cotización de `sol-004`: el modelo la avisó y no la obedeció. Es una sola corrida, no una evaluación estadística del modelo.

## 11. Uso de IA

Usé **Claude Code** (modelo Claude Opus 5.5) durante toda la construcción.

| Tarea | Uso |
|---|---|
| Lectura del PRD | Comparar PRD, instructivo y fixtures, y detectar reglas sin caso propio |
| Código | Generar dominio, herramientas, ciclo, API, front y pruebas, con mi revisión |
| Documentación | Primer borrador de este documento y del README |

**Preparación previa:** antes de recibir el ZIP preparé con Claude Code una base técnica genérica, sin reglas del reto. Decidí no usarla: este repositorio empezó desde cero al iniciar la prueba y no copia sus archivos. Algunas ideas de diseño sí vienen de ese ejercicio.

**Qué descarté de lo propuesto:**

| Propuesta | Por qué la descarté |
|---|---|
| Aprobar cada orden en un endpoint separado | Contradice el PRD: `sol-001` debe crearse sin intervención, y la confirmación va en el siguiente mensaje |
| Auditoría con cadena de hashes | Sobraba para el alcance; el PRD pide `control.csv` y `log.jsonl` |
| Streaming de respuestas | Es opcional; preferí dedicar el tiempo a controles y pruebas |
| `claude-opus-5-5` por defecto | Su costo no se justifica si el modelo solo orquesta |
| Entregar un ZIP adjunto por correo | Gmail lo rechazó por contener un `.js`. Renombrar archivos para evadir el filtro no era aceptable, así que entrego el repositorio |

**Lo que la revisión corrigió:** la confirmación "sí" no se reconocía, porque en JavaScript `\b` no detecta el límite después de una vocal con tilde. Lo detectó una prueba automatizada.

## 12. Riesgos en producción

| Riesgo | Mitigación |
|---|---|
| El modelo altera un monto o inventa un valor | Ya mitigado: los valores salen de herramientas y `oc_crear` rechaza cualquier diferencia. Faltaría medirlo con evaluaciones |
| Un documento intenta dar instrucciones al modelo | El prompt los trata como datos y los controles están en código, así que un documento no puede saltarlos. Reduce el riesgo, no lo elimina. Solo se hizo una prueba manual: faltan pruebas adversarias sistemáticas |
| Un correo de aprobación falsificado | Se confía en el campo "de". En producción: validar SPF y DKIM en origen, o aprobar con firma digital o en SAP |
| Clave de acceso compartida y sin identidad | Autenticación corporativa (SSO) y roles, para que `confirmado_por` identifique a la persona |
| Error en un parser ante formatos reales | Los fixtures son texto normalizado. Con PDF reales haría falta extracción con revisión humana y métricas de precisión |
| Maestros desactualizados | Consultar SAP como fuente de verdad, con caché corta |
| Duplicados o pérdida de datos con varias instancias | La cola actual solo sirve para un proceso. Usar base de datos con llave única y outbox |
| Conexión a SAP no viable | Plan B de la sección 6 |
| Costo descontrolado | Ya hay topes por turno, sesión y día. Agregar alertas de gasto y un límite por usuario |
| Datos sensibles enviados al proveedor del modelo | Revisar el acuerdo de datos y enviar solo lo necesario |
