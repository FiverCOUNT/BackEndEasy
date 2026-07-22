-- Vehículos independientes (solo placa) + permisos tipo/número (TUCE, etc.)

-- Pasar TUCE antiguo (nro_circulacion) a permisos
INSERT INTO `empresa_vehiculo_permisos` (`id`, `vehiculo_id`, `tipo`, `numero`, `creado_en`)
SELECT UUID(), v.`id`, 'TUCE', v.`nro_circulacion`, NOW(3)
FROM `empresa_vehiculos` v
WHERE v.`nro_circulacion` IS NOT NULL
  AND TRIM(v.`nro_circulacion`) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `empresa_vehiculo_permisos` p
    WHERE p.`vehiculo_id` = v.`id` AND p.`tipo` = 'TUCE' AND p.`numero` = v.`nro_circulacion`
  );

ALTER TABLE `empresa_vehiculos` DROP FOREIGN KEY `empresa_vehiculos_company_id_fkey`;

ALTER TABLE `empresa_vehiculos`
  DROP INDEX `empresa_vehiculos_company_ruc_placa_key`,
  DROP INDEX `empresa_vehiculos_company_ruc_idx`,
  DROP INDEX `empresa_vehiculos_company_id_idx`;

ALTER TABLE `empresa_vehiculos`
  DROP COLUMN `company_id`,
  DROP COLUMN `company_ruc`,
  DROP COLUMN `nro_circulacion`,
  DROP COLUMN `etiqueta`,
  DROP COLUMN `activo`;

CREATE UNIQUE INDEX `empresa_vehiculos_placa_key` ON `empresa_vehiculos`(`placa`);

-- Simplificar permisos: solo tipo + numero
ALTER TABLE `empresa_vehiculo_permisos`
  DROP COLUMN `descripcion`,
  DROP COLUMN `fecha_emision`,
  DROP COLUMN `fecha_vencimiento`,
  DROP COLUMN `activo`;
