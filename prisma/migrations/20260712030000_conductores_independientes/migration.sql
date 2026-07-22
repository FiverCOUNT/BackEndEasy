-- Conductores independientes: solo tipo/número doc, nombres completos y licencia
ALTER TABLE `empresa_conductores`
  ADD COLUMN `nombres_completos` VARCHAR(255) NULL AFTER `numero_doc`;

UPDATE `empresa_conductores`
SET `nombres_completos` = TRIM(
  CONCAT(
    COALESCE(`nombres`, ''),
    CASE
      WHEN `apellidos` IS NOT NULL AND TRIM(`apellidos`) <> '' THEN CONCAT(' ', TRIM(`apellidos`))
      ELSE ''
    END
  )
)
WHERE `nombres_completos` IS NULL;

UPDATE `empresa_conductores`
SET `nombres_completos` = 'SIN NOMBRE'
WHERE `nombres_completos` IS NULL OR TRIM(`nombres_completos`) = '';

ALTER TABLE `empresa_conductores`
  DROP INDEX `empresa_conductores_company_ruc_tipo_doc_numero_doc_key`,
  DROP INDEX `empresa_conductores_company_ruc_idx`,
  DROP INDEX `empresa_conductores_company_ruc_numero_doc_idx`;

ALTER TABLE `empresa_conductores`
  DROP COLUMN `company_ruc`,
  DROP COLUMN `nombres`,
  DROP COLUMN `apellidos`,
  DROP COLUMN `activo`;

ALTER TABLE `empresa_conductores`
  MODIFY `nombres_completos` VARCHAR(255) NOT NULL;

CREATE UNIQUE INDEX `empresa_conductores_tipo_doc_numero_doc_key`
  ON `empresa_conductores`(`tipo_doc`, `numero_doc`);

CREATE INDEX `empresa_conductores_numero_doc_idx`
  ON `empresa_conductores`(`numero_doc`);
