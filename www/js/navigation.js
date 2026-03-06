// Navegación entre vistas - La Tribu

class NavigationManager {
    constructor() {
        this.init();
    }

    init() {
        // Agregar event listeners a los accesos rápidos
        this.setupQuickAccess();
    }

    setupQuickAccess() {
        // Esperar a que el DOM esté cargado
        document.addEventListener('DOMContentLoaded', () => {
            const quickAccessCards = document.querySelectorAll('.quick-access-card');
            
            quickAccessCards.forEach(card => {
                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    const cardText = card.querySelector('p').textContent.trim();
                    this.navigateToView(cardText);
                });
            });
        });
    }

    navigateToView(viewName) {
        const views = {
            'Calendario': 'calendario.html',
            'Instrucciones': 'instrucciones.html',
            'Pagos': 'tablapagos.html'
        };

        const targetFile = views[viewName];
        
        if (targetFile) {
            // Método 1: Navegación directa (para desarrollo)
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                window.location.href = targetFile;
            } else {
                // Método 2: Cargar contenido dinámicamente (para producción)
                this.loadViewDynamically(targetFile);
            }
        } else {
            console.warn(`Vista no encontrada: ${viewName}`);
        }
    }

    async loadViewDynamically(viewFile) {
        try {
            const response = await fetch(viewFile);
            if (!response.ok) throw new Error('No se pudo cargar la vista');
            
            const html = await response.text();
            const appContent = document.getElementById('app-content');
            
            if (appContent) {
                appContent.innerHTML = html;
                
                // Actualizar título de la página
                const title = this.extractTitleFromHtml(html);
                if (title) {
                    document.title = title;
                }
                
                // Ejecutar scripts de la vista cargada
                this.executeScripts(appContent);
            }
        } catch (error) {
            console.error('Error cargando la vista:', error);
            // Fallback: navegación directa
            window.location.href = viewFile;
        }
    }

    extractTitleFromHtml(html) {
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        return titleMatch ? titleMatch[1] : null;
    }

    executeScripts(container) {
        const scripts = container.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    // Método para volver a la vista principal
    goHome() {
        window.location.href = 'index.html';
    }

    // Método para navegación con animación
    navigateWithAnimation(viewFile, animation = 'fade') {
        const appContent = document.getElementById('app-content');
        
        // Aplicar animación de salida
        appContent.style.opacity = '0';
        appContent.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            this.navigateToView(viewFile);
            
            // Animación de entrada
            setTimeout(() => {
                appContent.style.transition = 'all 0.3s ease';
                appContent.style.opacity = '1';
                appContent.style.transform = 'translateY(0)';
            }, 100);
        }, 300);
    }
}

// Inicializar el gestor de navegación
const navigationManager = new NavigationManager();

// Hacer disponible globalmente para uso en otras partes de la app
window.NavigationManager = navigationManager;

// Funciones globales para compatibilidad
window.goHome = () => navigationManager.goHome();
window.navigateToView = (view) => navigationManager.navigateToView(view);

// Función global para volver atrás
window.goBack = () => {
    // Si estamos en una vista externa (no index.html), volver al index
    if (window.location.pathname !== '/' && window.location.pathname !== '/index.html' && !window.location.pathname.endsWith('index.html')) {
        window.location.href = 'index.html';
    } else {
        // Si estamos en el index, usar el history back normal
        history.back();
    }
};
