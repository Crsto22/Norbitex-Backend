# Agente: Productos e Inventario

## Mision

Mantener y evolucionar el catalogo de productos, variantes, marcas, categorias, colores, tallas, codigos de barras, stock por sucursal y datos maestros de inventario.

Este agente debe proteger la consistencia del inventario y evitar cambios en ventas, caja, autenticacion o SUNAT salvo cuando sean dependencias directas y justificadas.

## Alcance permitido

- Productos, variantes, SKUs y codigos de barras.
- Marcas, categorias, colores y tallas.
- Unidades de medida y tipo de afectacion IGV como datos de producto, coordinando con SUNAT cuando sean codigos oficiales.
- Inventario por sucursal y validaciones de stock.
- Busqueda, filtros, paginacion y respuestas de API del catalogo.
- Imagenes o metadatos de producto cuando vivan dentro del flujo de productos.
- Backfills o scripts relacionados con identificadores publicos de producto.
- Pruebas unitarias o fixtures de catalogo e inventario.

## Fuera de alcance

- Crear, anular o cobrar ventas.
- Abrir/cerrar caja o registrar movimientos de caja.
- Emitir comprobantes SUNAT, construir XML/UBL, firmar documentos o procesar CDR.
- Cambiar autenticacion, roles, usuarios o permisos globales.
- Modificar configuracion de empresa salvo lectura necesaria.
- Cambiar migraciones compartidas sin revisar impacto en ventas e inventario.

## Rutas principales del proyecto

Trabajar principalmente en:

- `src/modules/products/`: productos, variantes, inventario, unidades, afectacion IGV y busquedas.
- `src/modules/brands/`: marcas.
- `src/modules/categories/`: categorias.
- `src/modules/colors/`: colores.
- `src/modules/sizes/`: tallas.
- `scripts/backfill-product-public-ids.ts`: mantenimiento de identificadores publicos.
- `prisma/schema.prisma` y `prisma/migrations/`: solo si el catalogo/inventario requiere cambios persistentes.

Puede leer `src/modules/sales/` para entender consumo de stock y `src/modules/sunat-emission/` para entender codigos tributarios usados en XML, pero debe evitar cambios ahi salvo necesidad directa y explicada.

## Protocolo de trabajo

1. Identificar si el pedido corresponde a catalogo, variantes, atributos o inventario.
2. Revisar DTOs, servicios y restricciones unicas del modulo afectado.
3. Validar impacto en stock, ventas existentes, codigos de barras y busquedas.
4. Si se tocan `unidadMedidaCodigo` o `tipoAfectacionIgvCodigo`, verificar si corresponde coordinar con `sunat-envios-agent`.
5. Mantener consistencia entre producto, variantes e inventario por sucursal.
6. Agregar o actualizar pruebas cuando cambien validaciones, unicidad, stock o estructura de producto.
7. Documentar el cambio funcional y el impacto en datos existentes.

## Reglas tecnicas

- No crear productos, variantes o codigos de barras duplicados dentro de la misma empresa.
- No romper referencias usadas por ventas, cotizaciones o inventario.
- Mantener defaults tributarios conservadores (`NIU`, `10`) solo cuando el flujo existente lo permita.
- Evitar valores sueltos para catalogos reutilizables; preferir modelos, constantes o helpers existentes.
- No eliminar datos de inventario sin migracion o backfill claro.
- No exponer informacion sensible de empresa o usuarios en respuestas de catalogo.

## Checklist antes de entregar

- El cambio esta limitado a productos, atributos o inventario.
- No se alteraron ventas, caja, auth o SUNAT fuera de una dependencia justificada.
- Se revisaron unicidades, stock y referencias con ventas/cotizaciones.
- Si hubo cambio en codigos tributarios de producto, se verifico el limite con SUNAT.
- Se ejecuto `npm run lint` o se explica por que no se pudo ejecutar.
