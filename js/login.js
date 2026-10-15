/** login.js — Pantalla de acceso. */
(function () {
  'use strict';

  const formulario = document.getElementById('form-login');
  const campoUsuario = document.getElementById('usuario');
  const campoPassword = document.getElementById('password');
  const botonEntrar = document.getElementById('entrar');
  const botonVer = document.getElementById('ver-password');
  const caja = document.getElementById('mensaje');

  const MOTIVOS = {
    expirada: ['aviso', 'Tu sesión expiró. Inicia sesión de nuevo.'],
    requerida: ['aviso', 'Inicia sesión para continuar.'],
    cerrada: ['exito', 'Sesión cerrada correctamente.']
  };

  function mostrar(tipo, texto) {
    caja.className = 'mensaje ' + tipo;
    caja.textContent = texto;
    caja.hidden = false;
  }

  function ocultarMensaje() {
    caja.hidden = true;
    caja.textContent = '';
  }

  function ocupado(estaOcupado) {
    botonEntrar.disabled = estaOcupado;
    botonEntrar.textContent = estaOcupado ? 'Entrando…' : 'Entrar';
  }

  // Si ya hay una sesión en esta pestaña, el shell la validará con el servidor.
  if (window.Auth.leer()) {
    window.location.replace('index.html');
    return;
  }

  // Despierta el servidor mientras la persona escribe su usuario: Apps Script tarda más en la primera llamada tras un rato
  // de inactividad. No toca la hoja ni lleva datos; si falla no importa.
  window.Api.post('eco', {}).catch(function () { /* el inicio de sesión lo intentará de todos modos */ });

  const motivo = new URLSearchParams(window.location.search).get('motivo');
  if (motivo && Object.prototype.hasOwnProperty.call(MOTIVOS, motivo)) {
    mostrar(MOTIVOS[motivo][0], MOTIVOS[motivo][1]);
  }

  botonVer.addEventListener('click', function () {
    const visible = campoPassword.type === 'text';
    campoPassword.type = visible ? 'password' : 'text';
    botonVer.setAttribute('aria-pressed', String(!visible));
    botonVer.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    botonVer.firstElementChild.className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
  });

  formulario.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    ocultarMensaje();

    const usuario = campoUsuario.value.trim();
    const password = campoPassword.value;
    if (!usuario || !password) {
      mostrar('error', 'Escribe tu usuario y tu contraseña.');
      (usuario ? campoPassword : campoUsuario).focus();
      return;
    }

    ocupado(true);
    try {
      const r = await window.Auth.login(usuario, password);
      if (r.success) {
        window.location.replace('index.html');
        return;
      }
      mostrar('error', r.message);
      campoPassword.value = '';
      campoPassword.focus();
    } catch (err) {
      mostrar('error', err.message || 'No se pudo iniciar sesión. Intenta de nuevo.');
    }
    ocupado(false);
  });

  campoUsuario.focus();
})();
