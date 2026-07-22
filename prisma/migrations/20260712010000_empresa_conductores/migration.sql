-- Conductores GRE por empresa — CRUD /api/empresas/{ruc}/conductores
CREATE TABLE `empresa_conductores` (
    `id` VARCHAR(36) NOT NULL,
    `company_id` BIGINT NOT NULL,
    `company_ruc` VARCHAR(11) NOT NULL,
    `tipo_doc` VARCHAR(2) NOT NULL DEFAULT '1',
    `numero_doc` VARCHAR(20) NOT NULL,
    `nombres` VARCHAR(120) NOT NULL,
    `apellidos` VARCHAR(120) NULL,
    `licencia` VARCHAR(40) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `empresa_conductores_company_ruc_tipo_doc_numero_doc_key`(`company_ruc`, `tipo_doc`, `numero_doc`),
    INDEX `empresa_conductores_company_ruc_idx`(`company_ruc`),
    INDEX `empresa_conductores_company_id_idx`(`company_id`),
    INDEX `empresa_conductores_company_ruc_numero_doc_idx`(`company_ruc`, `numero_doc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `empresa_conductores`
  ADD CONSTRAINT `empresa_conductores_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
