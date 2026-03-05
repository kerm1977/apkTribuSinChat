/**
 * chat.js - Lógica para el Enjambre de Chat Privado (1 a 1)
 */

// 1. SOLUCIÓN CRÍTICA: Apuntamos al dominio correcto dinámicamente.
// Ya no usamos 'alatir' fijo. Usamos la API_URL que configuró tu asistente Node.js.
const BASE_API = typeof API_URL !== 'undefined' ? API_URL : "https://kenth1977.pythonanywhere.com/api/Geeko";

// Función de ayuda para obtener el PIN del usuario actual desde localStorage
function obtenerMiPin() {
    let pin = localStorage.getItem('tribu_pin');
    if (!pin) {
        try {
            const u = JSON.parse(localStorage.getItem('usuarioActual'));
            pin = u ? u.pin : null;
        } catch(e) {}
    }
    return pin;
}

function obtenerMiNombre() {
    let nombre = localStorage.getItem('tribu_nombre');
    if (!nombre) {
        try {
            const u = JSON.parse(localStorage.getItem('usuarioActual'));
            nombre = u ? u.nombre : 'Usuario';
        } catch(e) {}
    }
    return nombre || 'Usuario';
}

window.ChatManager = {
    chatActivoPin: null,   // Guarda el PIN de la persona con la que estamos hablando
    chatActivoNombre: null,
    mensajesCacheados: [], // Guarda la conversación actual para poder Exportarla a TXT

    // 1. OBTENER LISTA DE CONTACTOS
    async obtenerContactos() {
        const miPin = obtenerMiPin();
        if (!miPin) return [];
        try {
            const res = await fetch(`${BASE_API}/contactos/${miPin}`);
            const data = await res.json();
            return data.contactos || [];
        } catch (e) { return []; }
    },

    // 2. OBTENER MENSAJES DE UN CHAT PRIVADO
    async obtenerMensajesPrivados() {
        const miPin = obtenerMiPin();
        if (!miPin || !this.chatActivoPin) return [];
        try {
            const res = await fetch(`${BASE_API}/chat/${miPin}/${this.chatActivoPin}`);
            const mensajes = await res.json();
            this.mensajesCacheados = mensajes; // Lo guardamos para el TXT
            return mensajes;
        } catch (e) { return []; }
    },

    // 3. ENVIAR MENSAJE
    async enviarMensaje(texto, archivo = null) {
        const miNombre = obtenerMiNombre();
        const miPin = obtenerMiPin();

        if (!miPin || !this.chatActivoPin) return { error: "No hay chat activo" };

        const formData = new FormData();
        formData.append('nombre', miNombre);
        formData.append('sender_pin', miPin);
        formData.append('receiver_pin', this.chatActivoPin); // A quién va dirigido
        formData.append('texto', texto);
        if (archivo) formData.append('file', archivo);

        try {
            const res = await fetch(`${BASE_API}/chat/enviar`, {
                method: 'POST',
                body: formData // Fetch detecta FormData y pone los headers correctos solo
            });
            return await res.json();
        } catch (e) { 
            console.error("Error en envío:", e);
            return { error: "Fallo de conexión" }; 
        }
    },

    // 4. VERIFICAR NOTIFICACIONES (Punto Rojo)
    async verificarPuntoRojo() {
        const miPin = obtenerMiPin();
        if (!miPin) return false;
        try {
            const res = await fetch(`${BASE_API}/chat/unread/${miPin}`);
            const data = await res.json();
            return data.total_unread > 0;
        } catch (e) { return false; }
    },

    // 5. BORRAR UN MENSAJE
    async borrarMensaje(msgId) {
        try {
            const res = await fetch(`${BASE_API}/chat/mensaje/${msgId}`, { method: 'DELETE' });
            return await res.json();
        } catch (e) { return { error: "Error borrando" }; }
    },

    // 6. VACIAR CHAT COMPLETO
    async limpiarChatCompleto() {
        const miPin = obtenerMiPin();
        if (!miPin || !this.chatActivoPin) return;
        try {
            await fetch(`${BASE_API}/chat/limpiar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mi_pin: miPin, otro_pin: this.chatActivoPin })
            });
        } catch (e) { console.error("Error limpiando chat", e); }
    },

    // 7. PINTAR LA LISTA DE CONTACTOS EN EL HTML
    renderizarContactos(contactos) {
        const container = document.getElementById('chat-contacts');
        if (!container) return;

        let html = '';
        contactos.forEach(c => {
            const inicial = c.nombre ? c.nombre.charAt(0).toUpperCase() : '?';
            const badge = c.no_leidos > 0 
                ? `<span class="badge bg-danger rounded-pill shadow-sm ms-2">${c.no_leidos}</span>` 
                : '';

            // NUEVO: Punto verde si is_online viene en true desde la Base de Datos
            const isOnlineStatus = c.is_online
                ? `<span class="position-absolute bottom-0 end-0 p-1 bg-success border border-white rounded-circle" style="width: 14px; height: 14px; box-shadow: 0 0 5px rgba(25, 135, 84, 0.5);" title="En línea"></span>`
                : `<span class="position-absolute bottom-0 end-0 p-1 bg-secondary border border-white rounded-circle" style="width: 14px; height: 14px; opacity: 0.5;" title="Desconectado"></span>`;

            // Se agregó class 'contacto-item' y 'data-name' para hacer funcionar el Buscador
            html += `
            <div class="list-group-item d-flex align-items-center p-3 border-0 border-bottom contacto-item" data-name="${(c.nombre || '').toLowerCase()}" style="cursor:pointer; transition: background 0.2s;" onclick="window.abrirChatPrivado('${c.pin}', '${c.nombre.replace(/'/g, "\\'")}')" onmouseover="this.style.backgroundColor='#f8f9fa'" onmouseout="this.style.backgroundColor='transparent'">
                
                <div class="position-relative">
                    <div class="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold shadow-sm" style="width: 48px; height: 48px; font-size: 1.3rem;">
                        ${inicial}
                    </div>
                    ${isOnlineStatus}
                </div>

                <div class="ms-3 flex-grow-1">
                    <p class="mb-0 fw-bold text-dark d-flex align-items-center">${c.nombre} ${badge}</p>
                    <p class="mb-0 text-muted small">PIN: ***${c.pin ? c.pin.slice(-3) : '---'} | ${c.is_online ? '<span class="text-success fw-medium">En línea</span>' : 'Desconectado'}</p>
                </div>
                
            </div>`;
        });
        
        container.innerHTML = html || '<p class="text-center text-muted p-5">No hay compañeros registrados aún.</p>';
    },

    // 8. PINTAR LOS MENSAJES (ANTI-PARPADEO, DOBLE CHECK, BOTÓN BORRAR)
    renderizarMensajes(mensajes, containerId) {
        const container = document.getElementById(containerId);
        if (!container || !Array.isArray(mensajes)) return;

        const miPin = obtenerMiPin();
        let html = '';

        mensajes.forEach(m => {
            const esMio = (m.sender_pin === miPin);
            
            let readIcon = '';
            let btnBorrar = '';

            if (esMio) {
                // Doble check azul o gris
                readIcon = m.is_read 
                    ? '<i class="bi bi-check2-all text-info ms-1" style="font-size:1.1rem;"></i>' 
                    : '<i class="bi bi-check2 text-secondary ms-1" style="font-size:1.1rem;"></i>'; 
                
                // Botón individual de borrado
                btnBorrar = `<i class="bi bi-trash-fill text-white-50 ms-2" style="cursor:pointer;" onclick="window.eliminarMensaje(${m.id})" title="Borrar para todos"></i>`;
            }

            let adjuntoHtml = '';
            if (m.file_path) {
                const fullUrl = `https://kenth1977.pythonanywhere.com${m.file_path}`;
                if (m.file_type === 'image') {
                    adjuntoHtml = `<img src="${fullUrl}" class="img-fluid rounded-3 mb-2 shadow-sm" style="max-height: 200px; cursor: pointer;" onclick="window.open(this.src)">`;
                } else if (m.file_type === 'audio') {
                    adjuntoHtml = `<audio controls class="w-100 mb-2" style="height: 35px;"><source src="${fullUrl}"></audio>`;
                } else {
                    adjuntoHtml = `<a href="${fullUrl}" target="_blank" class="btn btn-sm btn-light border w-100 mb-2 text-start"><i class="bi bi-file-earmark-text"></i> Ver Documento</a>`;
                }
            }

            html += `
                <div class="d-flex flex-column ${esMio ? 'align-items-end' : 'align-items-start'} mb-3">
                    <div class="p-3 rounded-4 shadow-sm position-relative" style="max-width: 85%; min-width: 120px; ${esMio ? 'background-color: #0d6efd; color: white;' : 'background-color: white; border: 1px solid #dee2e6; color: #212529;'}">
                        ${adjuntoHtml}
                        <p class="mb-0 text-break" style="font-size: 0.95rem; line-height: 1.3;">${m.texto || ''}</p>
                        
                        <div class="text-end mt-1 d-flex align-items-center justify-content-end" style="margin-bottom: -5px;">
                            <small class="${esMio ? 'text-white-50' : 'text-muted'}" style="font-size: 0.65rem;">${m.fecha || ''}</small>
                            ${readIcon}
                            ${btnBorrar}
                        </div>
                    </div>
                </div>`;
        });

        const newContent = html || '<div class="text-center text-muted py-5"><i class="bi bi-chat-dots fs-1 d-block mb-2"></i>Inicia la conversación.</div>';

        // --- SISTEMA ANTI-PARPADEO ---
        if (container.dataset.lastContent !== newContent) {
            const estabaAlFinal = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
            
            container.innerHTML = newContent;
            container.dataset.lastContent = newContent; 
            
            if (estabaAlFinal) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }
};

// ============================================================================
// FUNCIONES DE NAVEGACIÓN DENTRO DEL MODAL (Llamadas desde HTML)
// ============================================================================

window.abrirChatPrivado = function(pin, nombre) {
    window.ChatManager.chatActivoPin = pin;
    window.ChatManager.chatActivoNombre = nombre;
    
    const titleEl = document.getElementById('chat-title');
    if(titleEl) titleEl.innerText = nombre;
    
    document.getElementById('vista-contactos').classList.add('d-none');
    document.getElementById('vista-chat').classList.remove('d-none');
    document.getElementById('vista-chat').classList.add('d-flex');
    document.getElementById('btn-chat-volver').classList.remove('d-none');
    
    // Mostramos el menú de los 3 puntos
    const btnOpts = document.getElementById('chat-options-btn');
    if(btnOpts) btnOpts.classList.remove('d-none');

    const chatWin = document.getElementById('chat-window');
    if(chatWin) {
        chatWin.innerHTML = '';
        chatWin.dataset.lastContent = '';
    }
    
    if (window.refrescarChat) window.refrescarChat();
};

window.volverAContactos = function() {
    window.ChatManager.chatActivoPin = null;
    
    const titleEl = document.getElementById('chat-title');
    if(titleEl) titleEl.innerText = 'Mensajes';
    
    document.getElementById('vista-chat').classList.add('d-none');
    document.getElementById('vista-chat').classList.remove('d-flex');
    document.getElementById('vista-contactos').classList.remove('d-none');
    document.getElementById('btn-chat-volver').classList.add('d-none');

    // Ocultamos el menú de los 3 puntos
    const btnOpts = document.getElementById('chat-options-btn');
    if(btnOpts) btnOpts.classList.add('d-none');
    
    if (window.refrescarChat) window.refrescarChat();
};

// ============================================================================
// NUEVAS UTILIDADES GLOBALES (Buscador, Notificaciones, Exportar, Eliminar)
// ============================================================================

window.filtrarBuscador = function() {
    const filtro = document.getElementById('buscador-input');
    if (!filtro) return;
    const texto = filtro.value.toLowerCase();
    
    const items = document.querySelectorAll('.contacto-item');
    items.forEach(item => {
        const nombre = item.getAttribute('data-name') || '';
        item.style.setProperty('display', nombre.includes(texto) ? 'flex' : 'none', 'important');
    });
};

window.eliminarMensaje = async function(id) {
    if (confirm("¿Eliminar este mensaje para todos?")) {
        await window.ChatManager.borrarMensaje(id);
        if (window.refrescarChat) window.refrescarChat();
    }
};

window.limpiarChat = async function() {
    if (confirm("¿Estás seguro de que quieres eliminar TODA la conversación con este usuario? (Esta acción no se puede deshacer)")) {
        await window.ChatManager.limpiarChatCompleto();
        if (window.refrescarChat) window.refrescarChat();
    }
};

window.exportarTXT = function() {
    if (!window.ChatManager || !window.ChatManager.mensajesCacheados.length) {
        alert("No hay mensajes para exportar."); 
        return;
    }
    
    let textData = `=== CHAT CON ${window.ChatManager.chatActivoNombre} ===\n\n`;
    window.ChatManager.mensajesCacheados.forEach(m => {
        // Usamos fecha_larga si existe, si no caemos en la corta
        textData += `[${m.fecha_larga || m.fecha}] ${m.nombre}:\n`;
        if(m.texto) textData += `${m.texto}\n`;
        if(m.file_path) textData += `<Archivo Adjunto: ${m.file_type}>\n`;
        textData += `----------------------------\n`;
    });
    
    const blob = new Blob([textData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Chat_${window.ChatManager.chatActivoNombre}_${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
};

window.revisarNotificacionesGlobales = async function() {
    const miPin = obtenerMiPin();
    
    // 1. NUEVO: Enviar un Latido Silencioso (Ping) para mantenernos 'En Línea' en la BD
    if (miPin) {
        fetch(`${BASE_API}/ping/${miPin}`).catch(() => {});
    }

    const btnFlotante = document.getElementById('btn-chat-flotante');
    // Revisamos notificaciones solo si el botón existe y está visible
    if (window.ChatManager && btnFlotante && !btnFlotante.classList.contains('hidden-forced')) {
        const hayNuevos = await window.ChatManager.verificarPuntoRojo();
        const badge = document.getElementById('chat-badge');
        if (badge) {
            if (hayNuevos) badge.classList.remove('d-none');
            else badge.classList.add('d-none');
        }
    }
};

// Iniciamos el ciclo que pregunta por nuevos mensajes cada 6 segundos automáticamente
setInterval(window.revisarNotificacionesGlobales, 6000);