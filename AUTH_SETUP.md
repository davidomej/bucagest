# Acceso verificado de BucaGest

El registro está abierto a cualquier persona que verifique su correo. No es un sistema de invitaciones ni aprobación manual. La aplicación conserva PostgreSQL y las sesiones privadas por cuenta.

## Antes de desplegar

Configura el correo en Coolify **antes** de desplegar esta versión. Las cuentas anteriores conservan todos sus datos, pero al no tener una verificación registrada, sus sesiones dejan de dar acceso. Sus usuarios deben pulsar **Reenviar confirmación**, abrir el enlace y elegir una contraseña. Después inician sesión con normalidad. No se marca como verificada una cuenta antigua sin comprobar el correo.

El esquema se actualiza automáticamente al arrancar: añade la fecha de verificación, identidades de proveedores, enlaces de correo y solicitudes OAuth. Haz la copia habitual de PostgreSQL antes de desplegar una actualización. La URL pública de `APP_ORIGIN` debe ser HTTPS, sin ruta ni barra final; no cambies su valor según el encabezado Host de una petición.

## Correo: Resend

1. Añade y verifica un dominio remitente en Resend usando los registros DNS que indique el servicio.
2. Crea una clave API que permita enviar desde ese dominio.
3. En las variables **de ejecución** de Coolify configura:

```dotenv
APP_ORIGIN=https://bucagest.tu-dominio.com
RESEND_API_KEY=tu-clave-de-resend
AUTH_EMAIL_FROM="BucaGest <acceso@tu-dominio.com>"
ALLOW_REGISTRATION=true
```

No pongas claves en variables `VITE_*`, archivos subidos a Git ni variables de construcción. El remitente debe pertenecer al dominio verificado. Si falta el servicio de correo, la aplicación bloquea el registro por correo y muestra que el envío no está disponible; nunca da acceso sin verificar como alternativa.

El registro pide nombre, equipo y correo; no inicia sesión. El enlace permite elegir y repetir la contraseña, confirma el correo y lleva a iniciar sesión. Los enlaces caducan a los 30 minutos, son de un solo uso y se guardan como hashes. Se requiere pulsar el formulario de confirmación: abrir el enlace o el escaneo automático de un correo no activa una cuenta. Hay límites por IP y por cuenta para los reenvíos. La recuperación cambia la contraseña, invalida enlaces anteriores y cierra las sesiones existentes.

[Documentación de envío de Resend](https://resend.com/docs/api-reference/emails/send-email).

## Google

En Google Cloud crea un cliente OAuth de tipo **Aplicación web**, configura la pantalla de consentimiento y registra esta URI de redirección exacta:

```text
https://bucagest.tu-dominio.com/api/auth/google/callback
```

Configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Coolify. Mientras la aplicación de Google esté en modo de pruebas, solo podrán acceder los usuarios de prueba autorizados allí. Publica la pantalla de consentimiento cuando esté preparada para acceso público y completa las verificaciones que solicite Google.

El flujo usa código de autorización, PKCE y nonce; valida firma, emisor, audiencia y caducidad del ID token. Un correo marcado como verificado por Google activa una cuenta nueva. Si falta esa garantía, se exige la verificación por correo de BucaGest.

[Configuración oficial de Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Apple

En Apple Developer habilita Sign in with Apple para el identificador principal, crea un **Services ID** para la web, registra el dominio y esta Return URL:

```text
https://bucagest.tu-dominio.com/api/auth/apple/callback
```

Configura `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` (contenido PEM de la clave `.p8`). La aplicación genera el secreto firmado con esa clave cuando lo necesita. Apple solo se habilita con un `APP_ORIGIN` HTTPS. No funciona usando una URL HTTP de localhost.

El callback admite `form_post` con una cookie temporal `Secure; SameSite=None`, estado de un solo uso ligado al navegador y nonce. La sesión normal sigue siendo `SameSite=Lax`. Se valida el ID token firmado por Apple. El usuario puede compartir su dirección privada de retransmisión de Apple; si vas a enviarle correos, configura también el remitente en el servicio de retransmisión de Apple. El perfil comienza como «Entrenador» y el equipo como «Mi equipo» cuando el proveedor no ofrece un nombre utilizable.

[Sign in with Apple REST API](https://developer.apple.com/documentation/signinwithapplerestapi).

## Facebook

En Meta for Developers crea una aplicación con Facebook Login para web. Registra esta URI OAuth válida:

```text
https://bucagest.tu-dominio.com/api/auth/facebook/callback
```

Configura `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` y `FACEBOOK_API_VERSION` con la versión que tenga asignada tu aplicación de Meta (formato `vNN.N`). Solicita `email` y `public_profile`. Completa los requisitos que Meta indique para publicar la aplicación: dominio, política de privacidad, eliminación de datos y revisión si corresponde. En modo desarrollo el acceso está limitado por Meta a los usuarios autorizados para probarla.

Facebook identifica al usuario, pero su perfil no ofrece la misma declaración `email_verified` de los ID tokens de Google y Apple. Por eso BucaGest envía un enlace de confirmación antes del primer acceso. Este enlace debe abrirse en el mismo navegador donde empezó el acceso social; después puede entrar con Facebook. Si no comparte un correo, se le pide utilizar el registro por correo. No se crean sesiones para usuarios pendientes.

[Flujo oficial de Facebook Login](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/).

## Comportamiento común

- Los botones aparecen solo para proveedores configurados; nunca se muestran accesos que aparenten funcionar sin credenciales.
- Las cuentas nuevas de acceso social comienzan con «Mi equipo», modificable en Configuración.
- No se fusionan cuentas automáticamente por compartir correo. Si ya hay una cuenta con esa dirección, utiliza su método original o recupera la contraseña. No hay vinculación de proveedores desde el perfil en esta versión.
- La recuperación por correo de una cuenta social **todavía no verificada** elimina la identidad social pendiente y habilita acceso por contraseña. Esto evita que una identidad adjuntada antes de probar la propiedad del correo consiga acceso después.
- `ALLOW_REGISTRATION=false` bloquea las altas nuevas por correo y proveedores. Los usuarios ya existentes pueden verificar, recuperar y entrar.
- La demo temporal sigue siendo una demo: no envía correos ni simula un proveedor real.

## Comprobación antes de darlo por publicado

Prueba con un correo propio: registro → correo recibido → abrir enlace → elegir contraseña → iniciar sesión. Comprueba recuperación, cierre de sesiones anteriores y rechazo de enlaces usados. Después prueba cada proveedor con una cuenta de prueba autorizada y revisa las URI de callback. Las pruebas automáticas usan correo y proveedores simulados: no demuestran entrega real de email ni aprobación de las aplicaciones externas.

Las credenciales de Resend, Google, Apple y Meta deben crearse en tus cuentas. Ninguna clave está incluida en el repositorio.
