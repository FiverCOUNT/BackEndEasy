-- Dirección como JSON en entidades; addresses queda solo catálogo del picker.

-- 1) Columnas JSON
ALTER TABLE `companies` ADD COLUMN `address_json` JSON NULL;
ALTER TABLE `clientes` ADD COLUMN `address_json` JSON NULL;
ALTER TABLE `almacenes` ADD COLUMN `address_json` JSON NULL;
ALTER TABLE `ordenes` ADD COLUMN `address_envio` JSON NULL;

-- 2) Backfill desde filas enlazadas
UPDATE `companies` c
INNER JOIN `addresses` a ON a.`id` = c.`address_id`
SET c.`address_json` = JSON_OBJECT(
  'ubigeo', a.`ubigeo`,
  'departamento', a.`departamento`,
  'provincia', a.`provincia`,
  'distrito', a.`distrito`,
  'urbanizacion', a.`urbanizacion`,
  'direccion', a.`direccion`,
  'cod_local', a.`cod_local`
)
WHERE c.`address_id` IS NOT NULL;

UPDATE `clientes` c
INNER JOIN `addresses` a ON a.`id` = c.`address_id`
SET c.`address_json` = JSON_OBJECT(
  'ubigeo', a.`ubigeo`,
  'departamento', a.`departamento`,
  'provincia', a.`provincia`,
  'distrito', a.`distrito`,
  'urbanizacion', a.`urbanizacion`,
  'direccion', a.`direccion`,
  'cod_local', a.`cod_local`
)
WHERE c.`address_id` IS NOT NULL;

UPDATE `almacenes` alm
INNER JOIN `addresses` a ON a.`id` = alm.`address_id`
SET alm.`address_json` = JSON_OBJECT(
  'ubigeo', a.`ubigeo`,
  'departamento', a.`departamento`,
  'provincia', a.`provincia`,
  'distrito', a.`distrito`,
  'urbanizacion', a.`urbanizacion`,
  'direccion', a.`direccion`,
  'cod_local', a.`cod_local`
)
WHERE alm.`address_id` IS NOT NULL;

UPDATE `ordenes` o
INNER JOIN `addresses` a ON a.`id` = o.`address_envio_id`
SET o.`address_envio` = JSON_OBJECT(
  'ubigeo', a.`ubigeo`,
  'departamento', a.`departamento`,
  'provincia', a.`provincia`,
  'distrito', a.`distrito`,
  'urbanizacion', a.`urbanizacion`,
  'direccion', a.`direccion`,
  'cod_local', a.`cod_local`
)
WHERE o.`address_envio_id` IS NOT NULL;

-- 3) Marcar en catálogo las addresses que tenían company_ruc (o heredar del dueño)
UPDATE `addresses` a
INNER JOIN `companies` c ON c.`address_id` = a.`id`
SET a.`company_ruc` = COALESCE(a.`company_ruc`, c.`ruc`),
    a.`etiqueta` = COALESCE(NULLIF(a.`etiqueta`, ''), CONCAT('Sede · ', COALESCE(a.`distrito`, a.`direccion`, 'empresa')));

UPDATE `addresses` a
INNER JOIN `clientes` c ON c.`address_id` = a.`id`
SET a.`company_ruc` = COALESCE(a.`company_ruc`, c.`company_ruc`),
    a.`etiqueta` = COALESCE(NULLIF(a.`etiqueta`, ''), CONCAT('Cliente · ', COALESCE(a.`distrito`, a.`direccion`, c.`razon_social`)));

UPDATE `addresses` a
INNER JOIN `almacenes` alm ON alm.`address_id` = a.`id`
SET a.`company_ruc` = COALESCE(a.`company_ruc`, alm.`company_ruc`),
    a.`etiqueta` = COALESCE(NULLIF(a.`etiqueta`, ''), CONCAT(alm.`nombre`, ' · ', COALESCE(a.`distrito`, a.`direccion`, 'almacén')));

-- 4) Quitar FKs y columnas de enlace
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'address_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1
);
SET @sql := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `companies` DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'address_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1
);
SET @sql := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `clientes` DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'almacenes' AND COLUMN_NAME = 'address_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1
);
SET @sql := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `almacenes` DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes' AND COLUMN_NAME = 'address_envio_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1
);
SET @sql := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `ordenes` DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'address_id'
    AND INDEX_NAME != 'PRIMARY' LIMIT 1
);
SET @sql := IF(@idx IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `companies` DROP INDEX `', @idx, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'address_id'
    AND INDEX_NAME != 'PRIMARY' LIMIT 1
);
SET @sql := IF(@idx IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `clientes` DROP INDEX `', @idx, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'almacenes' AND COLUMN_NAME = 'address_id'
    AND INDEX_NAME != 'PRIMARY' LIMIT 1
);
SET @sql := IF(@idx IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `almacenes` DROP INDEX `', @idx, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes' AND COLUMN_NAME = 'address_envio_id'
    AND INDEX_NAME != 'PRIMARY' LIMIT 1
);
SET @sql := IF(@idx IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `ordenes` DROP INDEX `', @idx, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE `companies` DROP COLUMN `address_id`;
ALTER TABLE `clientes` DROP COLUMN `address_id`;
ALTER TABLE `almacenes` DROP COLUMN `address_id`;
ALTER TABLE `ordenes` DROP COLUMN `address_envio_id`;
