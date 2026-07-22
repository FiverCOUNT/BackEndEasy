-- Unificar ubicaciones GRE en `addresses` (eliminar empresa_ubicaciones)

ALTER TABLE `addresses`
  ADD COLUMN `company_ruc` VARCHAR(11) NULL,
  ADD COLUMN `etiqueta` VARCHAR(120) NULL,
  ADD COLUMN `creado_en` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `addresses` a
INNER JOIN `empresa_ubicaciones` u ON u.`address_id` = a.`id`
SET
  a.`company_ruc` = u.`company_ruc`,
  a.`etiqueta` = u.`etiqueta`,
  a.`creado_en` = u.`creado_en`;

CREATE INDEX `addresses_company_ruc_idx` ON `addresses`(`company_ruc`);

ALTER TABLE `empresa_ubicaciones` DROP FOREIGN KEY `empresa_ubicaciones_address_id_fkey`;
DROP TABLE `empresa_ubicaciones`;
