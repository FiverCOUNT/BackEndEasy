-- Archivos en Cloudflare R2 enlazados a cada relación guía ↔ documento SUNAT.

SET @has_table := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'line_invoice_document'
);

SET @has_key := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'line_invoice_document'
    AND COLUMN_NAME = 'archivo_key'
);

SET @sql_add_key := IF(@has_table > 0 AND @has_key = 0,
  'ALTER TABLE `line_invoice_document` ADD COLUMN `archivo_key` VARCHAR(500) NULL AFTER `documento_id`',
  'SELECT 1');
PREPARE stmt_add_key FROM @sql_add_key; EXECUTE stmt_add_key; DEALLOCATE PREPARE stmt_add_key;

SET @has_url := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'line_invoice_document'
    AND COLUMN_NAME = 'archivo_url'
);

SET @sql_add_url := IF(@has_table > 0 AND @has_url = 0,
  'ALTER TABLE `line_invoice_document` ADD COLUMN `archivo_url` VARCHAR(500) NULL AFTER `archivo_key`',
  'SELECT 1');
PREPARE stmt_add_url FROM @sql_add_url; EXECUTE stmt_add_url; DEALLOCATE PREPARE stmt_add_url;
