-- Documentos relacionados SUNAT (GRE): tipo + serie + correlativo + emisor.
CREATE TABLE IF NOT EXISTS `invoice_documentos_relacionados` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `tipo_doc` VARCHAR(4) NOT NULL,
    `serie` VARCHAR(10) NOT NULL,
    `correlativo` VARCHAR(20) NOT NULL,
    `emisor_tipo_doc` VARCHAR(2) NOT NULL DEFAULT '6',
    `emisor_numero_doc` VARCHAR(15) NOT NULL,
    `emisor_razon_social` VARCHAR(255) NULL,
    `invoice_relacionado_id` VARCHAR(36) NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    INDEX `invoice_documentos_relacionados_invoice_id_idx`(`invoice_id`),
    INDEX `invoice_documentos_relacionados_invoice_relacionado_id_idx`(`invoice_relacionado_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- FKs (omitidas si ya existen tras un intento parcial).
SET @fk1 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_documentos_relacionados'
    AND CONSTRAINT_NAME = 'invoice_documentos_relacionados_invoice_id_fkey'
);
SET @sql1 := IF(@fk1 = 0,
  'ALTER TABLE `invoice_documentos_relacionados`
     ADD CONSTRAINT `invoice_documentos_relacionados_invoice_id_fkey`
     FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

SET @fk2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoice_documentos_relacionados'
    AND CONSTRAINT_NAME = 'invoice_documentos_relacionados_invoice_relacionado_id_fkey'
);
SET @sql2 := IF(@fk2 = 0,
  'ALTER TABLE `invoice_documentos_relacionados`
     ADD CONSTRAINT `invoice_documentos_relacionados_invoice_relacionado_id_fkey`
     FOREIGN KEY (`invoice_relacionado_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
