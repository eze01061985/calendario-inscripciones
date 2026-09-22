ALTER TABLE inscripciones
  MODIFY nombre VARCHAR(100) NULL,
  ADD COLUMN bloqueado TINYINT(1) NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_inscripciones_estado CHECK (
    (bloqueado = 0 AND nombre IS NOT NULL) OR
    (bloqueado = 1 AND nombre IS NULL)
  );
