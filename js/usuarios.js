/**
 * usuarios.js — Pantalla #/usuarios (solo ADMIN): alta y edición de usuarios y selección de los archivos que puede descargar
 * cada uno. Un solo formulario sirve para crear y editar. Las contraseñas las teclea el administrador; el servidor las hashea y
 * nunca se muestran de vuelta.
 */
(function () {
  'use strict';

  const U = window.Utils;
  const el = U.el;

  const ETIQUETA_ROL = { ADMIN: 'Administrador', USUARIO: 'Usuario' };

  // Sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar o copiar sin confusiones.
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  function generarPassword() {
    const bytes = new Uint32Array(14);
    window.crypto.getRandomValues(bytes);
    let p = '';
    bytes.forEach(function (b) { p += ALFABETO[b % ALFABETO.length]; });
    return p;
  }

  /** Al campo de contraseña del formulario le agrega el ojo (ver lo que se escribe) y el botón de generar una segura. */
  function ayudasDePassword(modal) {
    const input = modal.dialogo.querySelector('input[name="password"]');
    if (!input) return;
    const envoltura = el('div', { clase: 'campo-clave' });
    input.replaceWith(envoltura);
    const icono = el('i', { clase: 'fa-solid fa-eye', 'aria-hidden': 'true' });
    const ojo = el('button', { type: 'button', clase: 'btn-ojo', 'aria-label': 'Mostrar contraseña', 'aria-pressed': 'false' }, [icono]);
    envoltura.append(input, ojo);
    function ver(visible) {
      input.type = visible ? 'text' : 'password';
      icono.className = 'fa-solid ' + (visible ? 'fa-eye-slash' : 'fa-eye');
      ojo.setAttribute('aria-pressed', String(visible));
      ojo.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    }
    ojo.addEventListener('click', function () { ver(input.type === 'password'); });
    const generar = el('button', { type: 'button', clase: 'boton boton-secundario boton-chico boton-generar', texto: 'Generar contraseña segura' });
    generar.addEventListener('click', function () {
      input.value = generarPassword();
      ver(true);   // se muestra para poder copiarla o dictarla
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    envoltura.after(generar);
  }

  window.Vistas = window.Vistas || {};
  window.Vistas.usuarios = function (ctx) {
    const raiz = el('div');
    const resultado = el('div');
    const aviso = el('div', { clase: 'mensaje', role: 'status', hidden: true });
    let hayDatos = false;
    let datos = { usuarios: [], archivos: [] };

    function mostrar(texto, esError) {
      aviso.textContent = texto;
      aviso.className = 'mensaje ' + (esError ? 'error' : 'exito');
      aviso.hidden = false;
    }

    /** Formulario único: `usuario` es el registro a editar, o null para crear uno nuevo. */
    function abrirFormulario(usuario) {
      const editando = !!usuario;
      const soyYo = editando && usuario.usuario === ctx.sesion.usuario;
      const asignados = {};
      if (editando) usuario.archivos.forEach(function (id) { asignados[id] = true; });
      const enRolUsuario = function (v) { return v.rol === 'USUARIO'; };

      const campos = [
        { id: 'usuario', etiqueta: 'Usuario (para iniciar sesión)', requerido: true, maxlength: 40, valor: editando ? usuario.usuario : '', soloLectura: editando,
          ayuda: editando ? null : 'Minúsculas, números, punto, guion o guion bajo. Entre 3 y 40 caracteres.' },
        { id: 'nombre', etiqueta: 'Nombre completo', requerido: true, maxlength: 60, valor: editando ? usuario.nombre : '' },
        { id: 'password', etiqueta: editando ? 'Nueva contraseña (opcional)' : 'Contraseña', tipo: 'password', requerido: !editando, maxlength: 128, autocompletar: 'new-password',
          ayuda: editando ? 'Déjala vacía para no cambiarla. Si la cambias, se cierran sus sesiones abiertas.' : 'Mínimo 8 caracteres. Díctasela a la persona por un medio seguro.' }
      ];
      if (!soyYo) {
        campos.push({ id: 'rol', etiqueta: 'Rol', tipo: 'select', valor: editando ? usuario.rol : 'USUARIO', opciones: [['USUARIO', 'Usuario (descarga lo que se le asigne)'], ['ADMIN', 'Administrador (todo)']] });
      }
      if (editando && !soyYo) {
        campos.push({ id: 'activo', etiqueta: 'Usuario activo (puede iniciar sesión)', tipo: 'casilla', valor: usuario.activo, ancho: true });
      }
      const ids = [];
      datos.archivos.forEach(function (a, i) {
        ids.push(a.idArchivo);
        campos.push({ id: 'arc_' + i, etiqueta: a.nombre + ' · ' + a.categoria, tipo: 'casilla', valor: !!asignados[a.idArchivo], visible: soyYo ? function () { return false; } : enRolUsuario });
      });

      const marcar = function (valor) {
        document.querySelectorAll('dialog.modal input[type="checkbox"][name^="arc_"]').forEach(function (c) { c.checked = valor; });
      };
      const botonTodos = el('button', { type: 'button', clase: 'boton boton-secundario boton-chico', texto: 'Marcar todos' });
      const botonNinguno = el('button', { type: 'button', clase: 'boton boton-secundario boton-chico', texto: 'Quitar todos' });
      botonTodos.addEventListener('click', function () { marcar(true); });
      botonNinguno.addEventListener('click', function () { marcar(false); });
      const intro = el('div', {}, [
        soyYo ? el('p', { clase: 'nota-chica', texto: 'Eres administrador: descargas todos los archivos y no puedes cambiarte el rol ni desactivarte.' }) : null,
        !soyYo && datos.archivos.length
          ? el('div', {}, [el('p', { texto: 'Archivos que podrá descargar (solo aplica al rol Usuario):' }), el('div', { clase: 'lista-marcar' }, [botonTodos, botonNinguno])])
          : null,
        !soyYo && !datos.archivos.length ? el('p', { clase: 'nota-chica', texto: 'Aún no hay archivos activos. Sincroniza la carpeta de Drive en la pantalla Archivos y luego asígnalos aquí.' }) : null
      ]);

      const modal = U.formularioModal({
        titulo: editando ? 'Editar ' + usuario.usuario : 'Nuevo usuario',
        ancha: true,
        intro: intro,
        campos: campos,
        textoEnviar: editando ? 'Guardar cambios' : 'Crear usuario',
        validar: function (v) {
          const e = {};
          if (!editando && !/^[a-z0-9._-]{3,40}$/.test((v.usuario || '').toLowerCase())) e.usuario = 'Usa de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.';
          if (!v.nombre) e.nombre = 'El nombre es obligatorio.';
          if ((!editando || v.password) && (v.password || '').length < 8) e.password = 'La contraseña debe tener al menos 8 caracteres.';
          return e;
        },
        enviar: function (v, requestId) {
          const payload = { usuario: (v.usuario || '').toLowerCase(), nombre: v.nombre };
          if (v.password) payload.password = v.password;
          if (v.rol !== undefined) payload.rol = v.rol;
          if (v.activo !== undefined) payload.activo = v.activo;
          if (v.rol === 'USUARIO') payload.archivos = ids.filter(function (id, i) { return v['arc_' + i] === true; });
          return window.Auth.llamar(editando ? 'editarUsuario' : 'crearUsuario', payload, requestId);
        },
        alExito: function (r) {
          mostrar(editando ? (r.data.cambios && r.data.cambios.length ? 'Usuario actualizado: ' + r.data.cambios.join(', ') + '.' : 'No había cambios que guardar.') : r.message, false);
          cargar(true);
        }
      });
      ayudasDePassword(modal);
    }

    function pintar() {
      const tabla = U.tabla({
        columnas: [
          { clave: 'usuario', titulo: 'Usuario' },
          { clave: 'nombre', titulo: 'Nombre', ajustable: true },
          { clave: 'rol', titulo: 'Rol', render: function (u) { return U.chip(ETIQUETA_ROL[u.rol] || u.rol, 'rol-' + u.rol); } },
          { clave: 'activo', titulo: 'Estado', orden: function (u) { return u.activo ? 0 : 1; }, render: function (u) { return U.chipEstatus(u.activo ? 'ACTIVO' : 'INACTIVO'); } },
          { clave: 'archivos', titulo: 'Archivos', tipo: 'numero', orden: function (u) { return u.rol === 'ADMIN' ? 1e9 : u.archivos.length; },
            render: function (u) { return u.rol === 'ADMIN' ? 'Todos' : String(u.archivos.length) + ' de ' + datos.archivos.length; } },
          { clave: 'acc', titulo: '', ordenable: false, fija: true, render: function (u) {
            const b = el('button', { type: 'button', clase: 'boton boton-secundario boton-chico', texto: 'Editar' });
            b.addEventListener('click', function () { abrirFormulario(u); });
            return b;
          } }
        ],
        filas: datos.usuarios, vacio: 'Todavía no hay usuarios.',
        claseFila: function (u) { return u.activo ? '' : 'fila-inactiva'; }
      });
      const nuevo = el('button', { type: 'button', clase: 'boton', texto: 'Nuevo usuario' });
      nuevo.addEventListener('click', function () { abrirFormulario(null); });
      U.llenar(resultado, el('section', { clase: 'tarjeta' }, [
        el('div', { clase: 'encabezado-detalle' }, [el('p', { clase: 'nota-chica', texto: datos.usuarios.length + ' usuario(s)' }), nuevo]),
        tabla.nodo
      ]));
    }

    function cargar(fresco) {
      if (!hayDatos) resultado.replaceChildren(U.bloqueEstado('Usuarios', 'Consultando…', false));
      window.Auth.consultar('usuarios', {}, function (r) {
        if (!r.success) { hayDatos = false; resultado.replaceChildren(U.bloqueEstado('No se pudo cargar', r.message, true, function () { cargar(true); })); return; }
        hayDatos = true;
        datos = r.data;
        pintar();
      }, { fresco: fresco === true, vivo: function () { return raiz.isConnected; } }).catch(function (err) {
        if (!hayDatos) resultado.replaceChildren(U.bloqueEstado('No se pudo cargar', err.message || 'Error de conexión.', true, function () { cargar(true); }));
      });
    }

    raiz.append(aviso, resultado);
    cargar(false);
    return raiz;
  };
})();
