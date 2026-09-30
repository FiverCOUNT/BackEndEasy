-- Almacén de origen por línea de orden (descuento de stock).
ALTER TABLE `orden_detalles`
  ADD COLUMN `almacen_id` VARCHAR(36) NULL AFTER `total`;

ALTER TABLE `orden_detalles`
  ADD INDEX `orden_detalles_almacen_id_idx` (`almacen_id`);

ALTER TABLE `orden_detalles`
  ADD CONSTRAINT `orden_detalles_almacen_id_fkey`
  FOREIGN KEY (`almacen_id`) REFERENCES `almacenes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
