-- Precio de compra y fecha de vencimiento opcional en el catálogo.

ALTER TABLE `catalog_items`
  ADD COLUMN `precio_compra` DECIMAL(14, 4) NULL,
  ADD COLUMN `fecha_vencimiento` VARCHAR(10) NULL;
