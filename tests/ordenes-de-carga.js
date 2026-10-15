// Órdenes de carga de archivos. Apps Script evalúa los archivos en el orden de la lista del proyecto y ese orden no se
// controla; por eso cada prueba se ejecuta con tres órdenes distintos (normal, invertido y mezclado). Si un archivo usa
// en el nivel superior algo definido en otro, alguno de los tres órdenes lo delata.
// AL AGREGAR UN ARCHIVO .gs: añádelo a TODOS y al tercer orden.
const TODOS = ['Code.gs', 'Auth.gs', 'Config.gs', 'Setup.gs', 'Utils.gs', 'Crypto.gs', 'Validacion.gs', 'Archivos.gs', 'Usuarios.gs'];
module.exports = [
  TODOS,
  TODOS.slice().reverse(),
  ['Usuarios.gs', 'Code.gs', 'Validacion.gs', 'Archivos.gs', 'Auth.gs', 'Utils.gs', 'Config.gs', 'Setup.gs', 'Crypto.gs']
];
module.exports.TODOS = TODOS;
