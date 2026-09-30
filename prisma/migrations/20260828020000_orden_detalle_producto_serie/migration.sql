-- Serie elegida en líneas de orden (productos NIU con maneja_serie).
ALTER TABLE `orden_detalles` ADD COLUMN `producto_serie_id` VARCHAR(36) NULL;
CREATE INDEX `orden_detalles_producto_serie_id_idx` ON `orden_detalles`(`producto_serie_id`);
ALTER TABLE `orden_detalles` ADD CONSTRAINT `orden_detalles_producto_serie_id_fkey` FOREIGN KEY (`producto_serie_id`) REFERENCES `producto_series`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
