-- Código de lote opcional en el catálogo.

ALTER TABLE `catalog_items`
  ADD COLUMN `lote` VARCHAR(64) NULL;
