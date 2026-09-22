# Calendario de inscripciones

Un calendario compartido que reemplaza la hoja mensual de papel que pasa de mano en mano. Está pensado para personas con poca experiencia tecnológica: el enlace abre directamente el mes, se toca un casillero blanco y se escribe un nombre. Sin cuentas públicas, menús ni formularios largos.

<!-- Captura: guardar una imagen de la versión desplegada en docs/calendario.png y reemplazar esta línea por ![Calendario en móvil](docs/calendario.png). -->

## Qué hace

- Muestra el mes de lunes a domingo; los días ocupados aparecen en verde con el nombre visible para todos.
- Permite una inscripción por día, pero la misma familia puede elegir varios días.
- Solo habilita el mes en curso y el siguiente; los días pasados y los bloqueados se ven grises.
- Desde `/admin` se pueden bloquear y volver a habilitar días sin crear inscripciones ficticias.
- Evita la doble reserva incluso con peticiones simultáneas: `UNIQUE(fecha)` en MySQL es la autoridad final tanto para inscripciones como para bloqueos, y la API traduce duplicados en HTTP 409.
- Actualiza el calendario al anotarse y cada minuto; antes de enviar, vuelve a consultar el mes.
- Protege `/admin` con contraseña, cookie HttpOnly y sesión de 8 horas. El administrador puede agregar, editar, mover y eliminar; no existe registro público.
- Tiene validación en ambos lados, límites de intentos, Helmet, SQL parametrizado, cookies Secure en producción y mensajes de error sin trazas.

## Stack y estructura

React 19 + Vite 7 + CSS; Node.js 20+ + Express 5; MySQL 8; Railway para un servicio web y un servicio MySQL. Monorepo npm workspaces:

```text
client/                 Interfaz pública y administración
server/src/app.js       Rutas, autenticación y errores
server/src/db.js        Consultas parametrizadas y migración al iniciar
server/src/validation.js  Reglas de datos
server/migrations/      Esquema y actualización reproducibles
server/test/            Pruebas de reglas y API
```

El backend sirve el build de Vite desde la misma URL. Así no hace falta configurar CORS ni dominios separados: la política de mismo origen es deliberada. La API pública solo ofrece lectura y creación; las operaciones de cambio exigen la cookie administrativa. Las fechas se almacenan como `DATE` (sin hora) y el servidor compara días según su zona horaria; configurá `TZ` en Railway para la zona local del grupo.

## API

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health` | Estado y conectividad MySQL |
| GET | `/api/inscripciones?year=2026&month=10` | Consultar un mes |
| POST | `/api/inscripciones` | Crear `{ "fecha": "2026-10-08", "nombre": "Familia Flores" }` |
| POST | `/api/admin/login`, `/api/admin/logout` | Sesión administrativa |
| GET | `/api/admin/session` | Comprobar sesión |
| GET, POST | `/api/admin/inscripciones` | Listar todas o agregar |
| PATCH, DELETE | `/api/admin/inscripciones/:id` | Editar/mover o eliminar |
| GET, POST | `/api/admin/bloqueos` | Listar o bloquear días |
| DELETE | `/api/admin/bloqueos/:id` | Volver a habilitar un día |

Un conflicto de fecha, incluso entre una inscripción y un bloqueo, responde `409`. Las fechas fuera de los dos meses activos responden `400`. Los usuarios públicos no disponen de PUT, PATCH ni DELETE para inscripciones o bloqueos.

## Instalación local

1. Crear una base MySQL vacía, por ejemplo `calendario`.
2. `npm install`
3. Copiar `.env.example` a `.env` y completar los valores. Generar el hash con `node -e "import('bcryptjs').then(b=>b.hash('TU_CONTRASEÑA',12).then(console.log))"` (evitá poner una contraseña real en el historial del shell; mejor usar un script interactivo o un gestor de secretos).
4. `npm run build && npm start` abre el servidor en `http://localhost:3000`. Al arrancar crea el esquema inicial si falta y aplica `server/migrations/002_blocked_days.sql` si la columna de bloqueos todavía no existe.
5. Para desarrollo con recarga: `npm run dev` (Vite en `http://127.0.0.1:5173`, proxy de `/api` al servidor).

Variables: `DATABASE_URL` (URL de conexión MySQL), `ADMIN_PASSWORD_HASH` (bcrypt), `SESSION_SECRET` (aleatorio de al menos 32 caracteres), `NODE_ENV=production`, `PORT` (Railway lo asigna), `TZ` (zona IANA del grupo, recomendada). Nunca se versiona `.env`.

## Despliegue en Railway

Crear un proyecto con un servicio MySQL y un servicio desde este repositorio. En el servicio web, usar `npm run build` como comando de build y `npm start` como comando de inicio; configurar las variables anteriores. `DATABASE_URL` debe referenciar la URL privada del servicio MySQL de Railway. Asignar un dominio público al servicio web y verificar `/api/health`. El esquema inicial y la actualización para bloqueos se aplican al arrancar, sin pasos manuales irreproducibles. Para cambios futuros, agregar una migración versionada y un ejecutor que registre cuáles se aplicaron.

Demo en producción: [calendario-inscripciones-production.up.railway.app](https://calendario-inscripciones-production.up.railway.app/). La administración está en [`/admin`](https://calendario-inscripciones-production.up.railway.app/admin).

## Pruebas y decisiones

`npm test` cubre validaciones, ventana de dos meses, creación, conflictos con bloqueos, mismo nombre en otra fecha, sesión, autorización, edición, movimiento, eliminación y dos envíos simultáneos a la API. `npm run build` comprueba el frontend. Los tests usan un adaptador de base en memoria para ejercitar la API. En el despliegue inicial también se comprobó la URL pública contra MySQL real: salud, alta pública, conflicto, rechazo de fecha pasada, acceso administrativo, alta, edición, movimiento y eliminación. Las inscripciones temporales de esa prueba se retiraron. El índice UNIQUE de la migración, no el adaptador de tests ni una comprobación previa en React, garantiza la regla en producción.

La interfaz evita controles innecesarios y conserva el calendario como superficie principal. Los días pasados no se pueden elegir en público. Las inscripciones no son secretas: cualquier visitante puede ver el nombre, tal como en el calendario físico. Por eso conviene compartir el enlace solo con el grupo previsto y no poner datos sensibles en el nombre.
