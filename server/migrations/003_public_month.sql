CREATE TABLE IF NOT EXISTS configuracion_calendario (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  mes DATE NOT NULL,
  CONSTRAINT chk_configuracion_unica CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
