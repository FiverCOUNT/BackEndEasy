-- El lote y su caducidad viven en producto_lotes.
-- La línea del movimiento solo guarda el id.

CREATE TABLE `producto_lotes` (
  `id` VARCHAR(36) NOT NULL,
  `company_ruc` VARCHAR(11) NOT NULL,
  `catalog_item_id` VARCHAR(36) NOT NULL,
  `numero_lote` VARCHAR(64) NOT NULL,
  `fecha_vencimiento` VARCHAR(10) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `producto_lotes_company_item_numero_key` (`company_ruc`, `catalog_item_id`, `numero_lote`),
  INDEX `producto_lotes_catalog_item_id_idx` (`catalog_item_id`),
  CONSTRAINT `producto_lotes_catalog_item_id_fkey`
    FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `producto_lotes` (`id`, `company_ruc`, `catalog_item_id`, `numero_lote`, `fecha_vencimiento`)
SELECT UUID(), src.company_ruc, src.catalog_item_id, src.lote, src.fecha_vencimiento
FROM (
  SELECT m.company_ruc, l.catalog_item_id, l.lote, MAX(l.fecha_vencimiento) AS fecha_vencimiento
  FROM `linea_catalogo_items` l
  INNER JOIN `movimientos` m ON m.id = l.movimiento_id
  INNER JOIN `catalog_items` c ON c.id = l.catalog_item_id
  WHERE l.lote IS NOT NULL AND l.lote <> ''
  GROUP BY m.company_ruc, l.catalog_item_id, l.lote
) src;

ALTER TABLE `linea_catalogo_items`
  ADD COLUMN `producto_lote_id` VARCHAR(36) NULL,
  ADD INDEX `linea_catalogo_items_producto_lote_id_idx` (`producto_lote_id`),
  ADD CONSTRAINT `linea_catalogo_items_producto_lote_id_fkey`
    FOREIGN KEY (`producto_lote_id`) REFERENCES `producto_lotes` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `linea_catalogo_items` l
INNER JOIN `movimientos` m ON m.id = l.movimiento_id
INNER JOIN `producto_lotes` p
  ON p.company_ruc = m.company_ruc
 AND p.catalog_item_id = l.catalog_item_id
 AND p.numero_lote = l.lote
SET l.producto_lote_id = p.id
WHERE l.lote IS NOT NULL AND l.lote <> '';

ALTER TABLE `linea_catalogo_items`
  DROP COLUMN `lote`,
  DROP COLUMN `fecha_vencimiento`;
