# Minuto · Gestor7

App web en español para gestionar un equipo de fútbol, su calendario y los minutos de sus jugadores. Interfaz azul sky y negro, adaptable a ordenador, iPad y móvil.

## Qué incluye

- Registro e inicio de sesión. Cada cuenta tiene su equipo privado; la misma cuenta puede utilizarse en varios dispositivos.
- Nombre del equipo, competición y temporada; fútbol 5, 7, 8 u 11, duración prevista y reentradas configurables.
- Alta, edición y archivo de jugadores con nombre, dorsal y posición. Archivar conserva el historial.
- Calendario manual e importación CSV con plantilla descargable y validación previa.
- Selección y guardado de titulares antes del partido.
- Cronómetro del servidor que sobrevive a recargas, cierre del navegador y reinicio de la aplicación.
- Pausa, descanso, segunda parte, marcador, salida con un toque y sustitución simultánea de dos jugadores.
- Reentradas que suman distintos intervalos y opción de deshacer la última sustitución.
- Finalización que cierra los intervalos y acumula los minutos de la temporada. El partido finalizado queda cerrado.
- Estadísticas por temporada y exportación CSV, incluyendo segundos exactos.

## Despliegue en Coolify con PostgreSQL existente

1. Sube este proyecto a tu repositorio Git y crea una aplicación en Coolify desde ese repositorio.
2. Selecciona **Dockerfile** como Build Pack. Ruta del Dockerfile: `/Dockerfile`. Puerto expuesto: **3000**.
3. Configura el dominio HTTPS de la aplicación y estas variables **de ejecución**:

   ```dotenv
   DATABASE_URL=postgresql://USUARIO:CONTRASEÑA@HOST_INTERNO:5432/BASE_DE_DATOS
   APP_ORIGIN=https://tu-dominio.es
   NODE_ENV=production
   PORT=3000
   ALLOW_REGISTRATION=true
   ```

   `APP_ORIGIN` debe coincidir exactamente con el origen del navegador, sin ruta ni barra final. No incluyas credenciales de la base de datos en el código o en variables públicas de frontend. Si la contraseña contiene caracteres especiales, codifícalos en formato URL.

4. Si PostgreSQL comparte servidor y red de destino con la app, copia su **Internal URL** en `DATABASE_URL`. Si está en otro servidor Coolify, configura una conexión alcanzable entre servidores; el hostname interno no se resuelve por sí solo fuera de su red. Para servicios definidos como stacks separados puede ser necesario **Connect to Predefined Network**. Mantén PostgreSQL en la red privada siempre que sea posible.
5. Despliega. La app crea automáticamente sus tablas `minuto_users`, `minuto_teams`, `minuto_sessions` y `minuto_commands` al arrancar. El usuario de PostgreSQL necesita permiso para crearlas en el esquema. El arranque falla si no puede conectar, en lugar de guardar datos temporales.
6. Abre el dominio y pulsa **Crear una cuenta**. Registra el nombre del equipo, añade jugadores y calendario. Si el despliegue es para un solo club, después puedes poner `ALLOW_REGISTRATION=false` y redesplegar para cerrar nuevos registros.
7. Configura la comprobación de salud en **GET `/api/health`**, puerto 3000. El Dockerfile también incorpora esta comprobación y valida la conexión a la base de datos.

La imagen usa Node 22, compila la interfaz y ejecuta el servidor con un usuario sin privilegios. No necesita volumen de aplicación: los datos se guardan en PostgreSQL. Las tipografías se incluyen en la imagen, sin solicitudes a Google Fonts.

### PostgreSQL con TLS

`DATABASE_URL` admite los parámetros SSL de node-postgres. Para un servidor con CA propia, configura `DATABASE_SSL_CA` con el certificado PEM; se admiten saltos de línea o `\n`. En ese caso, evita parámetros `sslmode`, `sslcert`, `sslkey` o `sslrootcert` en la URL, ya que pueden sustituir la configuración de CA. La app no desactiva la validación de certificados.

Documentación: [Dockerfile en Coolify](https://coolify.io/docs/applications/builds/dockerfile), [conexiones de base de datos](https://coolify.io/docs/databases/), [redes de Coolify](https://coolify.io/docs/core/networking-in-coolify), [TLS en node-postgres](https://node-postgres.com/features/ssl).

## Desarrollo local

Usa Node **22.12 o posterior** (se incluye `.nvmrc`).

```sh
npm ci
cp .env.example .env
# Edita DATABASE_URL con tu PostgreSQL de desarrollo.
npm run dev
```

Abre `http://localhost:3000`. Para explorar sin PostgreSQL:

```sh
DEMO_MODE=true npm run dev
```

La demo contiene un equipo ficticio y datos temporales en memoria, compartidos entre las pestañas de ese servidor. Se pierden al reiniciarlo. Está señalada en la interfaz y **no puede iniciarse en producción**. Al desplegar con PostgreSQL, los equipos empiezan vacíos y nunca se insertan datos de demo.

## Usar durante un partido

1. Abre un partido del calendario. Selecciona titulares y usa **Guardar alineación** si lo prepararás antes del día del partido.
2. Con el pitido inicial, pulsa **Iniciar partido**. Si eliges menos jugadores que la modalidad configurada, la app te avisa antes de iniciar.
3. Cuando salga un jugador, búscalo por nombre o dorsal y pulsa **Sustituido**. Se registra el instante de recepción en el servidor. En **Banquillo**, pulsa **Entrar** para registrar al sustituto. Usa **Cambio** si ambos deben compartir exactamente el mismo instante.
4. Pulsa **Descanso** al terminar la primera parte y **Iniciar segunda parte** al volver. El descanso no suma minutos. El tiempo continúa desde donde se detuvo; no se redondea a una duración reglamentaria.
5. Pulsa **Finalizar partido** y confirma. Las estadísticas de temporada incluyen solo los partidos finalizados; el directo tiene su propio cómputo.

Se guardan fracciones de segundo y se suman antes de mostrar minutos completos. Un cronómetro de `12:30` representa 12 minutos y 30 segundos. Las reentradas abren intervalos nuevos. La duración configurada es orientativa; no finaliza automáticamente el encuentro.

La app requiere conexión para registrar cambios. Si falla la red, lo indica; no registra sustituciones offline ni inventa tiempos. Si el dispositivo lo permite, mantiene la pantalla despierta durante el directo. Las actualizaciones de otros dispositivos se consultan cada cinco segundos. PostgreSQL serializa las operaciones del equipo, verifica la revisión y deduplica reintentos; ante un conflicto la app refresca y pide revisar la acción.

## Comprobaciones

```sh
npm test
npm run build
docker build -t minuto .
```

Las pruebas de dominio cubren reloj, pausas, cambios, reentradas, errores, deshacer, fin de partido e integridad de minutos. Las pruebas de API y almacenamiento se ejecutan contra PostgreSQL embebido en memoria (PGlite) o contra una base de pruebas real:

```sh
TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/minuto_test npm test
```

Usa una base exclusiva para pruebas. Las pruebas crean tablas y cuentas ficticias. No uses la conexión de producción.

## Operación y alcance

- Haz copias de seguridad de PostgreSQL desde Coolify. El repositorio y la imagen no contienen los datos del equipo.
- Una cuenta por equipo, sin roles separados ni recuperación de contraseña por correo en esta versión. Guarda las credenciales en un gestor de contraseñas.
- No hay conexión con proveedores de calendarios: la carga es manual o por CSV.
- Las pausas y el final se marcan manualmente. No se pueden corregir partidos finalizados desde la interfaz.
- Modelo de datos: una fila JSONB por equipo (plantilla, configuración, partidos e intervalos), con bloqueo transaccional y revisión. Usuarios y sesiones tienen tablas separadas. Adecuado para equipos y ligas de tamaño habitual; conserva el historial de la plantilla dentro del equipo.
- No se ha configurado ningún dominio ni conexión a tu instancia de Coolify: añade las variables reales al desplegar.
