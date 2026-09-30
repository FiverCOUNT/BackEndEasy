-- CreateTable
CREATE TABLE `ordenes` (
    `id` VARCHAR(36) NOT NULL,
    `company_ruc` VARCHAR(11) NOT NULL,
    `cliente_id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NULL,
    `estado` ENUM('BORRADOR', 'CONFIRMADA', 'FACTURADA', 'ANULADA') NOT NULL DEFAULT 'BORRADOR',
    `tipo_moneda` VARCHAR(3) NOT NULL DEFAULT 'PEN',
    `observacion` TEXT NULL,
    `mto_oper_gravadas` DECIMAL(14, 4) NULL,
    `mto_igv` DECIMAL(14, 4) NULL,
    `sub_total` DECIMAL(14, 4) NULL,
    `mto_imp_venta` DECIMAL(14, 4) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ordenes_invoice_id_key`(`invoice_id`),
    INDEX `ordenes_company_ruc_idx`(`company_ruc`),
    INDEX `ordenes_cliente_id_idx`(`cliente_id`),
    INDEX `ordenes_estado_idx`(`estado`),
    INDEX `ordenes_company_ruc_creado_en_idx`(`company_ruc`, `creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orden_detalles` (
    `id` VARCHAR(36) NOT NULL,
    `orden_id` VARCHAR(36) NOT NULL,
    `catalog_item_id` VARCHAR(64) NULL,
    `orden_linea` INTEGER NOT NULL DEFAULT 0,
    `codigo` VARCHAR(64) NULL,
    `codigo_sunat` VARCHAR(32) NULL,
    `descripcion` VARCHAR(500) NULL,
    `nombre` VARCHAR(255) NULL,
    `cantidad` DECIMAL(14, 4) NOT NULL,
    `unidad` VARCHAR(10) NULL DEFAULT 'NIU',
    `mto_precio_unitario` DECIMAL(14, 4) NULL,
    `tip_afe_igv` VARCHAR(4) NOT NULL DEFAULT '10',
    `mto_valor_unitario` DECIMAL(14, 4) NULL,
    `mto_valor_venta` DECIMAL(14, 4) NULL,
    `mto_base_igv` DECIMAL(14, 4) NULL,
    `mto_igv` DECIMAL(14, 4) NULL,
    `porcentaje_igv` DECIMAL(6, 2) NULL,
    `total` DECIMAL(14, 4) NULL,

    INDEX `orden_detalles_orden_id_idx`(`orden_id`),
    INDEX `orden_detalles_catalog_item_id_idx`(`catalog_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ordenes` ADD CONSTRAINT `ordenes_cliente_id_fkey` FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenes` ADD CONSTRAINT `ordenes_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orden_detalles` ADD CONSTRAINT `orden_detalles_orden_id_fkey` FOREIGN KEY (`orden_id`) REFERENCES `ordenes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orden_detalles` ADD CONSTRAINT `orden_detalles_catalog_item_id_fkey` FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
