/**
 * chat.js - Lógica para el Enjambre de Chat Privado y Grupal (Basado en Email)
 * COMPLETADO Y CORREGIDO: Motor de Renderizado, envío multimedia real, emojis y dropups.
 */

// 1. SOLUCIÓN CRÍTICA: Usamos 'var' en lugar de 'const' para evitar errores de 
// "Identifier already declared" si la SPA recarga este script dinámicamente.
var BASE_API = typeof API_URL !== 'undefined' ? API_URL : "https://kenth1977.pythonanywhere.com/api/Geeko";

// Función de ayuda para obtener el CORREO del usuario actual desde localStorage
function obtenerMiCorreo() {
    try {
        const u = JSON.parse(localStorage.getItem('usuarioActual'));
        return u ? u.email : null; 
    } catch(e) {
        return null;
    }
}

function obtenerMiNombre() {
    try {
        const u = JSON.parse(localStorage.getItem('usuarioActual'));
        return u ? u.nombre : 'Usuario';
    } catch(e) {
        return 'Usuario';
    }
}

window.ChatManager = {
    chatActivoCorreo: null,   
    chatActivoNombre: null,
    mensajesCacheados: [], 
    intervaloChatActivo: null, 

    // ==========================================
    // ALMACENAMIENTO LOCAL (Invisibilidad, Fijados y Grupos)
    // ==========================================
    obtenerBloqueados() {
        try { return JSON.parse(localStorage.getItem(`tribu_bloqueados_${obtenerMiCorreo()}`)) || []; }
        catch(e) { return []; }
    },
    guardarBloqueados(lista) {
        localStorage.setItem(`tribu_bloqueados_${obtenerMiCorreo()}`, JSON.stringify(lista));
    },
    obtenerFijados() {
        try { return JSON.parse(localStorage.getItem(`tribu_fijados_${obtenerMiCorreo()}`)) || []; }
        catch(e) { return []; }
    },
    guardarFijados(lista) {
        localStorage.setItem(`tribu_fijados_${obtenerMiCorreo()}`, JSON.stringify(lista));
    },
    obtenerGrupo() {
        try { return JSON.parse(localStorage.getItem(`tribu_grupo_${obtenerMiCorreo()}`)) || []; }
        catch(e) { return []; }
    },
    guardarGrupo(lista) {
        localStorage.setItem(`tribu_grupo_${obtenerMiCorreo()}`, JSON.stringify(lista));
    },

    // 1. OBTENER LISTA DE CONTACTOS
    async obtenerContactos(mostrarTodos = false) {
        const miCorreo = obtenerMiCorreo();
        if (!miCorreo) return [];
        try {
            const res = await fetch(`${BASE_API}/contactos/${miCorreo}`);
            const data = await res.json();
            let contactos = data.contactos || [];

            if (!mostrarTodos) {
                const bloqueados = this.obtenerBloqueados();
                contactos = contactos.filter(c => !bloqueados.includes(c.email));
            }
            return contactos;
        } catch (e) { return []; }
    },

    // 2. OBTENER MENSAJES (Ahora soporta modo GRUPO fusionando mensajes)
    async obtenerMensajesPrivados() {
        const miCorreo = obtenerMiCorreo();
        if (!miCorreo || !this.chatActivoCorreo) return [];
        
        if (this.chatActivoCorreo === 'GRUPO_LOCAL') {
            const correosGrupo = this.obtenerGrupo();
            if (correosGrupo.length === 0) return [];
            try {
                const promesas = correosGrupo.map(correo => fetch(`${BASE_API}/chat/${miCorreo}/${correo}`).then(r => r.json()));
                const resultados = await Promise.all(promesas);
                
                let mensajesCombinados = [];
                resultados.forEach(arr => { if(Array.isArray(arr)) mensajesCombinados = mensajesCombinados.concat(arr); });
                
                const unicos = {};
                mensajesCombinados.forEach(m => unicos[m.id] = m);
                mensajesCombinados = Object.values(unicos);
                
                mensajesCombinados.sort((a, b) => a.id - b.id);
                
                this.mensajesCacheados = mensajesCombinados;
                return mensajesCombinados;
            } catch(e) { return []; }
        }

        try {
            const res = await fetch(`${BASE_API}/chat/${miCorreo}/${this.chatActivoCorreo}`);
            const mensajes = await res.json();
            this.mensajesCacheados = mensajes;
            return mensajes;
        } catch (e) { return []; }
    },

    // 3. ENVIAR MENSAJE (Ahora soporta envío en ráfaga al GRUPO)
    async enviarMensaje(texto, archivo = null) {
        const miNombre = obtenerMiNombre();
        const miCorreo = obtenerMiCorreo();

        if (!miCorreo || !this.chatActivoCorreo) return { error: "No hay chat activo" };

        if (this.chatActivoCorreo === 'GRUPO_LOCAL') {
            const correosGrupo = this.obtenerGrupo();
            const promesas = correosGrupo.map(correo => {
                const formData = new FormData();
                formData.append('nombre', miNombre);
                formData.append('sender_email', miCorreo);
                formData.append('receiver_email', correo);
                formData.append('texto', texto);
                if (archivo) formData.append('file', archivo);
                return fetch(`${BASE_API}/chat/enviar`, { method: 'POST', body: formData }).then(r => r.json());
            });
            
            try {
                await Promise.all(promesas);
                return { status: 'ok' }; 
            } catch(e) { return { error: "Fallo envío grupal" }; }
        }

        const formData = new FormData();
        formData.append('nombre', miNombre);
        formData.append('sender_email', miCorreo);
        formData.append('receiver_email', this.chatActivoCorreo);
        formData.append('texto', texto);
        if (archivo) {
            formData.append('file', archivo);
        }

        try {
            const res = await fetch(`${BASE_API}/chat/enviar`, { method: 'POST', body: formData });
            return await res.json();
        } catch (e) { return { error: "Fallo de conexión" }; }
    },

    // 4. VERIFICAR NOTIFICACIONES (Punto Rojo)
    async verificarPuntoRojo() {
        const miCorreo = obtenerMiCorreo();
        if (!miCorreo) return false;
        try {
            const res = await fetch(`${BASE_API}/chat/unread/${miCorreo}`);
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
        const miCorreo = obtenerMiCorreo();
        if (!miCorreo || !this.chatActivoCorreo) return;
        try {
            await fetch(`${BASE_API}/chat/limpiar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mi_email: miCorreo, otro_email: this.chatActivoCorreo })
            });
        } catch (e) { console.error("Error limpiando chat", e); }
    },

    // 7. PINTAR LA LISTA DE CONTACTOS EN EL HTML
    renderizarContactos(contactos) {
        const container = document.getElementById('chat-contacts');
        if (!container) return;

        const searchContainer = document.querySelector('#vista-contactos .input-group');
        if (searchContainer && !document.getElementById('btn-crear-grupo-ui')) {
            const btnGrupo = document.createElement('button');
            btnGrupo.id = 'btn-crear-grupo-ui';
            btnGrupo.className = 'btn btn-primary shadow-none px-3';
            btnGrupo.style.borderTopRightRadius = '50rem';
            btnGrupo.style.borderBottomRightRadius = '50rem';
            btnGrupo.innerHTML = '<i class="bi bi-people-fill"></i>';
            btnGrupo.title = 'Crear/Editar Grupo';
            btnGrupo.onclick = () => window.abrirModalGrupo();
            
            const inputBusqueda = document.getElementById('buscador-input');
            if(inputBusqueda) inputBusqueda.classList.remove('rounded-end-pill');
            searchContainer.appendChild(btnGrupo);
        }

        const fijados = this.obtenerFijados();
        const grupo = this.obtenerGrupo();

        contactos.sort((a, b) => {
            const aFijado = fijados.includes(a.email);
            const bFijado = fijados.includes(b.email);
            if (aFijado && !bFijado) return -1;
            if (!aFijado && bFijado) return 1;
            return 0; 
        });

        if (grupo.length > 0) {
            contactos.unshift({
                email: 'GRUPO_LOCAL',
                nombre: '👥 Grupo de Difusión',
                is_online: true,
                no_leidos: 0,
                es_grupo: true
            });
        }

        let html = '';
        contactos.forEach(c => {
            const inicial = c.es_grupo ? '<i class="bi bi-collection-fill"></i>' : (c.nombre ? c.nombre.charAt(0).toUpperCase() : '?');
            const badge = c.no_leidos > 0 ? `<span class="badge bg-danger rounded-pill shadow-sm ms-2">${c.no_leidos}</span>` : '';
            
            const isFijado = fijados.includes(c.email);
            const pinIcon = isFijado ? '<i class="bi bi-pin-angle-fill text-primary ms-2" title="Fijado"></i>' : '';

            const isOnlineStatus = c.is_online
                ? `<span class="position-absolute bottom-0 end-0 p-1 bg-success border border-white rounded-circle" style="width: 14px; height: 14px; box-shadow: 0 0 5px rgba(25, 135, 84, 0.5);" title="En línea"></span>`
                : `<span class="position-absolute bottom-0 end-0 p-1 bg-secondary border border-white rounded-circle" style="width: 14px; height: 14px; opacity: 0.5;" title="Desconectado"></span>`;

            const infoSecundaria = c.es_grupo 
                ? 'Mensajes masivos compartidos' 
                : `${c.email || 'Sin correo'} | ${c.is_online ? '<span class="text-success fw-medium">En línea</span>' : 'Desconectado'}`;

            html += `
            <div class="list-group-item d-flex align-items-center p-3 border-0 border-bottom contacto-item ${c.es_grupo ? 'bg-light' : ''}" data-name="${(c.nombre || '').toLowerCase()}" style="cursor:pointer; transition: background 0.2s;" onclick="window.abrirChatPrivado('${c.email}', '${c.nombre.replace(/'/g, "\\'")}')" onmouseover="this.style.backgroundColor='#f8f9fa'" onmouseout="this.style.backgroundColor='transparent'">
                
                <div class="position-relative">
                    <div class="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold shadow-sm" style="width: 48px; height: 48px; font-size: 1.3rem;">
                        ${inicial}
                    </div>
                    ${!c.es_grupo ? isOnlineStatus : ''}
                </div>

                <div class="ms-3 flex-grow-1">
                    <p class="mb-0 fw-bold text-dark d-flex align-items-center">${c.nombre} ${pinIcon} ${badge}</p>
                    <p class="mb-0 text-muted small">${infoSecundaria}</p>
                </div>
            </div>`;
        });
        
        container.innerHTML = html || '<p class="text-center text-muted p-5">No hay compañeros disponibles.</p>';
    },

    // 8. PINTAR LOS MENSAJES
    renderizarMensajes(mensajes, containerId) {
        const container = document.getElementById(containerId);
        if (!container || !Array.isArray(mensajes)) return;

        const miCorreo = obtenerMiCorreo();
        let html = '';

        mensajes.forEach(m => {
            const esMio = (m.sender_email === miCorreo);
            
            let readIcon = '';
            let btnBorrar = '';

            if (esMio) {
                readIcon = m.is_read 
                    ? '<i class="bi bi-check2-all text-info ms-1" style="font-size:1.1rem;"></i>' 
                    : '<i class="bi bi-check2 text-secondary ms-1" style="font-size:1.1rem;"></i>'; 
                btnBorrar = `<i class="bi bi-trash-fill text-white-50 ms-2" style="cursor:pointer;" onclick="window.eliminarMensaje(${m.id})" title="Borrar para todos"></i>`;
            }

            let adjuntoHtml = '';
            if (m.file_path) {
                const rootHost = BASE_API.split('/api/')[0];
                const fullUrl = `${rootHost}${m.file_path}`;
                if (m.file_type === 'image') {
                    adjuntoHtml = `<img src="${fullUrl}" class="img-fluid rounded-3 mb-2 shadow-sm" style="max-height: 200px; cursor: pointer;" onclick="window.open(this.src)">`;
                } else if (m.file_type === 'audio') {
                    adjuntoHtml = `<audio controls class="w-100 mb-2" style="height: 35px;"><source src="${fullUrl}"></audio>`;
                } else {
                    adjuntoHtml = `<a href="${fullUrl}" target="_blank" class="btn btn-sm btn-light border w-100 mb-2 text-start"><i class="bi bi-file-earmark-text"></i> Ver Documento</a>`;
                }
            }

            const nombreRemitente = (!esMio && this.chatActivoCorreo === 'GRUPO_LOCAL') 
                ? `<small class="text-primary fw-bold d-block mb-1" style="font-size: 0.75rem;">${m.nombre}</small>` 
                : '';

            let textoMensaje = m.texto || '';
            if (textoMensaje.includes('📍') && textoMensaje.includes('maps?q=')) {
                const link = textoMensaje.substring(textoMensaje.indexOf('http'));
                textoMensaje = `
                    <div class="text-center mb-2">
                        <i class="bi bi-geo-alt-fill text-danger" style="font-size: 2rem;"></i><br>
                        <span class="fw-bold">Ubicación Compartida</span>
                    </div>
                    <a href="${link}" target="_blank" class="btn btn-sm btn-light w-100 border text-dark fw-bold">Abrir en el Mapa</a>
                `;
            }

            html += `
                <div class="d-flex flex-column ${esMio ? 'align-items-end' : 'align-items-start'} mb-3">
                    <div class="p-3 rounded-4 shadow-sm position-relative" style="max-width: 85%; min-width: 120px; ${esMio ? 'background-color: #0d6efd; color: white;' : 'background-color: white; border: 1px solid #dee2e6; color: #212529;'}">
                        ${nombreRemitente}
                        ${adjuntoHtml}
                        ${textoMensaje ? `<p class="mb-0 text-break" style="font-size: 0.95rem; line-height: 1.3;">${textoMensaje}</p>` : ''}
                        
                        <div class="text-end mt-1 d-flex align-items-center justify-content-end" style="margin-bottom: -5px;">
                            <small class="${esMio ? 'text-white-50' : 'text-muted'}" style="font-size: 0.65rem;">${m.fecha || ''}</small>
                            ${readIcon}
                            ${btnBorrar}
                        </div>
                    </div>
                </div>`;
        });

        const newContent = html || '<div class="text-center text-muted py-5"><i class="bi bi-chat-dots fs-1 d-block mb-2"></i>Inicia la conversación.</div>';

        if (container.dataset.lastContent !== newContent) {
            const estabaAlFinal = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
            container.innerHTML = newContent;
            container.dataset.lastContent = newContent; 
            if (estabaAlFinal) container.scrollTop = container.scrollHeight;
        }
    }
};

// ============================================================================
// FUNCIONES DE NAVEGACIÓN Y MENÚ
// ============================================================================

// 🔥 SOLUCIÓN DEFINITIVA: NO SOBRESCRIBIR TU CÓDIGO 🔥
// Eliminé 'window.abrirModalChat' de este archivo porque tú ya la tienes en tu SPA original.
// Al ponerla aquí yo te estaba destruyendo el botón flotante.
// En su lugar, simplemente usamos este "observador invisible" que detecta cuando TU código abre el modal, y ahí inyectamos los contactos.
document.addEventListener('shown.bs.modal', async function (event) {
    if (event.target.id === 'modalChat') {
        try {
            const contactos = await window.ChatManager.obtenerContactos();
            window.ChatManager.renderizarContactos(contactos);
        } catch(e) {
            console.error("Error al cargar contactos:", e);
        }
    }
});

window.seleccionarContacto = function(correo, nombre) {
    window.abrirChatPrivado(correo, nombre);
};

window.refrescarChat = async function() {
    if (!window.ChatManager.chatActivoCorreo) return;
    const mensajes = await window.ChatManager.obtenerMensajesPrivados();
    window.ChatManager.renderizarMensajes(mensajes, 'chat-window');
};

window.cerrarChatGlobal = function() {
    window.ChatManager.chatActivoCorreo = null;
    if (window.ChatManager.intervaloChatActivo) {
        clearInterval(window.ChatManager.intervaloChatActivo);
    }
};

window.abrirChatPrivado = function(correo, nombre) {
    window.ChatManager.chatActivoCorreo = correo;
    window.ChatManager.chatActivoNombre = nombre;
    
    const titleEl = document.getElementById('chat-title');
    if(titleEl) titleEl.innerText = nombre;
    
    document.getElementById('vista-contactos').classList.add('d-none');
    document.getElementById('vista-contactos').classList.remove('d-block');
    document.getElementById('vista-chat').classList.remove('d-none');
    document.getElementById('vista-chat').classList.add('d-flex');
    document.getElementById('btn-chat-volver').classList.remove('d-none');
    
    const btnOpts = document.getElementById('chat-options-btn');
    if(btnOpts) {
        btnOpts.classList.remove('d-none');
        const dropdown = btnOpts.querySelector('.dropdown-menu');
        
        if (dropdown) {
            dropdown.querySelectorAll('.dynamic-chat-opt').forEach(e => e.remove());

            if (correo === 'GRUPO_LOCAL') {
                const liGrp = document.createElement('li');
                liGrp.className = 'dynamic-chat-opt';
                liGrp.innerHTML = `<a class="dropdown-item py-2 text-danger fw-bold" href="#" onclick="window.disolverGrupo()"><i class="bi bi-x-octagon-fill me-2"></i> Disolver Grupo</a>`;
                dropdown.insertBefore(liGrp, dropdown.firstChild);
            } else {
                const isFijado = window.ChatManager.obtenerFijados().includes(correo);
                
                const liBlock = document.createElement('li');
                liBlock.className = 'dynamic-chat-opt';
                liBlock.innerHTML = `<a class="dropdown-item py-2 text-warning fw-bold" href="#" onclick="window.abrirModalBloqueos()"><i class="bi bi-slash-circle me-2"></i> Bloquear Usuarios</a>`;
                dropdown.insertBefore(liBlock, dropdown.firstChild);

                const liFijar = document.createElement('li');
                liFijar.className = 'dynamic-chat-opt';
                liFijar.innerHTML = `<a class="dropdown-item py-2 text-primary fw-bold" href="#" onclick="window.toggleFijar('${correo}')"><i class="bi bi-pin-angle-fill me-2"></i> ${isFijado ? 'Desfijar' : 'Fijar'} Usuario</a>`;
                dropdown.insertBefore(liFijar, dropdown.firstChild);
            }

            const btnThreeDots = btnOpts.querySelector('button');
            if (btnThreeDots && !btnThreeDots.dataset.fixed) {
                btnThreeDots.dataset.fixed = "true";
                btnThreeDots.removeAttribute('data-bs-toggle'); 
                
                btnThreeDots.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropdown.classList.toggle('show'); 
                });

                document.addEventListener('click', (e) => {
                    if (!btnOpts.contains(e.target)) dropdown.classList.remove('show');
                });
                dropdown.addEventListener('click', () => dropdown.classList.remove('show'));
            }
        }
    }

    const btnClip = document.getElementById('btn-adjunto-menu');
    if (btnClip && !btnClip.dataset.fixed) {
        btnClip.dataset.fixed = "true";
        btnClip.removeAttribute('data-bs-toggle'); 
        
        btnClip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dropdownClip = btnClip.nextElementSibling;
            if (dropdownClip) dropdownClip.classList.toggle('show'); 
        });

        document.addEventListener('click', (e) => {
            const dropdownClip = btnClip ? btnClip.nextElementSibling : null;
            if (dropdownClip && !btnClip.contains(e.target) && !dropdownClip.contains(e.target)) {
                dropdownClip.classList.remove('show');
            }
        });

        const dropdownClip = btnClip.nextElementSibling;
        if (dropdownClip) {
            dropdownClip.addEventListener('click', () => {
                dropdownClip.classList.remove('show');
            });
        }
    }

    const chatWin = document.getElementById('chat-window');
    if(chatWin) {
        chatWin.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
        chatWin.dataset.lastContent = '';
    }
    
    window.refrescarChat();
    
    if (window.ChatManager.intervaloChatActivo) clearInterval(window.ChatManager.intervaloChatActivo);
    window.ChatManager.intervaloChatActivo = setInterval(() => {
        if (!document.getElementById('vista-chat').classList.contains('d-none')) {
            window.refrescarChat();
        } else {
            clearInterval(window.ChatManager.intervaloChatActivo);
        }
    }, 2500); 
};

window.volverAContactos = async function() {
    window.ChatManager.chatActivoCorreo = null;
    if (window.ChatManager.intervaloChatActivo) clearInterval(window.ChatManager.intervaloChatActivo);
    
    const titleEl = document.getElementById('chat-title');
    if(titleEl) titleEl.innerText = 'Mensajes';
    
    document.getElementById('vista-chat').classList.add('d-none');
    document.getElementById('vista-chat').classList.remove('d-flex');
    document.getElementById('vista-contactos').classList.remove('d-none');
    document.getElementById('vista-contactos').classList.add('d-block');
    document.getElementById('btn-chat-volver').classList.add('d-none');

    const btnOpts = document.getElementById('chat-options-btn');
    if(btnOpts) btnOpts.classList.add('d-none');
    
    const picker = document.getElementById('emoji-picker');
    if(picker) picker.classList.add('d-none');

    const contactos = await window.ChatManager.obtenerContactos();
    window.ChatManager.renderizarContactos(contactos);
};

// ============================================================================
// FUNCIONALIDADES ADICIONALES (Fijar, Grupos, Exportar)
// ============================================================================

window.toggleFijar = function(correo) {
    let fijados = window.ChatManager.obtenerFijados();
    if (fijados.includes(correo)) fijados = fijados.filter(p => p !== correo);
    else fijados.push(correo);
    window.ChatManager.guardarFijados(fijados);
    
    window.abrirChatPrivado(correo, window.ChatManager.chatActivoNombre);
};

window.disolverGrupo = function() {
    if(confirm("¿Disolver el grupo? Los mensajes enviados seguirán existiendo en los chats individuales de cada persona.")) {
        window.ChatManager.guardarGrupo([]);
        window.volverAContactos();
    }
};

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
    if (confirm("¿Estás seguro de que quieres eliminar TODA la conversación con este usuario?")) {
        await window.ChatManager.limpiarChatCompleto();
        if (window.refrescarChat) window.refrescarChat();
    }
};

window.exportarTXT = function() {
    if (!window.ChatManager || !window.ChatManager.mensajesCacheados.length) return alert("No hay mensajes para exportar."); 
    let textData = `=== CHAT CON ${window.ChatManager.chatActivoNombre} ===\n\n`;
    window.ChatManager.mensajesCacheados.forEach(m => {
        textData += `[${m.fecha_larga || m.fecha}] ${m.nombre}:\n${m.texto || ''}\n`;
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

// ============================================================================
// LÓGICA DE VISTAS ESPECIALES (Bloqueos y Grupos)
// ============================================================================

window.abrirModalBloqueos = async function() {
    let container = document.getElementById('vista-especial');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vista-especial';
        container.className = 'd-none flex-column h-100 bg-white';
        const modalBody = document.querySelector('#modalChat .modal-body');
        if (modalBody) modalBody.appendChild(container);
    }

    const contactos = await window.ChatManager.obtenerContactos(true);
    const bloqueados = window.ChatManager.obtenerBloqueados();

    let html = `
        <div class="flex-grow-1 overflow-auto p-3" style="height: 65vh;">
            <div class="alert alert-warning border-0 shadow-sm rounded-4 mb-3 d-flex align-items-center">
                <i class="bi bi-eye-slash-fill fs-3 me-3"></i>
                <small>Los usuarios bloqueados no aparecerán en tu lista de contactos.</small>
            </div>
            <div class="list-group shadow-sm border-0">
    `;

    contactos.forEach(c => {
        const esSuperAdmin = (c.rol === 'superadmin');
        if (esSuperAdmin) return;

        const isBlocked = bloqueados.includes(c.email);
        html += `
            <label class="list-group-item d-flex justify-content-between align-items-center border-0 border-bottom p-3" style="cursor:pointer;">
                <div class="d-flex align-items-center">
                    <div class="rounded-circle bg-secondary bg-opacity-10 text-secondary d-flex align-items-center justify-content-center fw-bold me-3" style="width: 42px; height: 42px;">
                        ${c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <span class="fw-bold text-dark">${c.nombre}</span>
                        <div class="text-muted small">${c.email || 'Sin correo'}</div>
                    </div>
                </div>
                <div class="form-check form-switch m-0 p-0 d-flex align-items-center">
                    <input class="form-check-input ms-0 mt-0 shadow-none fs-4" type="checkbox" style="cursor: pointer;" value="${c.email}" ${isBlocked ? 'checked' : ''} onchange="window.toggleBloqueo('${c.email}', this.checked)">
                </div>
            </label>`;
    });

    container.innerHTML = html + `</div></div>`;
    cambiarAVistaEspecial('Privacidad');
};

window.abrirModalGrupo = async function() {
    let container = document.getElementById('vista-especial');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vista-especial';
        container.className = 'd-none flex-column h-100 bg-white';
        document.querySelector('#modalChat .modal-body').appendChild(container);
    }

    const contactos = await window.ChatManager.obtenerContactos(false);
    const grupo = window.ChatManager.obtenerGrupo();

    let html = `
        <div class="flex-grow-1 overflow-auto p-3" style="height: 65vh;">
            <div class="alert alert-info border-0 shadow-sm rounded-4 mb-3 d-flex align-items-center">
                <i class="bi bi-people-fill fs-3 me-3"></i>
                <small>Selecciona los miembros. Los mensajes que envíes en el grupo llegarán a todos ellos.</small>
            </div>
            <div class="list-group shadow-sm border-0">
    `;

    contactos.forEach(c => {
        const inGroup = grupo.includes(c.email);
        html += `
            <label class="list-group-item d-flex justify-content-between align-items-center border-0 border-bottom p-3" style="cursor:pointer;">
                <div class="d-flex align-items-center">
                    <div class="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center fw-bold me-3" style="width: 42px; height: 42px;">
                        ${c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <span class="fw-bold text-dark">${c.nombre}</span>
                        <div class="text-muted small">${c.email || 'Sin correo'}</div>
                    </div>
                </div>
                <div class="form-check m-0 p-0 d-flex align-items-center">
                    <input class="form-check-input ms-0 mt-0 shadow-none fs-4" type="checkbox" style="cursor: pointer;" value="${c.email}" ${inGroup ? 'checked' : ''} onchange="window.toggleGrupo('${c.email}', this.checked)">
                </div>
            </label>`;
    });

    container.innerHTML = html + `</div></div>`;
    cambiarAVistaEspecial('Crear Grupo');
};

function cambiarAVistaEspecial(titulo) {
    document.getElementById('vista-contactos').classList.add('d-none');
    document.getElementById('vista-contactos').classList.remove('d-block');
    const vistaChat = document.getElementById('vista-chat');
    if(vistaChat) { vistaChat.classList.add('d-none'); vistaChat.classList.remove('d-flex'); }
    
    const container = document.getElementById('vista-especial');
    container.classList.remove('d-none');
    container.classList.add('d-flex');

    document.getElementById('chat-title').innerText = titulo;
    const btnOpts = document.getElementById('chat-options-btn');
    if(btnOpts) btnOpts.classList.add('d-none');

    const btnVolver = document.getElementById('btn-chat-volver');
    if(btnVolver) {
        btnVolver.classList.remove('d-none');
        btnVolver.setAttribute('onclick', 'window.cerrarVistaEspecial()');
    }
}

window.cerrarVistaEspecial = function() {
    const container = document.getElementById('vista-especial');
    if (container) {
        container.classList.add('d-none');
        container.classList.remove('d-flex');
    }
    const btnVolver = document.getElementById('btn-chat-volver');
    if(btnVolver) btnVolver.setAttribute('onclick', 'window.volverAContactos()');
    window.volverAContactos();
};

window.toggleBloqueo = function(correo, isBlocked) {
    let bloqueados = window.ChatManager.obtenerBloqueados();
    if (isBlocked) { if (!bloqueados.includes(correo)) bloqueados.push(correo); } 
    else { bloqueados = bloqueados.filter(p => p !== correo); }
    window.ChatManager.guardarBloqueados(bloqueados);
};

window.toggleGrupo = function(correo, isAdded) {
    let grupo = window.ChatManager.obtenerGrupo();
    if (isAdded) { if (!grupo.includes(correo)) grupo.push(correo); } 
    else { grupo = grupo.filter(p => p !== correo); }
    window.ChatManager.guardarGrupo(grupo);
};

// ============================================================================
// NUEVO: GESTIÓN DE ADJUNTOS, CÁMARA, GPS Y EMOJIS
// ============================================================================

window.actualizarEstadoAdjunto = function(input) {
    const btnMenu = document.getElementById('btn-adjunto-menu');
    if (input.files && input.files[0]) {
        window.tempFile = input.files[0];
        
        if (btnMenu) {
            btnMenu.classList.add('bg-success', 'text-white');
            btnMenu.classList.remove('btn-light');
            btnMenu.innerHTML = '<i class="bi bi-check2 fs-5"></i>';
        }
    } else {
        window.tempFile = null;
        if (btnMenu) {
            btnMenu.classList.remove('bg-success', 'text-white');
            btnMenu.classList.add('btn-light');
            btnMenu.innerHTML = '<i class="bi bi-paperclip fs-5"></i>';
        }
    }
};

window.enviarAccionChat = async function() {
    const input = document.getElementById('chat-msg-input');
    const txt = input ? input.value.trim() : '';
    const file = window.tempFile;
    
    if (!txt && !file) return;

    const btn = document.querySelector('#modalChat .bi-send-fill').parentNode;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';
    }

    const res = await window.ChatManager.enviarMensaje(txt, file);
    
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send-fill"></i>';
    }

    if (res && res.status === 'ok') {
        if (input) input.value = '';
        window.tempFile = null;
        
        const fileGaleria = document.getElementById('chat-file');
        const fileCamara = document.getElementById('chat-camera-input');
        if (fileGaleria) fileGaleria.value = '';
        if (fileCamara) fileCamara.value = '';

        window.actualizarEstadoAdjunto({files: []});
        
        const picker = document.getElementById('emoji-picker');
        if (picker) picker.classList.add('d-none');

        await window.refrescarChat();
    }
};

window.enviarUbicacion = function() {
    if (!navigator.geolocation) {
        return alert("Tu dispositivo no soporta compartir ubicación.");
    }
    
    const btnMenu = document.getElementById('btn-adjunto-menu');
    const dropdown = btnMenu ? btnMenu.nextElementSibling : null;
    if (dropdown) dropdown.classList.remove('show');

    const btnSend = document.querySelector('#modalChat .bi-send-fill').parentNode;
    if (btnSend) {
        btnSend.disabled = true;
        btnSend.innerHTML = '<span class="spinner-border spinner-border-sm text-primary" role="status"></span>';
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const mapsLink = `📍 Mi ubicación actual: https://www.google.com/maps?q=${lat},${lng}`;
        
        const res = await window.ChatManager.enviarMensaje(mapsLink, null);
        
        if (btnSend) {
            btnSend.disabled = false;
            btnSend.innerHTML = '<i class="bi bi-send-fill"></i>';
        }
        
        if (res && res.status === 'ok') {
            await window.refrescarChat();
        }
    }, (error) => {
        if (btnSend) {
            btnSend.disabled = false;
            btnSend.innerHTML = '<i class="bi bi-send-fill"></i>';
        }
        alert("No pudimos obtener la ubicación. Verifica que el GPS (Ubicación) de tu teléfono esté encendido.");
    }, { enableHighAccuracy: true, timeout: 10000 });
};

window.toggleEmojiPicker = function() {
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;
    
    if (picker.classList.contains('d-none')) {
        if (picker.children.length === 0) {
            const populares = ['😀','😂','🤣','🥰','😍','😎','🥺','😭','😡','🤔','😬','🥳','💩','🤡','👻','👽','🚀','⭐','🔥','👍','👎','👏','🙏','🍻','⚽','🏔️','⛺','📍','🎉','❤️','💔'];
            let html = '';
            populares.forEach(e => {
                html += `<span style="font-size: 1.5rem; cursor: pointer; text-align: center; transition: transform 0.1s;" onclick="window.agregarEmoji('${e}')" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'">${e}</span>`;
            });
            picker.innerHTML = html;
        }
        picker.classList.remove('d-none');
    } else {
        picker.classList.add('d-none');
    }
};

window.agregarEmoji = function(emoji) {
    const input = document.getElementById('chat-msg-input');
    if(input) {
        input.value += emoji;
        input.focus();
    }
};

// ============================================================================
// SISTEMA DE LATIDOS (PING) Y NOTIFICACIONES
// ============================================================================

window.revisarNotificacionesGlobales = async function() {
    const miCorreo = obtenerMiCorreo();
    if (miCorreo) fetch(`${BASE_API}/ping/${miCorreo}`).catch(() => {});

    const btnFlotante = document.getElementById('btn-chat-flotante');
    if (window.ChatManager && btnFlotante && !btnFlotante.classList.contains('hidden-forced')) {
        const hayNuevos = await window.ChatManager.verificarPuntoRojo();
        const badge = document.getElementById('chat-badge');
        if (badge) {
            if (hayNuevos) badge.classList.remove('d-none');
            else badge.classList.add('d-none');
        }
    }
};

setInterval(window.revisarNotificacionesGlobales, 6000);