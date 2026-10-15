# Trinchera RH — descarga de archivos desde Google Drive

Plataforma web para que cada persona descargue **solo los archivos que el administrador le asignó**. Los archivos no se alojan en ningún servidor: viven en una carpeta de Google Drive (propia o de otra cuenta que la comparta con la cuenta que publicó el sistema) y el sistema los entrega al vuelo, después de comprobar sesión y permiso.

Arquitectura: frontend estático (HTML/CSS/JS vanilla, Vercel) + Google Apps Script (API) + Google Sheets (usuarios, catálogo y permisos). Sin frameworks, sin servidor propio, sin SQL.

## Qué hace

| Rol | Pantallas | Puede |
| --- | --- | --- |
| **ADMIN** | Panel, Archivos, Usuarios | Sincronizar la carpeta de Drive, crear/editar/desactivar usuarios, restablecer contraseñas, elegir qué archivos baja cada usuario, ver las últimas descargas |
| **USUARIO** | Archivos | Ver y descargar únicamente lo que se le asignó |

- **Archivos**: el ADMIN pega el enlace de la carpeta de Drive y pulsa *Sincronizar*. Se registran los archivos (las subcarpetas son categorías). Si un archivo desaparece de la carpeta queda *Inactivo*, nunca se borra su registro.
- **Usuarios**: al crear un usuario el ADMIN marca los archivos que podrá descargar. Cambiar los permisos, desactivar o restablecer la contraseña surte efecto de inmediato.
- **Google Docs/Sheets/Slides** se entregan como PDF.
- **Métricas del panel**: descargas, personas que descargaron y usuarios nuevos **por día (30 días) y por mes (12 meses)**, y el ranking de **archivos más descargados**. Se calculan desde la hoja `AUDITORIA`, así que empiezan a contar desde que se publica el sistema.
- **Auditoría**: cada descarga, intento denegado, alta y cambio queda en la hoja `AUDITORIA` (nunca contraseñas).

## Límite que debes conocer

Apps Script entrega el archivo dentro de la respuesta JSON (base64), por eso hay un **tope de tamaño: 15 MB por archivo** (configurable hasta 40 en la hoja `CONFIGURACION`, clave `TAMANO_MAX_MB`). Para archivos de cientos de MB habría que agregar una función de Vercel que haga streaming desde Drive; hoy no hace falta.

## Estructura

```text
index.html, login.html     Shell con menú por rol y acceso
css/                       styles.css (tema y layout), forms.css, modulos.css (tablas, KPIs, modales), responsive.css
js/                        config (URL de la API), api, utils (UI), auth (sesión + consultas resistentes a la lentitud), login,
                           app (shell y rutas) y un archivo por pantalla: inicio (panel), archivos, usuarios
appscript/                 Backend: Code (enrutador y permisos por acción), Config (constantes y ESQUEMA), Utils, Validacion, Auth,
                           Crypto, Setup (inicialización manual), Archivos (Drive + descarga), Usuarios (altas, permisos, resumen)
tests/                     Simulador de Apps Script y de Drive, pruebas (npm test) y servidor local con datos de ejemplo (npm run local)
vercel.json                CSP y cabeceras de seguridad del hosting estático
```

Hojas de Sheets: `USUARIOS`, `CONFIGURACION`, `AUDITORIA`, `ARCHIVOS` (catálogo), `ACCESOS` (quién descarga qué).

## Probar en tu computadora (sin Google ni Vercel)

```bash
npm test          # 75 pruebas del backend, cada una con tres órdenes de carga de archivos
npm run local     # http://127.0.0.1:8080/login.html con Drive y datos simulados en memoria (incluye casi un año de historial ficticio para ver las gráficas)
```

Usuarios de prueba (solo existen en el servidor local): `admin` / `Prueba-Admin-2026`, `maria` / `Prueba-Maria-2026` (tiene 1 archivo), `pedro` / `Prueba-Pedro-2026` (ninguno).

## Puesta en marcha real (pasos del dueño)

1. **Sheets + Apps Script.** Crea un archivo de Google Sheets (con la cuenta que tiene los archivos en Drive). *Extensiones → Apps Script*: sube el contenido de `appscript/` (incluido `appsscript.json`, que declara el permiso de **lectura de Drive**), o usa `clasp` (copia `.clasp.json.example` a `.clasp.json`).
2. **Inicializar.** En el editor ejecuta `inicializarBase` y acepta los permisos (Sheets y Drive, solo lectura).
3. **Administrador.** En *Configuración del proyecto → Propiedades de la secuencia de comandos* agrega `PWD_admin` con la contraseña que quieras y ejecuta `crearUsuariosIniciales` (la propiedad se borra sola).
4. **Publicar.** *Implementar → Nueva implementación → Aplicación web*: ejecutar como **Yo**, acceso **Cualquier persona**. Copia la URL que termina en `/exec` y pégala en `js/config.js`.
5. **Hosting.** Sube la carpeta a Vercel (proyecto estático, sin build).
6. **Primer uso.** Entra como `admin`, ve a *Archivos*, pega el enlace de tu carpeta de Drive y pulsa *Sincronizar*. Luego crea usuarios en *Usuarios* y marca sus archivos.

Cada cambio posterior en `appscript/` exige publicar una nueva versión del despliegue. Si cambia el esquema, se sube `VERSION_FORMATOS` en `Config.gs` y se vuelve a ejecutar `inicializarBase` (mientras no se haga, las escrituras responden `CONFIGURACION_PENDIENTE`).

## Operación diaria

- **Subiste archivos nuevos a Drive** → *Archivos → Sincronizar*, y asígnalos en *Usuarios → Editar*.
- **Alguien olvidó su contraseña** → *Usuarios → Editar → Nueva contraseña*. Se cierran sus sesiones abiertas.
- **Alguien se va** → *Usuarios → Editar → desmarcar “Usuario activo”*.
- **La contraseña del administrador** se restablece con la propiedad `PWD_admin` y la función `restablecerPasswords`.

## Seguridad en pocas líneas

El cliente nunca manda IDs de Drive, solo IDs internos del catálogo. Cada acción valida sesión y rol en el servidor, y la descarga vuelve a leer los permisos al día. Las contraseñas se guardan con PBKDF2 + secreto del servidor; tras 5 intentos fallidos el usuario se bloquea 15 minutos. La CSP de `vercel.json` solo permite scripts propios y cdnjs.
