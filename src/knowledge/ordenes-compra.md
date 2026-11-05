# Conocimiento del proceso de órdenes de compra

## Proceso

Cada compra llega a administración por correo con tres piezas: solicitud, cotización del proveedor y correo de aprobación del líder. La analista crea la OC en SAP y adjunta la aprobación como evidencia. El líder ya aprobó por correo: el agente verifica esa aprobación, no la solicita.

## Qué significa cada control

Las herramientas ejecutan estos controles. Esta tabla sirve para explicarlos.

| Código | Qué verifica | Efecto |
|---|---|---|
| RC1 | El proveedor existe en el maestro y está activo. Se busca por NIT y, si no hay NIT, por nombre. | Bloqueo |
| RC2 | Hay aprobación, dice "Aprobado" y la envió un aprobador del centro de costo. | Bloqueo |
| RC3 | El valor total no supera el tope de ese aprobador en ese centro. | Bloqueo |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo |
| RC5 | Cotización y solicitud no difieren más de 2 %. Si no hay cotización, también se pregunta. | Confirmación |
| RC6 | Si falta el IVA, se toma el del proveedor y se pregunta. | Confirmación |
| RC7 | Si faltan las condiciones de pago, se toman las del proveedor y solo se informa. | Derivado |
| RC8 | Una factura anterior a la solicitud marca la compra como retroactiva. | Confirmación |
| RC9 | La aprobación no es anterior a la solicitud. | Confirmación |
| RC10 | Cantidad por valor unitario coincide con el total, con tolerancia de 1 unidad monetaria. | Bloqueo |
| EX1 | El código de IVA o de pago informado existe en los maestros. Control adicional al PRD. | Confirmación |

Un aprobador solo tiene autoridad en los centros donde está listado. Su tope en otro centro no sirve.

## Órdenes retroactivas

Una OC es retroactiva cuando se crea después de recibir la factura, lo que deja sin efecto el control previo al gasto. La política (tolerarlas con marca o rechazarlas) aún no está decidida. Por ahora, se crean solo con confirmación y quedan marcadas en `out/control.csv` para medir el desvío.

## Cómo se usa cada documento

- **Valor de la OC:** es el de la solicitud, que es lo que aprobó el líder. Si la cotización difiere, la diferencia queda como excepción confirmada; el agente nunca ajusta montos para que cuadren.
- **Precio unitario:** en estos documentos incluye IVA.
- **Descripción:** SAP admite 40 caracteres en el texto breve. El texto original queda en `trazabilidad.json`.

## Qué pedir según el problema

- **Proveedor inexistente o inactivo:** gestionar el alta o reactivación en maestros, o cambiar de proveedor.
- **Aprobador incorrecto o tope insuficiente:** pedir la aprobación a un aprobador del centro con tope suficiente, o escalar a dirección si ninguno lo cubre.
- **Documento ilegible o incompleto:** pedir al solicitante que lo reenvíe.
