# Protección de datos y despliegue de BucaGest

Estado: controles técnicos implementados; configuración del servidor y documentación legal pendientes de completar. No es una certificación de cumplimiento ni una garantía de riesgo cero. Contexto facilitado: prestador persona física, VPS en Alemania, sin copias de seguridad configuradas y jugadores adultos en esta versión.

## Antes de redesplegar

Esta versión **no arranca en producción** sin `DATA_ENCRYPTION_KEY` y los siete campos `PRIVACY_*` del ejemplo. Evita publicar un aviso sin identificar a quien ofrece el servicio. El control comprueba que existen los campos, no que sus declaraciones sean ciertas ni jurídicamente suficientes.

1. Cierra temporalmente nuevos registros si aún faltan contratos o información: `ALLOW_REGISTRATION=false`. Mantén esa decisión también durante las pruebas de restauración.
2. Haz una copia protegida de PostgreSQL y prueba recuperarla en una base aislada antes de cambiar el almacenamiento. No pruebes migraciones en la única copia de tus datos.
3. Genera **una sola vez** una clave aleatoria de 32 bytes, por ejemplo con `openssl rand -hex 32` en una terminal privada. Guarda el resultado como secreto de ejecución `DATA_ENCRYPTION_KEY` en Coolify y una copia en un gestor de contraseñas separado del VPS. No envíes la clave por chat, no la subas a Git, no uses `VITE_*` y no la incluyas en la imagen.
4. Completa estas variables con datos reales; los textos se muestran públicamente en `/privacy`:

   | Variable | Contenido |
   | --- | --- |
   | `PRIVACY_OPERATOR` | Tu nombre y apellidos completos o la razón social que realmente presta el servicio. DSoft puede acompañarlos como marca. |
   | `PRIVACY_ADDRESS` | Domicilio de contacto legal del prestador. |
   | `PRIVACY_EMAIL` | Correo atendido para privacidad y derechos. |
   | `PRIVACY_HOSTING` | Empresa del VPS, alojamiento en Alemania y empresa/región del almacenamiento de copias. |
   | `PRIVACY_PROVIDERS` | Proveedores que efectivamente reciben datos: hosting, copias, correo y accesos sociales habilitados; finalidad y categorías de datos. |
   | `PRIVACY_TRANSFERS` | Ubicaciones y garantías aplicables cuando haya acceso o transferencia fuera del EEE, con referencia a las condiciones y forma de obtener copia de las garantías. No declares que todo permanece en Alemania sin comprobar los otros proveedores. |
   | `PRIVACY_RETENTION` | Plazos reales por categoría, criterio de revisión del historial, copias y registros; tratamiento de bajas y posibles obligaciones de conservación/bloqueo. |

5. Mantén `APP_ORIGIN=https://...`, `NODE_ENV=production`, `DEMO_MODE=false`. Configura correo y acceso según [AUTH_SETUP.md](AUTH_SETUP.md). Verifica los textos legales antes de abrir registros.
6. Para esta primera migración, detén la instancia antigua y despliega una única instancia. El arranque convierte de forma transaccional los espacios e imágenes existentes a AES-256-GCM; un error provoca rollback. No mantengas ejecutándose una versión antigua que escriba JSON sin cifrar ni vuelvas al código anterior sobre la base cifrada. Un rollback de la aplicación anterior exige recuperar también su copia compatible, teniendo en cuenta los cambios posteriores.
7. Comprueba login, una plantilla, una foto, exportación y sustituciones con una cuenta de prueba. Verifica que `/privacy` identifica al prestador y que el servidor no imprime datos personales o secretos.

## Qué está protegido y sus límites

- Espacios completos de cada cuenta —plantillas, ligas, partidos, minutos y cobros— e imágenes cifrados en PostgreSQL con AES-256-GCM, nonce aleatorio y contexto de cuenta/imagen autenticado. Las altas por correo y acceso social usan el mismo cifrado. La clave incorrecta, ausente sobre datos cifrados o los datos alterados impiden el arranque/lectura; no se oculta el error con datos vacíos.
- El nombre y correo de la **cuenta de acceso** y la asociación con proveedores permanecen en las tablas de autenticación para poder identificarla. Las contraseñas se guardan con scrypt y sal; los tokens de sesión y correo mediante hash. El cifrado de los espacios no sustituye el del disco, los volcados, las copias de Coolify o sus secretos.
- El servidor necesita la clave para atender solicitudes. Un atacante con control de la aplicación, del VPS o del panel puede acceder a datos descifrados. No es cifrado de extremo a extremo. La clave perdida vuelve los datos cifrados irrecuperables. Cambiarla arbitrariamente impide el arranque; una rotación exige una migración planificada de descifrado y recifrado y conservar las claves de las copias que deban recuperarse.
- No se puede garantizar el borrado físico inmediato de bloques antiguos de PostgreSQL, WAL, snapshots o backups. Una migración cifra los registros activos; los restos y copias anteriores deben protegerse y caducar según su política.
- Acceso por cuenta con correo verificado, consultas de datos e imágenes limitadas a su propietario, cookies HttpOnly/Secure en producción y controles de origen. Los endpoints sensibles limitan intentos y vuelven a pedir contraseña.
- Las respuestas privadas e imágenes usan `Cache-Control: no-store`; logout solicita además limpiar la caché del navegador. El soporte del navegador varía. No se registran herramientas automáticas del navegador que devuelvan nombres y estadísticas a asistentes externos. Esto no impide capturas de pantalla o exportaciones autorizadas.
- Una sesión de gestión puede ver todos los equipos de su cuenta. Antes de entregar la tablet, usa **Privacidad → Activar modo banquillo** después de iniciar el partido. La sesión de gestión de ese navegador se revoca y se reemplaza por una sesión de cuatro horas limitada en el servidor a la plantilla mínima y las sustituciones del partido elegido. No accede a cobros, cumpleaños, fotos, historial de otras jornadas o equipos, exportaciones ni borrados; tampoco modifica el reloj o marcador. La gestión continúa en otro dispositivo y «Cerrar todas las sesiones» revoca también el banquillo. Para salir de este modo se necesita iniciar sesión de nuevo. Utiliza un perfil de navegador dedicado, sin contraseñas guardadas ni sesiones abiertas en Google/Apple/Facebook: el bloqueo de la app no protege cuentas que el propio navegador ya permita usar. Sigue siendo un terminal compartido: cualquiera con acceso físico puede ver los nombres/dorsales y registrar cambios, por lo que no acredita qué jugador pulsó. No hay roles de gestores múltiples ni permisos individuales por jugador.
- La versión está destinada a adultos. Se informa en registro y fichas, y se rechazan fechas de nacimiento de menores en nuevas altas/ediciones. Una fecha opcional no verifica documentalmente la edad y no se borran automáticamente registros preexistentes. No es autorización para tratar datos de menores.

## Herramientas de derechos

En el menú **Privacidad**, además del modo banquillo:

- Descargar cuenta: JSON con identidad de cuenta, equipos, cobros, partidos e imágenes en base64; excluye hashes, contraseñas y tokens.
- Descargar jugador: ficha, sus cobros, participación y foto; excluye las fichas y pagos de compañeros y sus identificadores en eventos. Revisa siempre el contenido y la identidad del destinatario antes de entregarlo.
- Eliminar jugador: requiere contraseña y escribir `ELIMINAR`. Borra ficha, cobros, intervalos, alineaciones y eventos relacionados del equipo seleccionado; elimina la imagen si ningún otro equipo/jugador de esa cuenta la utiliza. Los resultados agregados de los partidos se conservan; no se presentan como anonimización garantizada. Otros equipos con el mismo jugador deben revisarse por separado. Se bloquea durante un partido activo.
- Eliminar cuenta: contraseña y `ELIMINAR MI CUENTA`. Borra cuenta, espacios, imágenes, sesiones, enlaces e identidades asociadas mediante cascada en PostgreSQL. No borra copias externas ni registros del proveedor de correo. Resuelve antes las obligaciones de conservación/bloqueo; la app no contiene un archivo jurídico bloqueado.
- Cerrar todas las sesiones: invalida también otros dispositivos. Las cuentas sociales pueden establecer una contraseña por recuperación de correo, sin perder su acceso social.

Las fichas se rectifican desde Plantilla. Archivar conserva datos y **no es supresión**. Estas herramientas ayudan al gestor; no sustituyen un canal para oposición, limitación, rectificación de historiales u otros casos que requieran intervención. Documenta cada solicitud, la comprobación proporcionada de identidad, decisión y respuesta. El plazo general de respuesta es un mes, con las prórrogas legalmente aplicables. No recopiles DNI por defecto.

## Conservación técnica

Al arrancar y cada hora se limpian sesiones caducadas, solicitudes OAuth caducadas y tokens de correo caducados hace más de un día. Se eliminan altas pendientes de más de siete días **solo si nunca verificaron su correo y no tienen contraseña**; las cuentas antiguas con contraseña no se borran por la migración a correo verificado. Se eliminan imágenes subidas hace más de un día sin referencias. Las fotos sustituidas o quitadas se borran al guardar cuando pierden su última referencia.

No se borran automáticamente cuentas verificadas ni temporadas: el responsable debe fijar y aplicar plazos justificados. Revisa por temporada datos de bajas, fotos, cumpleaños y pagos. Evita retención indefinida por comodidad. La política publicada debe distinguir base activa, archivos bloqueados cuando procedan, backups, correo y logs del VPS.

## VPS y copias: pendientes de configurar

El código no configura tu servidor y no se han creado copias reales. Acordar frecuencia y recuperación es parte del análisis de riesgos. Para esta primera instalación se propone una copia diaria, retención de 30 días y recuperación probada; son una propuesta operativa, **no plazos impuestos por el RGPD**. Un respaldo diario puede perder hasta un día de cambios; si necesitas menos pérdida, aumenta frecuencia o estudia recuperación continua.

En PostgreSQL dentro de Coolify, abre **Backups → Scheduled Backups → Add**, elige frecuencia y ejecuta **Backup Now**. Usa también un destino S3 privado independiente del VPS; configura y comprueba por separado la retención local y remota. Una copia en el mismo servidor no protege frente a su pérdida. Coolify puede subir el volcado, pero hay que verificar el cifrado del destino y la protección del archivo local; no se debe deducir del uso de S3 que el volcado está cifrado. Fuente: [copias de bases de datos en Coolify](https://coolify.io/docs/databases/backups).

Protege el volumen del VPS y los archivos de copia con cifrado, permisos restrictivos y acceso mínimo. Usa un almacenamiento europeo con contrato, bucket privado, bloqueo de acceso público y cifrado configurado. Para cifrado antes de la subida, usa una solución de backups que lo soporte y valida su integración; esta app no la ha instalado. Guarda `DATA_ENCRYPTION_KEY` por separado y protege también la configuración y claves de Coolify. Activa autenticación reforzada en hosting, repositorio y panel, acceso SSH con claves, firewall, actualizaciones y alertas de fallos.

No publiques el puerto PostgreSQL en Internet. Usa una red privada restringida; si la conexión cruza servidores o redes no confiables, TLS con validación del certificado. No desactives la validación mediante `no-verify` o `rejectUnauthorized:false`. Usa credenciales específicas para esta base y restringe el resto de bases/servicios.

Prueba una restauración en una base aislada, con la clave correcta, el correo deshabilitado y registros cerrados. Comprueba fichas, fotos y estadísticas. Antes de abrir una restauración al público, reaplica las supresiones/limitaciones posteriores a la copia; mantén un registro restringido con los identificadores y fechas mínimos necesarios para hacerlo y su propia caducidad. Nunca recuperes backups sobre producción para “probar”. Documenta fecha, resultado, tiempo de recuperación y siguiente prueba.

Configura retención mínima necesaria de logs del proxy y del VPS. No guardes cuerpos de formularios, contraseñas, cabeceras Cookie/Authorization o enlaces de acceso. No envíes volcados reales a soporte o repositorios. Conserva evidencia de incidencias con acceso restringido.

## Responsabilidades y documentación

El responsable normalmente será el club, asociación o persona que decide la gestión de sus jugadores; un entrenador empleado que solo ejecuta sus instrucciones no se convierte automáticamente en responsable. Si tú alojas y tratas sus datos, normalmente eres encargado para ese servicio y responsable para la gestión de tus cuentas/seguridad. Ser persona física o usar una marca no elimina esas obligaciones. El rol depende de la realidad del tratamiento, no de una cláusula que atribuya toda responsabilidad a otro. [Criterio de la AEPD sobre roles](https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/8-responsable-y-encargado-del-tratamiento/FAQ-0251-como-se-si-soy-responsable-o-encargado), [obligaciones propias del encargado](https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/8-responsable-y-encargado-del-tratamiento/FAQ-0236-que-obligaciones-especificas-contiene-el-rgpd-para-los-encargados-de-tratamiento).

Completa y revisa con un profesional el [borrador de encargo](legal/ENCARGO_TRATAMIENTO.md), el inventario de tratamientos, la evaluación de riesgos, la política publicada y las condiciones del servicio/aviso legal. Deben coincidir con la operativa. No hay un contrato firmado por el mero hecho de desplegar; acuerda con cada responsable las instrucciones, anexos y versión y guarda evidencia de la firma/aceptación antes de cargar sus jugadores. No se exige un consentimiento genérico para todo: cada finalidad necesita su base adecuada y la información correspondiente. La gestión de cuentas puede apoyarse en la prestación del servicio; fotos, comunicaciones ajenas a la gestión u otros usos requieren análisis separado.

Con el correo actualmente implementado, **Resend no implica almacenamiento exclusivamente europeo**: su DPA declara operaciones principales en Estados Unidos. Revisa contrato, subencargados, garantías de transferencias y retención antes de habilitarlo y refléjalo en el aviso. Los accesos sociales también deben revisarse; si no están configurados, no se muestran ni cargan sus SDK. [DPA de Resend](https://resend.com/legal/dpa).

Antes de incluir menores: adaptar contratos e información a familias y edades; revisar legitimación y representación; minimizar fotos/cumpleaños; valorar riesgos y si procede una evaluación de impacto; disponer de permisos por rol y procedimientos de derechos. El umbral español de consentimiento en protección de datos no autoriza por sí solo todos los contratos o usos de imágenes. [AEPD sobre datos de menores](https://www.aepd.es/preguntas-frecuentes/10-menores-y-educacion/FAQ-1002-se-puede-recabar-y-tratar-datos-personales-de-menores).

## Si ocurre un incidente

Contén el acceso, conserva evidencias sin divulgar datos, identifica el alcance y revoca sesiones/secretos afectados. Como encargado, comunica al responsable sin dilación indebida y coopera. El responsable evalúa la notificación a la autoridad competente, normalmente dentro de 72 horas desde que tiene constancia cuando proceda, y la comunicación a afectados si hay alto riesgo. Documenta también la decisión de no notificar. [AEPD: brechas de datos](https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/brechas-de-datos-personales-notificacion).

Marco: [RGPD](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807), [LOPDGDD](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673), [seguridad basada en riesgos, AEPD](https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/seguridad-de-los-tratamientos). La revisión de la aplicación y sus pruebas no sustituye la comprobación de la infraestructura, una revisión independiente de seguridad ni el asesoramiento jurídico adaptado al servicio.
