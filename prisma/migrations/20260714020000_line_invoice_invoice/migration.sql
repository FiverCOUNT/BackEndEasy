-- Reemplaza documentos + line_invoice_document por enlace invoice ↔ invoice.

CREATE TABLE IF NOT EXISTS `line_invoice_invoice` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `invoice2_id` VARCHAR(36) NOT NULL,
    `orden` INT NOT NULL DEFAULT 0,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `line_inv_inv_unique`(`invoice_id`, `invoice2_id`),
    INDEX `line_inv_inv_invoice_idx`(`invoice_id`),
    INDEX `line_inv_inv_invoice2_idx`(`invoice2_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Migrar enlaces que ya apuntaban a un invoice real (documentos.invoice_id).
SET @has_line_doc := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'line_invoice_document'
);
SET @has_documentos := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos'
);

SET @sql := IF(
  @has_line_doc > 0 AND @has_documentos > 0,
  'INSERT IGNORE INTO `line_invoice_invoice` (`id`, `invoice_id`, `invoice2_id`, `orden`)
   SELECT l.`id`, l.`invoice_id`, d.`invoice_id`, 0
   FROM `line_invoice_document` l
   INNER JOIN `documentos` d ON d.`id` = l.`documento_id`
   INNER JOIN `invoices` i2 ON i2.`id` = d.`invoice_id`
   WHERE d.`invoice_id` IS NOT NULL AND d.`invoice_id` <> ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Migrar invoice_documentos_relacionados si aún existe.
SET @has_rel := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_documentos_relacionados'
);
SET @sql := IF(
  @has_rel > 0,
  'INSERT IGNORE INTO `line_invoice_invoice` (`id`, `invoice_id`, `invoice2_id`, `orden`)
   SELECT r.`id`, r.`invoice_id`, r.`invoice_relacionado_id`, COALESCE(r.`orden`, 0)
   FROM `invoice_documentos_relacionados` r
   INNER JOIN `invoices` i2 ON i2.`id` = r.`invoice_relacionado_id`
   WHERE r.`invoice_relacionado_id` IS NOT NULL AND r.`invoice_relacionado_id` <> ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS `line_invoice_document`;
DROP TABLE IF EXISTS `documentos`;
DROP TABLE IF EXISTS `invoice_documentos_relacionados`;

-- FKs (idempotente).
SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'line_invoice_invoice'
        AND CONSTRAINT_NAME = 'line_inv_inv_invoice_fkey'
    ),
    'SELECT 1',
    'ALTER TABLE `line_invoice_invoice`
       ADD CONSTRAINT `line_inv_inv_invoice_fkey`
       FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`)
       ON DELETE CASCADE ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'line_invoice_invoice'
        AND CONSTRAINT_NAME = 'line_inv_inv_invoice2_fkey'
    ),
    'SELECT 1',
    'ALTER TABLE `line_invoice_invoice`
       ADD CONSTRAINT `line_inv_inv_invoice2_fkey`
       FOREIGN KEY (`invoice2_id`) REFERENCES `invoices`(`id`)
       ON DELETE CASCADE ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
