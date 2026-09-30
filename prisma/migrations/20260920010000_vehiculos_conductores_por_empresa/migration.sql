-- Vehículos y conductores por empresa (company_ruc).
-- Existentes se asignan a OPERADOR LOGISTICO RAYMI S.A.C (20611016591).

ALTER TABLE `vehiculos`
  ADD COLUMN `company_ruc` VARCHAR(11) NULL AFTER `id`;

UPDATE `vehiculos`
SET `company_ruc` = '20611016591'
WHERE `company_ruc` IS NULL OR `company_ruc` = '';

ALTER TABLE `vehiculos`
  MODIFY `company_ruc` VARCHAR(11) NOT NULL;

DROP INDEX `vehiculos_placa_key` ON `vehiculos`;

CREATE UNIQUE INDEX `vehiculos_company_ruc_placa_key` ON `vehiculos`(`company_ruc`, `placa`);
CREATE INDEX `vehiculos_company_ruc_idx` ON `vehiculos`(`company_ruc`);

ALTER TABLE `conductores`
  ADD COLUMN `company_ruc` VARCHAR(11) NULL AFTER `id`;

UPDATE `conductores`
SET `company_ruc` = '20611016591'
WHERE `company_ruc` IS NULL OR `company_ruc` = '';

ALTER TABLE `conductores`
  MODIFY `company_ruc` VARCHAR(11) NOT NULL;

DROP INDEX `conductores_tipo_doc_numero_doc_key` ON `conductores`;

CREATE UNIQUE INDEX `conductores_company_ruc_tipo_doc_numero_doc_key`
  ON `conductores`(`company_ruc`, `tipo_doc`, `numero_doc`);
CREATE INDEX `conductores_company_ruc_idx` ON `conductores`(`company_ruc`);
