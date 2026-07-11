-- Ubicaciones GRE (partida / destino) por empresa — GET/POST /api/empresas/{ruc}/addresses
CREATE TABLE `empresa_ubicaciones` (
    `id` VARCHAR(36) NOT NULL,
    `company_ruc` VARCHAR(11) NOT NULL,
    `etiqueta` VARCHAR(120) NOT NULL,
    `address_id` VARCHAR(36) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `empresa_ubicaciones_address_id_key`(`address_id`),
    INDEX `empresa_ubicaciones_company_ruc_idx`(`company_ruc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `empresa_ubicaciones` ADD CONSTRAINT `empresa_ubicaciones_address_id_fkey` FOREIGN KEY (`address_id`) REFERENCES `addresses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
