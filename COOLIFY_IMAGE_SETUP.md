# Desplegar sin compilar en el VPS

GitHub Actions ejecuta las pruebas, compila y publica la imagen en GitHub Container Registry (GHCR). Coolify descarga esa imagen y arranca la aplicación. El VPS sigue necesitando recursos para descargar, descomprimir y ejecutar los contenedores, pero deja de ejecutar npm, TypeScript y Vite durante el despliegue.

## Preparar la primera imagen

1. Antes de subir estos archivos, desactiva **Auto Deploy** de la aplicación actual en Coolify. Así el siguiente push no iniciará otra compilación en el VPS. Cancela también los despliegues pendientes de esa aplicación.
2. Sube los cambios a la rama predeterminada del repositorio. En GitHub, abre **Actions → Preparar imagen para Coolify → Run workflow** y selecciona la rama que quieres desplegar, normalmente `master`.
3. Espera a que termine correctamente. El trabajo usa un runner de GitHub, no el VPS, y prepara imágenes para servidores Intel/AMD y ARM. Usa la cuota de Actions y almacenamiento de Packages de tu cuenta.
4. En el resumen de la ejecución encontrarás la imagen `ghcr.io/davidomej/bucagest:sha-<commit>` y su referencia exacta con `@sha256:…`. Guarda esta última para desplegar exactamente ese resultado.

El workflow se ejecuta manualmente; no llama a Coolify. No necesita secretos de producción ni un token de Coolify. La publicación usa el `GITHUB_TOKEN` de la ejecución con permiso de escritura de paquetes. Si ya existe un paquete con ese nombre, comprueba que el repositorio tiene acceso a él en su configuración de Actions. Conserva privada la imagen en GHCR.

## Permitir que Coolify descargue la imagen privada

Autentica Docker en el servidor de destino **con el usuario SSH configurado en Coolify**. Usa un token de GitHub (classic) con permiso `read:packages` y acceso al paquete. Introduce el token en la petición de contraseña, nunca como argumento del comando ni en el repositorio:

```sh
docker login ghcr.io --username davidomej
```

## Cambiar la aplicación a una imagen ya construida

1. En el mismo proyecto, entorno y servidor de Coolify, crea un recurso **Docker Image**. No selecciones Dockerfile: volvería a compilar en el VPS.
2. Pega la referencia exacta del resumen de GitHub. Si usas los campos separados, **Image Name** es `ghcr.io/davidomej/bucagest` y **SHA256 Digest** contiene los 64 caracteres después de `sha256:`; deja **Tag** vacío.
3. Pon **Ports Exposes = 3000** y conserva la comprobación de salud **GET `/api/health`** en ese puerto.
4. Copia las variables de ejecución de la aplicación actual. Conserva exactamente `DATABASE_URL`, `DATA_ENCRYPTION_KEY` y las claves de autenticación, correo y privacidad; no regeneres la clave de cifrado. La nueva aplicación debe estar conectada a la misma red privada que PostgreSQL. No se crea ni se cambia la base de datos.
5. Despliega primero sin asignar el dominio de producción al recurso nuevo. Comprueba que queda saludable. Esta fase mantiene temporalmente dos contenedores de la aplicación, por lo que también necesita margen de recursos.
6. Cuando esté saludable, retira el dominio del recurso anterior y asígnalo al nuevo; conserva `APP_ORIGIN` con el dominio público correcto y aplica los cambios. Evita dejar el mismo dominio en ambos recursos. Comprueba inicio de sesión, equipos y modo banquillo; después detén la aplicación anterior. El cambio de dominio puede causar una breve interrupción.

Conserva el recurso anterior detenido para poder volver a él si hiciera falta. No elimines PostgreSQL ni sus volúmenes. El tipo de despliegue no cambia las restricciones de acceso del modo banquillo.

## Siguientes versiones

Sube los cambios, ejecuta **Preparar imagen para Coolify**, espera a que termine, copia el nuevo digest al recurso **Docker Image** y despliega. No vuelvas a activar el despliegue automático por Git de la aplicación antigua. Para volver a una imagen anterior, selecciona su digest guardado; la base de datos no se restaura al cambiar de imagen.

Si la CPU permanece al 100 % sin ninguna compilación, hay que identificar los servicios que la ocupan y ajustar su consumo o la capacidad del VPS. Sacar esta compilación no limita los demás procesos. En **Servers → Configuration → Advanced**, establecer **Number of concurrent builds = 1** reduce además los despliegues simultáneos del resto de aplicaciones.

Documentación: [GitHub Actions con Coolify](https://coolify.io/docs/applications/sources/github/actions), [despliegue Docker Image](https://coolify.io/docs/applications/deployments/docker-image), [autenticación de GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
