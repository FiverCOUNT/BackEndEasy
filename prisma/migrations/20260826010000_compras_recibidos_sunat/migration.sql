-- Compras: ampliar para CPE recibidos (SUNAT SIRE/SSPP) sin mezclar con invoices emitidos.
ALTER TABLE `compras`
  ADD COLUMN `xml_url` VARCHAR(500) NULL,
  ADD COLUMN `pdf_url` VARCHAR(500) NULL,
  ADD COLUMN `hash_cpe` VARCHAR(128) NULL,
  ADD COLUMN `fuente` VARCHAR(30) NULL,
  ADD COLUMN `estado` VARCHAR(30) NULL DEFAULT 'ACEPTADO',
  ADD COLUMN `guia_meta` JSON NULL,
  ADD COLUMN `sunat_estado` VARCHAR(50) NULL,
  ADD COLUMN `sunat_codigo` VARCHAR(20) NULL,
  ADD COLUMN `sunat_descripcion` TEXT NULL;

CREATE INDEX `compras_company_ruc_fecha_emision_idx` ON `compras`(`company_ruc`, `fecha_emision`);
CREATE INDEX `compras_fuente_idx` ON `compras`(`fuente`);
