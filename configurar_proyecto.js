const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https'); // Usado para enviar los usuarios a PythonAnywhere

// Configuración de la interfaz de terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Función de ayuda para convertir rl.question en Promesas (Evita el "Callback Hell")
const ask = (query) => new Promise(resolve => rl.question(query, resolve));

/**
 * Script de automatización para el Motor Universal v2
 */

// Rutas a los archivos locales
const capacitorFile = path.join(__dirname, 'capacitor.config.json');
const packageJsonFile = path.join(__dirname, 'package.json');

let apiDbFile = path.join(__dirname, 'api_db.js');
if (!fs.existsSync(apiDbFile)) apiDbFile = path.join(__dirname, 'www', 'api_db.js');
if (!fs.existsSync(apiDbFile)) apiDbFile = path.join(__dirname, 'www', 'js', 'api_db.js');

async function iniciarAsistente() {
    console.log("======================================================");
    console.log("🚀  ASISTENTE MULTI-APP (MOTOR UNIVERSAL V2)");
    console.log("======================================================\n");

    const appNameInput = await ask('1. Nombre de la nueva App (Ej: Altair Pro): ');
    const appName = appNameInput.trim() || 'MiApp';
    const appSlug = appName.replace(/[^a-zA-Z0-9 ]/g, ''); 
    const defaultId = `com.${appSlug.replace(/\s+/g, '').toLowerCase()}.app`;

    rl.write(defaultId);
    const appIdInput = await ask(`2. ID de la App (Puedes editarlo o presionar Enter): `);
    const appId = appIdInput.trim() || defaultId;

    const askIcon = await ask('\n3. ¿Desea cambiar el icono de la aplicacion? (S/N): ');
    let iconPath = "";
    
    if (askIcon.trim().toLowerCase() === 's' || askIcon.trim().toLowerCase() === 'si') {
        const iconPathInput = await ask('   [INFO] Arrastra aqui tu imagen (Soporta PNG y JPG): ');
        iconPath = iconPathInput.trim().replace(/^["']|["']$/g, '');
        
        // Traducción de rutas WSL a Windows
        if (iconPath.toLowerCase().startsWith('/mnt/')) {
            const parts = iconPath.split('/');
            const drive = parts[2].toUpperCase(); 
            const rest = parts.slice(3).join('\\');
            iconPath = `${drive}:\\${rest}`;
        }
    }

    // =========================================================
    // NUEVA SECCIÓN: SUPERUSUARIOS DINÁMICOS
    // =========================================================
    console.log("\n======================================================");
    console.log("🛡️  CONFIGURACIÓN DE SUPERUSUARIOS (ADMINISTRADORES)");
    console.log("======================================================");
    
    let numAdmins = 0;
    while (numAdmins < 1 || numAdmins > 4) {
        const numInput = await ask('¿Cuántos Superusuarios tendrá la App? (Entre 1 y 4): ');
        numAdmins = parseInt(numInput.trim());
        if (isNaN(numAdmins) || numAdmins < 1 || numAdmins > 4) {
            console.log("   [!] Por favor, ingresa un número válido (1, 2, 3 o 4).\n");
        }
    }

    const superusuarios = [];

    for (let i = 1; i <= numAdmins; i++) {
        console.log(`\n--- Superusuario ${i} ---`);
        const email = await ask(`   Correo electrónico: `);
        
        let password = "";
        let confirm = "";
        let passMatch = false;
        
        // Bucle de validación de contraseñas
        while (!passMatch) {
            password = await ask(`   Contraseña: `);
            confirm = await ask(`   Confirmar Contraseña: `);
            
            if (password === confirm && password.length >= 4) {
                passMatch = true;
            } else {
                console.log("   [!] Las contraseñas no coinciden o son muy cortas. Intenta de nuevo.\n");
            }
        }

        // Generamos un PIN de 8 dígitos para el acceso en la DB (Ej: Admin 1 = 00000000, Admin 2 = 11111111)
        const pin = String(i - 1).repeat(8);
        superusuarios.push({ email, password, pin });
    }

    finalizarConfiguracion(appName, appSlug.replace(/\s+/g, ''), appId, iconPath, superusuarios);
}

function finalizarConfiguracion(appName, appSlug, appId, iconPath, superusuarios) {
    console.log("\n⏳ Aplicando cambios en archivos locales...");

    try {
        if (fs.existsSync(capacitorFile)) {
            let cap = JSON.parse(fs.readFileSync(capacitorFile, 'utf8'));
            cap.appId = appId; cap.appName = appName;
            fs.writeFileSync(capacitorFile, JSON.stringify(cap, null, 2), 'utf8');
            console.log(`  [✔] capacitor.config.json -> App: ${appName}`);
        }
    } catch (e) {}

    try {
        if (fs.existsSync(apiDbFile)) {
            let apiContent = fs.readFileSync(apiDbFile, 'utf8');
            apiContent = apiContent.replace(/const API_URL = ".*";/, `const API_URL = "https://kenth1977.pythonanywhere.com/api/${appSlug}";`);
            fs.writeFileSync(apiDbFile, apiContent, 'utf8');
            console.log(`  [✔] api_db.js             -> URL actualizada`);
        }
    } catch (e) {}

    try {
        if (fs.existsSync(packageJsonFile)) {
            let pkg = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));
            pkg.name = appSlug.toLowerCase();
            fs.writeFileSync(packageJsonFile, JSON.stringify(pkg, null, 2), 'utf8');
            console.log(`  [✔] package.json          -> Nombre modificado`);
        }
    } catch (e) {}

    try {
        const androidDir = path.join(__dirname, 'android');
        if (fs.existsSync(androidDir)) {
            const buildConfigFile = path.join(androidDir, 'build_config.bat');
            const batContent = `@echo off\nset "CUSTOM_NAME=${appName}"\nset "ICON_PATH=${iconPath}"\n`;
            fs.writeFileSync(buildConfigFile, batContent, 'utf8');
            console.log(`  [✔] build_config.bat      -> Enlace creado`);
        }
    } catch(e) {}

    // =============================================================
    // MAGIA: ENVIAR SUPERUSUARIOS DIRECTAMENTE A LA NUBE
    // =============================================================
    console.log(`\n⏳ Conectando con PythonAnywhere para inicializar base de datos...`);
    
    const payloadStr = JSON.stringify({ superusuarios: superusuarios });
    const options = {
        hostname: 'kenth1977.pythonanywhere.com',
        port: 443,
        path: `/api/${appSlug}/crear_ahora`,
        method: 'POST', // Usamos POST para enviar la data de forma segura
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payloadStr)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
            console.log("\n======================================================");
            console.log("✨ ¡CONFIGURACIÓN COMPLETADA Y EN LA NUBE!");
            console.log(`📡 Base de datos creada: ${appSlug}.db`);
            console.log(`🦸 Superusuarios insertados con éxito (${superusuarios.length})`);
            console.log("\nPROXIMOS PASOS:");
            console.log(`1. Entra a la carpeta android: cd android`);
            console.log(`2. Ejecuta: construir.bat`);
            console.log("======================================================\n");
            rl.close();
        });
    });

    req.on('error', (e) => {
        console.error("  [!] Error de red conectando con la API:", e.message);
        console.log("  [INFO] Puedes reintentarlo o visitar la URL manualmente en el navegador.");
        rl.close();
    });

    req.write(payloadStr);
    req.end();
}

// Arrancar
iniciarAsistente();