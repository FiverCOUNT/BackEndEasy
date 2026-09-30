-- Lote y vencimiento viven en cada línea del movimiento, no en el producto.

ALTER TABLE `linea_catalogo_items`
  ADD COLUMN `lote` VARCHAR(64) NULL,
  ADD COLUMN `fecha_vencimiento` VARCHAR(10) NULL;

ALTER TABLE `catalog_items`
  DROP COLUMN `lote`,
  DROP COLUMN `fecha_vencimiento`;
