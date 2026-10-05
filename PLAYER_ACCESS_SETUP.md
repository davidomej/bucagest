# Jugadores e invitaciones

## Uso

1. El gestor añade un jugador en **Plantilla**, incluyendo su correo. Las fichas anteriores se conservan; para invitarlas basta con editar su correo y guardar.
2. BucaGest envía una invitación con el proveedor de correo ya configurado (`RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `APP_ORIGIN`). Si el envío falla, la ficha queda guardada y se muestra el aviso. En la tarjeta se puede reenviar la invitación, consultar su estado y revocar el acceso.
3. El enlace caduca en 72 horas. El jugador elige una contraseña y la aceptación verifica el correo. Después inicia sesión. No se crea una sesión automáticamente al abrir el enlace.
4. Si el correo ya tiene una cuenta verificada, acepta usando su contraseña actual. La invitación no sustituye esa contraseña ni cambia su rol. Una cuenta que ya era gestora puede entrar en **Mi área de jugador**; una cuenta nueva invitada tiene únicamente el rol de jugador.
5. El jugador consulta sus minutos y resultados registrados por el equipo, el calendario completo y las competiciones oficiales asignadas. Puede seleccionar equipo y temporada. Un mismo correo puede pertenecer a varios equipos, pero no a dos fichas activas del mismo equipo.

Las invitaciones funcionan aunque el registro abierto esté desactivado con `ALLOW_REGISTRATION=false`. La demo no envía correos. Las fichas sin correo siguen disponibles para la gestión, pero las nuevas altas a través de la API requieren correo.

## Permisos y revocación

El servidor limita el rol `player` al área personal de lectura. No entrega la plantilla completa, correos ajenos, cumpleaños, fotografías ni cobros; tampoco permite comandos de gestión o sustituciones. La sesión no contiene el identificador de otro jugador que el cliente pueda cambiar para suplantarlo: la vinculación se consulta en la base de datos.

Cambiar el correo, archivar, borrar al jugador o eliminar su equipo revoca el acceso y los enlaces pendientes dentro de la transacción de la plantilla. El botón **Revocar acceso** también anula las invitaciones. Un nuevo acceso requiere otra invitación aceptada. La sesión personal puede seguir abierta para otros equipos, pero las nuevas consultas ya no devuelven el equipo revocado. La pantalla consulta cambios cada 30 segundos y al recuperar el foco; los datos que ya se entregaron no pueden retirarse de una captura o copia previa.

Los enlaces se guardan solo como hash, son de un uso y se invalidan al reenviarlos. La dirección del jugador se cifra en la tabla de accesos con la misma clave de aplicación que protege la plantilla, ligada al usuario, equipo y jugador. Una cuenta sin verificar no puede iniciar sesión. El enlace de invitación cierra la sesión anterior del navegador para evitar cruces de cuentas. Las cuentas gestoras existentes conservan su rol en la migración.

## Resultados y clasificaciones oficiales

En **Configuración → Ligas y competiciones**, crea la liga o copa, selecciona su tipo y temporada, y asígnala al equipo. La clasificación oficial está separada de los minutos y marcadores registrados por el gestor. No se calcula una clasificación de toda la liga a partir de los partidos internos.

El arranque crea estas tablas para el futuro workflow:

| Tabla | Contenido |
| --- | --- |
| `minuto_official_competitions` | Cabecera de una actualización: propietario, competición, temporada, tipo (`league` o `cup`), URL de origen y fecha de actualización. |
| `minuto_official_results` | Partidos oficiales identificados por `external_id`, fecha, jornada o eliminatoria, nombres local/visitante, marcador y estado. |
| `minuto_official_standings` | Posición y estadísticas por equipo, con `group_name` para grupos de copa. |

Las tres usan `(owner_id, league_id, season)` para vincular los datos a una competición del espacio del gestor. Los identificadores `owner_id` y `league_id` corresponden al usuario gestor y a la competición de `/api/team`, respectivamente. El workflow deberá mapear los identificadores de la web oficial a esos identificadores internos. La contraseña, el identificador del jugador y la cookie del jugador no son credenciales de importación.

Contrato de importación:

- `minuto_official_competitions`: `owner_id UUID`, `league_id UUID`, `season TEXT`, `kind ('league'|'cup')`, `source_url TEXT` (URL HTTP/HTTPS o NULL), `updated_at TIMESTAMPTZ` (fecha del último importado completo, con zona horaria).
- `minuto_official_results`: clave `(owner_id, league_id, season, external_id)`; `external_id TEXT` estable en origen, `match_date TIMESTAMPTZ` o NULL, `round TEXT` (p. ej. `Jornada 8`, `Semifinal`), `home_team`, `away_team`, `home_score`, `away_score` (enteros no negativos o NULL si no se conoce el resultado), `status ('scheduled'|'finished'|'postponed')`. No interpretar un resultado pendiente como 0–0.
- `minuto_official_standings`: clave `(owner_id, league_id, season, group_name, position)`; `group_name TEXT` vacío para liga única, `position` entero positivo, `team_name TEXT`, `played`, `won`, `drawn`, `lost`, `goals_for`, `goals_against` enteros no negativos y `points` entero (puede ser negativo por sanción).

Para cada actualización completa, el workflow debe validar la descarga antes de escribir. Después, en **una única transacción**, crear/actualizar la cabecera, reemplazar las filas de resultados y clasificación de esa clave exacta, fijar `updated_at` y confirmar. Así el área del jugador no mezcla dos actualizaciones. No borrar los últimos datos válidos si falla la web de origen. El lector usa una instantánea consistente y muestra fecha y fuente; hasta el primer importado muestra **Datos oficiales pendientes de actualización**.

En una copa eliminatoria puede no haber clasificación: se muestran sus encuentros por ronda. Si existen grupos, las filas de clasificación incluyen el grupo. El futuro workflow debe tener credenciales propias limitadas a las tablas oficiales; no requiere acceso a las tablas de usuarios, sesiones o datos cifrados del equipo. No se ha creado un endpoint público de escritura ni se ha programado aún la consulta a una web externa.

## Validación antes del despliegue

Ejecuta `npm test` y `npm run build`, y construye la imagen en GitHub según [COOLIFY_IMAGE_SETUP.md](COOLIFY_IMAGE_SETUP.md). Las nuevas tablas se crean al arrancar la versión, manteniendo las cuentas y plantillas existentes. El envío real requiere que el proveedor de correo ya configurado admita el remitente de la aplicación.
