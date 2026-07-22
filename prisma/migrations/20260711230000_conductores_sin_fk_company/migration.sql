-- Conductores: quitar relación FK con companies (solo company_ruc)
ALTER TABLE `empresa_conductores` DROP FOREIGN KEY `empresa_conductores_company_id_fkey`;
DROP INDEX `empresa_conductores_company_id_idx` ON `empresa_conductores`;
ALTER TABLE `empresa_conductores` DROP COLUMN `company_id`;
