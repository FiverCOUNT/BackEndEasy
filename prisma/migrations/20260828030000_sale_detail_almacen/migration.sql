-- Identificador de inventario por línea: con almacen_id descuenta stock; sin él = digitada.
ALTER TABLE `sale_details` ADD COLUMN `almacen_id` VARCHAR(36) NULL;
CREATE INDEX `sale_details_almacen_id_idx` ON `sale_details`(`almacen_id`);
ALTER TABLE `sale_details` ADD CONSTRAINT `sale_details_almacen_id_fkey` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
