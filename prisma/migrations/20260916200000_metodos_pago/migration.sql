-- Métodos de pago (Yape, CCI, etc.) por empresa.
CREATE TABLE IF NOT EXISTS `metodos_pago` (
  `id` VARCHAR(36) NOT NULL,
  `company_ruc` VARCHAR(11) NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `tipo` VARCHAR(30) NOT NULL,
  `valor` VARCHAR(80) NOT NULL,
  `activo` BOOLEAN NOT NULL DEFAULT true,
  `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizado_en` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `metodos_pago_company_ruc_idx` (`company_ruc`),
  KEY `metodos_pago_company_ruc_activo_idx` (`company_ruc`, `activo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Columna opcional en invoices (idempotente).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'metodo_pago_id'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `invoices` ADD COLUMN `metodo_pago_id` VARCHAR(36) NULL AFTER `forma_pago`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND INDEX_NAME = 'invoices_metodo_pago_id_idx'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX `invoices_metodo_pago_id_idx` ON `invoices` (`metodo_pago_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
