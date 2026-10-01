-- Ordenar los lotes del más reciente al más antiguo.
ALTER TABLE `producto_lotes`
  ADD COLUMN `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
