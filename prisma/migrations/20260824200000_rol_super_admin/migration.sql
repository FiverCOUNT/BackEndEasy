-- SUPER_ADMIN: solo este rol entra al panel /admin (gestión de plataforma).
-- ADMIN / USUARIO siguen siendo roles de app móvil por empresa.

ALTER TABLE `usuarios`
  MODIFY COLUMN `rol` ENUM('ADMIN', 'USUARIO', 'SUPER_ADMIN') NOT NULL DEFAULT 'USUARIO';
