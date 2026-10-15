/**
 * Config.gs — Constantes del dominio y definición del esquema de Google Sheets.
 * Fuente de verdad del esquema: docs/DATABASE.md (mantener ambos sincronizados).
 *
 * Solo constantes y literales: este archivo NO ejecuta nada que dependa de otros archivos (Apps Script evalúa los
 * archivos en el orden de la lista del proyecto, y ese orden no se controla).
 */

var API_VERSION = '1.0.0';
var NOMBRE_API = 'TRINCHERA RH API';             // lo devuelve `ping`

/* ---- Autenticación y sesión ---- */
var PROP_PEPPER = 'PEPPER';                // secreto del servidor mezclado en cada hash; se genera solo
var PREFIJO_PROP_PASSWORD = 'PWD_';        // propiedad temporal PWD_<usuario>: se hashea y se borra
var HASH_PREFIJO = 'pbkdf2-sha256';        // formato almacenado: pbkdf2-sha256$<iteraciones>$<sal>$<hash>
var PBKDF2_ITERACIONES = 100000;          // el número queda dentro de cada hash: se puede subir sin invalidar los antiguos
var PASSWORD_MIN = 8;
var PASSWORD_MAX = 128;
var MAX_INTENTOS = 5;                      // intentos fallidos antes de bloquear
var BLOQUEO_SEG = 900;                     // 15 minutos
var SESION_INACTIVIDAD_SEG = 21600;        // 6 h: máximo permitido por CacheService
var SESION_MAXIMA_SEG = 43200;             // 12 h absolutas desde el login
var SESION_REVALIDAR_SEG = 1800;           // cada 30 min se renueva y se revalida usuario activo/rol contra la hoja

/* ---- Escrituras ---- */
var IDEMPOTENCIA_TTL_SEG = 21600;          // 6 h: reintentos con el mismo requestId devuelven el mismo resultado
var ESPERA_BLOQUEO_MS = 10000;
var MOTIVO_MIN = 5;                        // caracteres mínimos del motivo en cancelaciones, descuentos, etc.
var MONTO_MAXIMO = 9999999.99;
var MAX_FILAS_CONSULTA = 5000;

/**
 * Columnas que se guardan como TEXTO PLANO (formato "@"): fechas y horas como texto evitan desfases de zona
 * horaria; folios, placas, teléfonos y códigos evitan que Sheets los convierta en números o fechas (se pierden ceros
 * iniciales). Cada hoja nueva con esas columnas se declara aquí.
 */
var COLUMNAS_TEXTO_PLANO = {
  ARCHIVOS: ['ID_ARCHIVO', 'DRIVE_ID', 'FECHA_SYNC'],
  ACCESOS: ['USUARIO', 'ID_ARCHIVO', 'FECHA']
};
var PROP_FORMATOS = 'FORMATOS_APLICADOS';  // marca que deja inicializarBase al terminar de aplicar los formatos
/**
 * SUBE este número cada vez que el esquema o los formatos cambian (hoja nueva, columna nueva, formato de texto). Mientras
 * un ADMIN no vuelva a ejecutar inicializarBase, TODA escritura responde CONFIGURACION_PENDIENTE: así nadie escribe sobre
 * una hoja que todavía no existe o sin su formato.
 */
var VERSION_FORMATOS = '2';

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';   // opcional si el script está vinculado al archivo de Sheets

var ROLES = ['ADMIN', 'USUARIO'];          // ADMIN: administra usuarios y archivos; USUARIO: descarga solo lo que se le asignó
var ESTATUS_ARCHIVO = ['ACTIVO', 'INACTIVO'];   // INACTIVO: el archivo ya no está en la carpeta de Drive (o se retiró)

/* ---- Archivos (Drive) ---- */
var MAX_ARCHIVOS_SYNC = 500;               // tope de archivos que se registran al sincronizar la carpeta
var NOMBRE_ARCHIVO_MAX = 150;
var TAMANO_MAX_MB_DEFECTO = 15;            // Apps Script devuelve el archivo dentro de la respuesta JSON (base64): solo archivos chicos

/** Usuarios iniciales. Las contraseñas NO van aquí: se leen de propiedades temporales (ver Setup.gs). */
var USUARIOS_INICIALES = [
  { usuario: 'admin', nombre: 'Administrador', rol: 'ADMIN' }
];

/** Nombre de hoja → encabezados (orden de columnas). Las hojas de datos nuevas también se agregan a HOJAS_CON_COPIA (Utils.gs). */
var ESQUEMA = {
  USUARIOS: ['ID', 'USUARIO', 'PASSWORD_HASH', 'NOMBRE', 'ROL', 'ACTIVO'],
  CONFIGURACION: ['CLAVE', 'VALOR', 'DESCRIPCION'],
  AUDITORIA: ['ID_AUDITORIA', 'FECHA_HORA', 'USUARIO', 'ACCION', 'ENTIDAD', 'ID_REGISTRO', 'DETALLE'],
  // Catálogo de archivos de la carpeta de Drive. Nunca se borra una fila: si el archivo desaparece de Drive queda INACTIVO.
  ARCHIVOS: ['ID_ARCHIVO', 'DRIVE_ID', 'NOMBRE', 'MIME', 'TAMANO_BYTES', 'CATEGORIA', 'ESTATUS', 'FECHA_SYNC'],
  // Qué archivos puede descargar cada usuario (una fila por par usuario–archivo). El ADMIN descarga todo sin filas aquí.
  // Quitar un acceso lo deja ACTIVO = FALSE (no se borra la fila): queda el historial de quién lo otorgó y cuándo.
  ACCESOS: ['USUARIO', 'ID_ARCHIVO', 'ACTIVO', 'OTORGADO_POR', 'FECHA']
};

/** Parámetros iniciales de CONFIGURACION (clave, valor, descripción). Se agregan solo las claves que falten. */
var CONFIG_INICIAL = [
  ['NOMBRE_NEGOCIO', 'Trinchera RH', 'Nombre comercial mostrado en la interfaz'],
  ['MONEDA', 'MXN', 'Moneda de operación'],
  ['ZONA_HORARIA', 'America/Mexico_City', 'Zona horaria del negocio (ajustar a la ubicación real)'],
  ['FOLIO_PREFIJO', 'TRH', 'Prefijo del folio: TRH-AAAA-000001'],
  ['SIGUIENTE_FOLIO', '1', 'Secuencia del folio; se incrementa dentro de LockService'],
  ['CARPETA_DRIVE_ID', '', 'ID de la carpeta de Drive con los archivos descargables (se fija desde el panel al sincronizar)'],
  ['TAMANO_MAX_MB', String(TAMANO_MAX_MB_DEFECTO), 'Tamaño máximo (MB) de un archivo descargable']
];
