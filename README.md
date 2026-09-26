# Minuto · Gestor7

App web en español para gestionar un equipo de fútbol, su calendario y los minutos de sus jugadores. Interfaz azul sky y negro, adaptable a ordenador, iPad y móvil.

## Qué incluye

- Registro con correo verificado, recuperación de contraseña y acceso con Google, Apple o Facebook cuando están configurados. Cada cuenta conserva su espacio privado y puede utilizarse en varios dispositivos.
- Nombre del equipo, competición y temporada; fútbol 5, 7, 8 u 11, duración prevista y reentradas configurables.
- Alta, edición y archivo de jugadores con nombre, dorsal y posición. Archivar conserva el historial.
- Calendario manual e importación CSV con plantilla descargable y validación previa.
- Selección y guardado de titulares antes del partido.
- Cronómetro del servidor que sobrevive a recargas, cierre del navegador y reinicio de la aplicación.
- Pausa, descanso, segunda parte, marcador y sustituciones rápidas: pulsa en quien sale y toca al compañero que entró.
- Reentradas que suman distintos intervalos y opción de deshacer la última sustitución.
- Cobros por equipo y temporada: ficha, seguro, uniforme pagado y entregado y cuotas de enero a diciembre. Cada casilla requiere pulsarla y confirmar el aviso, tanto para marcar como para desmarcar; cancelar el aviso no modifica el registro. Historial de temporadas y jugadores archivados conservado en PostgreSQL.
- Finalización que cierra los intervalos y acumula los minutos de la temporada. El partido finalizado queda cerrado.
- Estadísticas por temporada y exportación CSV, incluyendo segundos exactos.

## Despliegue en Coolify con PostgreSQL existente

**Antes de desplegar esta versión:** completa [PRIVACY_SETUP.md](PRIVACY_SETUP.md). Producción exige una clave de cifrado y los datos reales del aviso de privacidad. Haz una copia recuperable antes de migrar el almacenamiento. El cifrado y las herramientas de privacidad no equivalen por sí solos a cumplimiento legal.

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
6. Configura el correo y los proveedores siguiendo [AUTH_SETUP.md](AUTH_SETUP.md) antes de desplegar esta versión. Abre el dominio, pulsa **Crear una cuenta** y confirma el correo recibido antes de iniciar sesión. Las cuentas anteriores también deben verificar su correo; sus datos se conservan. Si el despliegue es para un solo club, después puedes poner `ALLOW_REGISTRATION=false` y redesplegar para cerrar nuevos registros.
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
3. Cuando salga un jugador, búscalo por nombre o dorsal en **En el campo** y pulsa **Sustituir**. Aparecerá **¿Quién entró por ti?**: toca al compañero disponible y el cambio se guarda directamente, sin otra confirmación ni preguntas sobre posiciones. La salida y la entrada comparten el instante de recepción en el servidor; el entrante hereda automáticamente la posición del saliente. Cancelar no registra ningún cambio. Si comenzaste con menos jugadores, puedes completar el campo desde **Banquillo → Entrar**.
4. Si los jugadores usarán una tablet compartida, después de iniciar el partido entra en **Privacidad → Activar modo banquillo** en esa tablet. Solo permite sustituciones de ese partido, sin cobros ni fichas completas. Continúa los controles del partido desde otro dispositivo con tu sesión de gestión.
5. Pulsa **Descanso** al terminar la primera parte y **Iniciar segunda parte** al volver. El descanso no suma minutos. El tiempo continúa desde donde se detuvo; no se redondea a una duración reglamentaria.
6. Pulsa **Finalizar partido** y confirma. Las estadísticas de temporada incluyen solo los partidos finalizados; el directo tiene su propio cómputo.

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
- Cada cuenta puede gestionar varios equipos. El modo banquillo limita una tablet a sustituciones del partido activo; no hay roles individuales por jugador ni varios gestores independientes por club. La verificación y recuperación dependen del correo configurado. Los proveedores requieren sus propias credenciales y las aprobaciones externas correspondientes.
- No hay conexión con proveedores de calendarios: la carga es manual o por CSV.
- Las pausas y el final se marcan manualmente. No se pueden corregir partidos finalizados desde la interfaz.
- Modelo de datos: un espacio por cuenta con sus equipos, cifrado en un contenedor JSONB con AES-256-GCM en producción; imágenes cifradas por separado. Bloqueo transaccional y revisión. Identidad de cuenta y sesiones tienen tablas separadas; no están cubiertas por el cifrado de espacios. Adecuado para equipos y ligas de tamaño habitual.
- Menú **Privacidad**: exportación completa o individual, eliminación confirmada y revocación de sesiones. Aviso público en `/privacy`. Versión para adultos. Sigue [PRIVACY_SETUP.md](PRIVACY_SETUP.md) para responsabilidades, copias, derechos y configuración; contrato de encargo pendiente de formalizar con cada responsable.
- No se ha configurado ningún dominio ni conexión a tu instancia de Coolify: añade las variables reales al desplegar.
