-- documentos (identidad SUNAT) + line_invoice_document (invoice ↔ documento)

CREATE TABLE IF NOT EXISTS `documentos` (
    `id` VARCHAR(36) NOT NULL,
    `tipo_doc` VARCHAR(4) NOT NULL,
    `serie` VARCHAR(10) NOT NULL,
    `correlativo` VARCHAR(20) NOT NULL,
    `emisor_ruc` VARCHAR(11) NOT NULL,
    `emisor_razon_social` VARCHAR(255) NULL,
    `invoice_id` VARCHAR(36) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `documentos_emisor_tipo_serie_corr_key`(`emisor_ruc`, `tipo_doc`, `serie`, `correlativo`),
    INDEX `documentos_invoice_idx`(`invoice_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Migrar desde invoice_documentos_relacionados (FK a invoice relacionado) si existe.
SET @has_old := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_documentos_relacionados'
);

SET @sql_mig_docs := IF(@has_old > 0,
  'INSERT INTO `documentos` (`id`, `tipo_doc`, `serie`, `correlativo`, `emisor_ruc`, `emisor_razon_social`, `invoice_id`, `actualizado_en`)
   SELECT UUID(), i.`tipo_doc`, i.`serie`, i.`correlativo`, i.`company_ruc`, NULL, i.`id`, CURRENT_TIMESTAMP(3)
   FROM `invoice_documentos_relacionados` r
   INNER JOIN `invoices` i ON i.`id` = r.`invoice_relacionado_id`
   WHERE NOT EXISTS (
     SELECT 1 FROM `documentos` d
     WHERE d.`emisor_ruc` = i.`company_ruc` AND d.`tipo_doc` = i.`tipo_doc`
       AND d.`serie` = i.`serie` AND d.`correlativo` = i.`correlativo`
   )',
  'SELECT 1');
PREPARE stmt_mig_docs FROM @sql_mig_docs; EXECUTE stmt_mig_docs; DEALLOCATE PREPARE stmt_mig_docs;

CREATE TABLE IF NOT EXISTS `line_invoice_document` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `documento_id` VARCHAR(36) NOT NULL,
    `archivo_key` VARCHAR(500) NULL,
    `archivo_url` VARCHAR(500) NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `line_inv_doc_unique`(`invoice_id`, `documento_id`),
    INDEX `line_inv_doc_invoice_idx`(`invoice_id`),
    INDEX `line_inv_doc_documento_idx`(`documento_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql_mig_lines := IF(@has_old > 0,
  'INSERT INTO `line_invoice_document` (`id`, `invoice_id`, `documento_id`)
   SELECT r.`id`, r.`invoice_id`, d.`id`
   FROM `invoice_documentos_relacionados` r
   INNER JOIN `invoices` i ON i.`id` = r.`invoice_relacionado_id`
   INNER JOIN `documentos` d
     ON d.`emisor_ruc` = i.`company_ruc` AND d.`tipo_doc` = i.`tipo_doc`
    AND d.`serie` = i.`serie` AND d.`correlativo` = i.`correlativo`
   WHERE NOT EXISTS (
     SELECT 1 FROM `line_invoice_document` l
     WHERE l.`invoice_id` = r.`invoice_id` AND l.`documento_id` = d.`id`
   )',
  'SELECT 1');
PREPARE stmt_mig_lines FROM @sql_mig_lines; EXECUTE stmt_mig_lines; DEALLOCATE PREPARE stmt_mig_lines;

DROP TABLE IF EXISTS `invoice_documentos_relacionados`;

-- FKs (idempotente)
SET @fk_doc := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos'
    AND CONSTRAINT_NAME = 'documentos_invoice_fkey'
);
SET @sql_fk_doc := IF(@fk_doc = 0,
  'ALTER TABLE `documentos` ADD CONSTRAINT `documentos_invoice_fkey`
     FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt_fk_doc FROM @sql_fk_doc; EXECUTE stmt_fk_doc; DEALLOCATE PREPARE stmt_fk_doc;

SET @fk_line_inv := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'line_invoice_document'
    AND CONSTRAINT_NAME = 'line_inv_doc_invoice_fkey'
);
SET @sql_fk_line_inv := IF(@fk_line_inv = 0,
  'ALTER TABLE `line_invoice_document` ADD CONSTRAINT `line_inv_doc_invoice_fkey`
     FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt_fk_line_inv FROM @sql_fk_line_inv; EXECUTE stmt_fk_line_inv; DEALLOCATE PREPARE stmt_fk_line_inv;

SET @fk_line_doc := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'line_invoice_document'
    AND CONSTRAINT_NAME = 'line_inv_doc_documento_fkey'
);
SET @sql_fk_line_doc := IF(@fk_line_doc = 0,
  'ALTER TABLE `line_invoice_document` ADD CONSTRAINT `line_inv_doc_documento_fkey`
     FOREIGN KEY (`documento_id`) REFERENCES `documentos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt_fk_line_doc FROM @sql_fk_line_doc; EXECUTE stmt_fk_line_doc; DEALLOCATE PREPARE stmt_fk_line_doc;
