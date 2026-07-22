-- MTC en empresa + FK vehículo→company + permisos del vehículo

ALTER TABLE `companies` ADD COLUMN `nro_mtc` VARCHAR(40) NULL;

-- Relacionar vehículos con companies.id (tabla aún vacía / reciente)
ALTER TABLE `empresa_vehiculos` ADD COLUMN `company_id` BIGINT NULL;

UPDATE `empresa_vehiculos` v
INNER JOIN `companies` c ON c.`ruc` = v.`company_ruc`
SET v.`company_id` = c.`id`
WHERE v.`company_id` IS NULL;

DELETE FROM `empresa_vehiculos` WHERE `company_id` IS NULL;

ALTER TABLE `empresa_vehiculos` MODIFY `company_id` BIGINT NOT NULL;

CREATE INDEX `empresa_vehiculos_company_id_idx` ON `empresa_vehiculos`(`company_id`);

ALTER TABLE `empresa_vehiculos`
  ADD CONSTRAINT `empresa_vehiculos_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `empresa_vehiculo_permisos` (
    `id` VARCHAR(36) NOT NULL,
    `vehiculo_id` VARCHAR(36) NOT NULL,
    `tipo` VARCHAR(60) NOT NULL,
    `numero` VARCHAR(80) NOT NULL,
    `descripcion` VARCHAR(255) NULL,
    `fecha_emision` DATE NULL,
    `fecha_vencimiento` DATE NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `empresa_vehiculo_permisos_vehiculo_id_idx`(`vehiculo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `empresa_vehiculo_permisos`
  ADD CONSTRAINT `empresa_vehiculo_permisos_vehiculo_id_fkey`
  FOREIGN KEY (`vehiculo_id`) REFERENCES `empresa_vehiculos`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
