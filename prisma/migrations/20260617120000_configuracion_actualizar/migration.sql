-- Forzar actualización desde Play Store (toggle en panel web)
ALTER TABLE `configuracion` ADD COLUMN `actualizar` BOOLEAN NOT NULL DEFAULT false;
