-- Registra qué usuario de la app realizó el movimiento (ingreso/salida manual o emisión).
ALTER TABLE `movimientos`
  ADD COLUMN `usuario_id` INT NULL AFTER `cliente_id`;

CREATE INDEX `movimientos_usuario_id_idx` ON `movimientos`(`usuario_id`);

ALTER TABLE `movimientos`
  ADD CONSTRAINT `movimientos_usuario_id_fkey`
  FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
