-- Cuántos días antes del vencimiento se avisa.
ALTER TABLE `producto_lotes`
  ADD COLUMN `dias_notificacion` INT NULL;
