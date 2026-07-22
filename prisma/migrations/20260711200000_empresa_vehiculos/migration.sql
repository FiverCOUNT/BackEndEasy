-- Vehículos GRE por empresa — CRUD /api/empresas/{ruc}/vehiculos
CREATE TABLE `empresa_vehiculos` (
    `id` VARCHAR(36) NOT NULL,
    `company_ruc` VARCHAR(11) NOT NULL,
    `placa` VARCHAR(15) NOT NULL,
    `nro_circulacion` VARCHAR(40) NULL,
    `etiqueta` VARCHAR(120) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,
    UNIQUE INDEX `empresa_vehiculos_company_ruc_placa_key`(`company_ruc`, `placa`),
    INDEX `empresa_vehiculos_company_ruc_idx`(`company_ruc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
