-- El lote se crea una vez: id, nombre y vencimiento.
-- El producto solo guarda el id en la línea.

ALTER TABLE `producto_lotes`
  ADD COLUMN `nombre` VARCHAR(64) NULL;

UPDATE `producto_lotes`
SET `nombre` = `numero_lote`
WHERE `nombre` IS NULL OR `nombre` = '';

UPDATE `linea_catalogo_items` l
INNER JOIN `producto_lotes` p ON p.id = l.producto_lote_id
INNER JOIN (
  SELECT `company_ruc`, `nombre`, MIN(`id`) AS keep_id
  FROM `producto_lotes`
  WHERE `nombre` IS NOT NULL AND `nombre` <> ''
  GROUP BY `company_ruc`, `nombre`
) k ON k.company_ruc = p.company_ruc AND k.nombre = p.nombre
SET l.producto_lote_id = k.keep_id
WHERE p.id <> k.keep_id;

DELETE p FROM `producto_lotes` p
INNER JOIN `producto_lotes` k
  ON k.company_ruc = p.company_ruc
 AND k.nombre = p.nombre
 AND k.id < p.id;

ALTER TABLE `producto_lotes`
  DROP FOREIGN KEY `producto_lotes_catalog_item_id_fkey`;

ALTER TABLE `producto_lotes`
  DROP INDEX `producto_lotes_company_item_numero_key`,
  DROP INDEX `producto_lotes_catalog_item_id_idx`,
  DROP COLUMN `catalog_item_id`,
  DROP COLUMN `numero_lote`,
  MODIFY `nombre` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `producto_lotes_company_nombre_key` (`company_ruc`, `nombre`),
  ADD INDEX `producto_lotes_company_ruc_idx` (`company_ruc`);
