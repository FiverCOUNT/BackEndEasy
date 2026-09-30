-- companies: eliminar columna duplicada is_active (se usa solo `activo`)
-- Unificar valores antes de borrar por si alguna fila solo tenía is_active.
UPDATE `companies`
SET `activo` = COALESCE(`activo`, `is_active`, 1);

ALTER TABLE `companies` DROP COLUMN `is_active`;
