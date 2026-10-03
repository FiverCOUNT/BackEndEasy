-- Snapshot de costo en líneas que usan catálogo (análisis de margen).
-- No altera totales SUNAT ni lógica de emisión.

ALTER TABLE `sale_details`
  ADD COLUMN `precio_compra` DECIMAL(14, 4) NULL;

ALTER TABLE `linea_catalogo_items`
  ADD COLUMN `precio_compra` DECIMAL(14, 4) NULL;

ALTER TABLE `orden_detalles`
  ADD COLUMN `precio_compra` DECIMAL(14, 4) NULL;

-- Relleno histórico desde catálogo (solo donde hay costo).
UPDATE `sale_details` sd
INNER JOIN `catalog_items` ci ON ci.id = sd.catalog_item_id
SET sd.precio_compra = ci.precio_compra
WHERE sd.precio_compra IS NULL
  AND ci.precio_compra IS NOT NULL;

UPDATE `linea_catalogo_items` l
INNER JOIN `catalog_items` ci ON ci.id = l.catalog_item_id
SET l.precio_compra = ci.precio_compra
WHERE l.precio_compra IS NULL
  AND ci.precio_compra IS NOT NULL;

UPDATE `orden_detalles` od
INNER JOIN `catalog_items` ci ON ci.id = od.catalog_item_id
SET od.precio_compra = ci.precio_compra
WHERE od.precio_compra IS NULL
  AND ci.precio_compra IS NOT NULL;
