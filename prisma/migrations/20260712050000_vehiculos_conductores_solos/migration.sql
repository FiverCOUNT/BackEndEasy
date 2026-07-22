-- Tablas solas: conductores y vehiculos (sin relaciones)

CREATE TABLE IF NOT EXISTS `vehiculos` (
    `id` VARCHAR(36) NOT NULL,
    `placa` VARCHAR(15) NOT NULL,
    `permisos` JSON NOT NULL,
    UNIQUE INDEX `vehiculos_placa_key`(`placa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conductores` (
    `id` VARCHAR(36) NOT NULL,
    `tipo_doc` VARCHAR(2) NOT NULL DEFAULT '1',
    `numero_doc` VARCHAR(20) NOT NULL,
    `nombres_completos` VARCHAR(255) NOT NULL,
    `licencia` VARCHAR(40) NULL,
    UNIQUE INDEX `conductores_tipo_doc_numero_doc_key`(`tipo_doc`, `numero_doc`),
    INDEX `conductores_numero_doc_idx`(`numero_doc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `empresa_vehiculo_permisos`;
DROP TABLE IF EXISTS `empresa_vehiculos`;
DROP TABLE IF EXISTS `empresa_conductores`;
