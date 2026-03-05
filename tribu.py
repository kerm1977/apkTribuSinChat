# ==============================================================================
# ARCHIVO: tribu.py (Anteriormente app.py del Padre)
# ROL: EL PADRE (Módulo principal de "La Tribu")
# DESCRIPCIÓN: Maneja la base de datos dinámica, autenticación, y registra 
#              a sus propios hijos (como chat.py). Acepta superusuarios dinámicos.
# ==============================================================================

import os
import time # NUEVO: Importación necesaria para calcular los estados 'En línea'
import logging
from flask import Blueprint, request, jsonify, send_from_directory, make_response
from flask_bcrypt import Bcrypt
from sqlalchemy import create_engine, Column, Integer, String, Boolean, MetaData, Table, insert, text
from sqlalchemy.orm import sessionmaker, scoped_session

# 1. Convertimos la app en un Blueprint (El Padre)
tribu_bp = Blueprint('tribu_bp', __name__)

# Bcrypt se inicializa de forma neutra (el Abuelo le dará el contexto al correr)
bcrypt = Bcrypt()

# ==========================================
# CONEXIÓN CON EL HIJO (MÓDULO DE CHAT)
# ==========================================
# Importamos el Blueprint del hijo y lo anidamos dentro del padre
from chat import chat_bp
tribu_bp.register_blueprint(chat_bp)

# --- CONFIGURACIÓN DE RUTAS ---
# Rutas absolutas en PythonAnywhere
BASE_DB_PATH = '/home/kenth1977/myDBs/DBs'
BASE_UPDATE_PATH = '/home/kenth1977/myDBs/updates'

# Asegurar que las carpetas necesarias existan físicamente al arrancar
for path in [BASE_DB_PATH, BASE_UPDATE_PATH]:
    if not os.path.exists(path):
        try:
            os.makedirs(path, exist_ok=True)
            print(f"[OK] Directorio creado: {path}")
        except Exception as e:
            print(f"[ERROR] No se pudo crear el directorio {path}: {e}")

# Diccionarios para gestionar las conexiones dinámicas
engines = {}
session_factories = {}

def get_db_session(app_slug, superusuarios=None):
    """Recupera o crea la conexión a la base de datos de la App específica"""
    # Limpiamos el slug (solo letras y números) para evitar inyecciones en la ruta
    safe_slug = "".join([c for c in app_slug if c.isalnum()])
    db_path = os.path.join(BASE_DB_PATH, f"{safe_slug}.db")
    
    # Comprobamos si el archivo físico existe antes de intentar conectar
    db_exists = os.path.exists(db_path)
    
    if safe_slug not in engines:
        # Crear engine de SQLAlchemy para esta DB en particular
        engine = create_engine(f"sqlite:///{db_path}")
        engines[safe_slug] = engine
        session_factory = sessionmaker(bind=engine)
        session_factories[safe_slug] = scoped_session(session_factory)
        
        # Definir metadatos y tablas localmente para esta conexión
        metadata = MetaData()
        
        user = Table('user', metadata,
            Column('id', Integer, primary_key=True),
            Column('username', String(80), unique=True, nullable=False),
            Column('email', String(120), unique=True, nullable=False),
            Column('password', String(128), nullable=False)
        )
        
        member = Table('member', metadata,
            Column('id', Integer, primary_key=True),
            Column('nombre', String(100)),
            Column('apellido1', String(100)),
            Column('pin', String(20)),
            Column('puntos_totales', Integer, default=0),
            Column('rol', String(20), default='usuario'), 
            Column('telefono', String(20)),               
            Column('emg_nombre', String(100)),            
            Column('emg_telefono', String(20)),           
            Column('dob_dia', String(4)),                 
            Column('dob_mes', String(4)),                 
            Column('dob_anio', String(4)),
            Column('last_active', Integer, default=0)     # NUEVO: Para saber si está online
        )
        
        event = Table('event', metadata,
            Column('id', Integer, primary_key=True),
            Column('nombre', String(100)),
            Column('fecha', String(50))
        )
        
        # Crear las tablas si no existen
        metadata.create_all(engine)
        
        # -- MIGRACIÓN AUTOMÁTICA (Auto-Patch) --
        if db_exists:
            with engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE user ADD COLUMN username VARCHAR(80)"))
                except Exception:
                    pass 
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN rol VARCHAR(20) DEFAULT 'usuario'"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN telefono VARCHAR(20)"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN emg_nombre VARCHAR(100)"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN emg_telefono VARCHAR(20)"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN dob_dia VARCHAR(4)"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN dob_mes VARCHAR(4)"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN dob_anio VARCHAR(4)"))
                except Exception:
                    pass
                try:
                    conn.execute(text("ALTER TABLE member ADD COLUMN last_active INTEGER DEFAULT 0"))
                except Exception:
                    pass
        
        # SEED de datos iniciales solo si la DB es nueva
        if not db_exists:
            with engine.begin() as conn:
                try:
                    # ========================================================
                    # INYECCIÓN DINÁMICA DE SUPERUSUARIOS (Recibidos de Node.js)
                    # ========================================================
                    if superusuarios:
                        for idx, su in enumerate(superusuarios, start=1):
                            # Cifrar contraseña entrante
                            hashed_pw = bcrypt.generate_password_hash(su['password']).decode('utf-8')
                            
                            # Insertar en tabla user (Auth)
                            conn.execute(user.insert().values(
                                username=f"admin_sys_{idx}",
                                email=su['email'],
                                password=hashed_pw
                            ))
                            
                            # Insertar perfil en tabla member (Frontend)
                            conn.execute(member.insert().values(
                                nombre='Administrador',
                                apellido1=f"{idx}",
                                pin=su.get('pin', str(idx-1)*8), # Pin automático 00000000, 11111111
                                puntos_totales=0,
                                rol='superadmin'
                            ))

                        print(f"Base de datos {safe_slug}.db inicializada con {len(superusuarios)} superusuarios dinámicos.")
                    else:
                        print(f"Base de datos {safe_slug}.db creada vacía (Sin superusuarios por defecto).")

                except Exception as e:
                    print(f"Error insertando seed inicial dinámico: {e}")
                    
    return session_factories[safe_slug]()


# --- RUTAS DE LA API ---

@tribu_bp.route('/')
def index():
    """Diagnóstico inicial"""
    try:
        files = [f.replace('.db', '') for f in os.listdir(BASE_DB_PATH) if f.endswith('.db')]
    except:
        files = []
    return jsonify({
        "status": "online",
        "motor": "Universal Multi-App v2.0",
        "apps_activas_en_disco": files,
        "ayuda": "Visita /api/NombreDeTuApp/crear_ahora para generar una nueva base de datos."
    })

@tribu_bp.route('/api/<app_slug>/crear_ahora', methods=['GET', 'POST', 'OPTIONS'])
def forzar_creacion(app_slug):
    """DISPARADOR: Crea la BD físicamente y recibe los superusuarios desde Node.js"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
        
    try:
        superusuarios_entrantes = []
        
        # Si la llamada viene del Script de Node.js (POST), extraemos las credenciales
        if request.method == 'POST':
            data = request.get_json(silent=True)
            if data and 'superusuarios' in data:
                superusuarios_entrantes = data['superusuarios']
                
        # Le pasamos los datos a la función que crea la BD
        get_db_session(app_slug, superusuarios_entrantes)
        
        return jsonify({
            "status": "ok",
            "mensaje": f"Base de datos para '{app_slug}' lista para usar."
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@tribu_bp.route('/api/<app_slug>/registro', methods=['POST', 'OPTIONS'])
def registrar_usuario(app_slug):
    """Endpoint para registrar un nuevo usuario"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    session = None
    try:
        data = request.json
        print(f"[*] Intento de registro en DB '{app_slug}' | Email: {data.get('email')}")
        
        session = get_db_session(app_slug)
        
        usuario_existente = session.execute(
            text("SELECT id FROM user WHERE email = :e"), 
            {"e": data.get('email')}
        ).fetchone()
        
        if usuario_existente:
            return jsonify({"error": "El correo ingresado ya se encuentra registrado."}), 400

        hashed_pw = bcrypt.generate_password_hash(data['password']).decode('utf-8')
        username_interno = data['email']
        
        session.execute(
            text("INSERT INTO user (username, email, password) VALUES (:u, :e, :p)"),
            {"u": username_interno, "e": data['email'], "p": hashed_pw}
        )
        
        session.execute(
            text("INSERT INTO member (nombre, apellido1, pin, puntos_totales, rol, telefono, emg_nombre, emg_telefono, dob_dia, dob_mes, dob_anio, last_active) VALUES (:n, :a, :pin, 0, 'usuario', :tel, :emg_n, :emg_t, :d_dia, :d_mes, :d_anio, :la)"),
            {
                "n": data['nombre'], 
                "a": data['apellido1'], 
                "pin": data['pin'],
                "tel": data.get('telefono', ''),
                "emg_n": data.get('emgNombre', ''),
                "emg_t": data.get('emgTelefono', ''),
                "d_dia": data.get('dobDia', ''),
                "d_mes": data.get('dobMes', ''),
                "d_anio": data.get('dobAnio', ''),
                "la": int(time.time()) # Al registrarse cuenta como conectado
            }
        )
        
        session.commit()
        print(f"[+] Registro exitoso en '{app_slug}' para {data.get('email')}")
        return jsonify({"status": "ok", "mensaje": "Usuario registrado exitosamente en la nube."})
        
    except Exception as e:
        if session:
            session.rollback()
        print(f"[-] Error en registro '{app_slug}': {e}")
        return jsonify({"error": str(e)}), 400
        
    finally:
        if session:
            session.close()

@tribu_bp.route('/api/<app_slug>/login', methods=['POST', 'OPTIONS'])
def login_usuario(app_slug):
    """Endpoint real para iniciar sesión y recuperar datos"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
        
    session = None
    try:
        data = request.json
        session = get_db_session(app_slug)
        
        user_record = session.execute(
            text("SELECT * FROM user WHERE email = :e"), 
            {"e": data['email']}
        ).mappings().fetchone()
        
        if not user_record:
            return jsonify({"error": "Credenciales incorrectas (Usuario no encontrado)"}), 401
            
        if not bcrypt.check_password_hash(user_record['password'], data['password']):
            return jsonify({"error": "Credenciales incorrectas (Contraseña inválida)"}), 401
            
        member_record = session.execute(
            text("SELECT * FROM member WHERE id = :id"),
            {"id": user_record['id']}
        ).mappings().fetchone()
        
        if not member_record:
            return jsonify({"error": "Perfil de usuario incompleto"}), 404
            
        usuario_data = {
            "nombre": f"{member_record['nombre']} {member_record['apellido1']}".strip(),
            "email": user_record['email'],
            "pin": member_record['pin'],
            "puntos": member_record['puntos_totales'],
            "rol": member_record.get('rol', 'usuario'), 
            "telefono": member_record.get('telefono') or '',
            "emgNombre": member_record.get('emg_nombre') or '',
            "emgTelefono": member_record.get('emg_telefono') or '',
            "dobDia": str(member_record.get('dob_dia') or ''),
            "dobMes": str(member_record.get('dob_mes') or ''),
            "dobAnio": str(member_record.get('dob_anio') or '')
        }
        
        return jsonify({"status": "ok", "usuario": usuario_data})
        
    except Exception as e:
        print(f"[-] Error en login '{app_slug}': {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if session:
            session.close()

@tribu_bp.route('/api/<app_slug>/editar_perfil', methods=['POST', 'OPTIONS'])
def editar_perfil(app_slug):
    """Endpoint real para actualizar datos del perfil"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    session = None
    try:
        data = request.json
        session = get_db_session(app_slug)
        
        user_record = session.execute(
            text("SELECT id FROM user WHERE email = :e"), 
            {"e": data['email']}
        ).mappings().fetchone()
        
        if not user_record:
            return jsonify({"error": "Usuario no encontrado"}), 404
            
        user_id = user_record['id']
        apellidos_completos = data.get('apellido1', '') + " " + data.get('apellido2', '')
        
        session.execute(
            text("""
                UPDATE member 
                SET nombre = :n, apellido1 = :a, pin = :pin, telefono = :tel, emg_nombre = :emg_n, emg_telefono = :emg_t, dob_dia = :d_dia, dob_mes = :d_mes, dob_anio = :d_anio
                WHERE id = :id
            """),
            {
                "n": data['nombre'], 
                "a": apellidos_completos.strip(), 
                "pin": data['pin'],
                "tel": data.get('telefono', ''),
                "emg_n": data.get('emgNombre', ''),
                "emg_t": data.get('emgTelefono', ''),
                "d_dia": data.get('dobDia', ''),
                "d_mes": data.get('dobMes', ''),
                "d_anio": data.get('dobAnio', ''),
                "id": user_id
            }
        )
        
        session.commit()
        return jsonify({"status": "ok", "mensaje": "Perfil actualizado en la nube"})
        
    except Exception as e:
        if session:
            session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if session:
            session.close()

# ==============================================================================
# SISTEMA DE NOTIFICACIONES (PING) Y CONTACTOS EN LÍNEA
# ==============================================================================

@tribu_bp.route('/api/<app_slug>/ping/<pin>', methods=['GET', 'OPTIONS'])
def ping_usuario(app_slug, pin):
    """Latido (Heartbeat) del frontend para indicar que el usuario está conectado"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
        
    session = None
    try:
        session = get_db_session(app_slug)
        current_time = int(time.time())
        session.execute(
            text("UPDATE member SET last_active = :time WHERE pin = :pin"),
            {"time": current_time, "pin": pin}
        )
        session.commit()
        return jsonify({"status": "ok"})
    except Exception:
        if session: session.rollback()
        return jsonify({"error": "Falló ping"}), 500
    finally:
        if session: session.close()

@tribu_bp.route('/api/<app_slug>/contactos/<mi_pin>', methods=['GET'])
def obtener_contactos(app_slug, mi_pin):
    """Devuelve la lista de usuarios, mensajes sin leer y estado En Línea"""
    session = None
    try:
        session = get_db_session(app_slug)
        current_time = int(time.time())
        
        # Recuperamos todos menos a nosotros mismos, incluyendo la última vez que abrieron la app
        miembros = session.execute(
            text("SELECT id, nombre, apellido1, pin, last_active FROM member WHERE pin != :pin ORDER BY nombre ASC"),
            {"pin": mi_pin}
        ).mappings().fetchall()
        
        contactos = []
        for m in miembros:
            apellido = m['apellido1'] if m['apellido1'] else ''
            nombre_completo = f"{m['nombre']} {apellido}".strip()
            
            # --- LÓGICA EN LÍNEA ---
            # Si el último 'ping' fue hace menos de 30 segundos, consideramos que está conectado
            last_active = m.get('last_active') or 0
            is_online = (current_time - last_active) < 30
            
            try:
                res = session.execute(
                    text("""
                        SELECT COUNT(*) as no_leidos 
                        FROM chat_message 
                        WHERE sender_pin = :sender AND receiver_pin = :receiver AND is_read = 0
                    """),
                    {"sender": m['pin'], "receiver": mi_pin}
                ).mappings().fetchone()
                no_leidos = res['no_leidos']
            except Exception:
                no_leidos = 0 
                
            contactos.append({
                "pin": m['pin'],
                "nombre": nombre_completo,
                "no_leidos": no_leidos,
                "is_online": is_online  # Se lo pasamos a Javascript
            })
            
        return jsonify({"contactos": contactos})
    except Exception as e:
        print(f"Error cargando contactos para {app_slug}: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if session:
            session.close()

# ==============================================================================

@tribu_bp.route('/api/<app_slug>/admin/usuarios', methods=['GET', 'OPTIONS'])
def admin_obtener_usuarios(app_slug):
    """Devuelve la lista completa de usuarios registrados"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
        
    session = None
    try:
        session = get_db_session(app_slug)
        
        miembros = session.execute(
            text("SELECT id, nombre, apellido1, pin, rol FROM member ORDER BY id ASC")
        ).mappings().fetchall()
        
        usuarios = []
        for index, m in enumerate(miembros, start=1):
            apellido = m['apellido1'] if m['apellido1'] else ''
            
            usuarios.append({
                "consecutivo": index,
                "nombre": m['nombre'],
                "apellido1": apellido,
                "pin": m['pin'],
                "rol": m.get('rol', 'usuario')
            })
            
        return jsonify({"status": "ok", "usuarios": usuarios})
    except Exception as e:
        print(f"Error cargando lista de usuarios admin: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if session:
            session.close()

@tribu_bp.route('/api/<app_slug>/admin/usuario_detalle/<pin>', methods=['GET', 'OPTIONS'])
def admin_usuario_detalle(app_slug, pin):
    """Devuelve absolutamente todos los datos de un usuario para la vista de edición profunda"""
    if request.method == 'OPTIONS': 
        return jsonify({"status": "ok"}), 200
    session = None
    try:
        session = get_db_session(app_slug)
        
        miembro = session.execute(text("SELECT * FROM member WHERE pin = :pin"), {"pin": pin}).mappings().fetchone()
        if not miembro:
            return jsonify({"error": "Usuario no encontrado"}), 404
            
        usuario = session.execute(text("SELECT email FROM user WHERE id = :id"), {"id": miembro['id']}).mappings().fetchone()
        
        return jsonify({
            "status": "ok", 
            "usuario": {
                "nombre": miembro['nombre'],
                "apellido1": miembro['apellido1'],
                "pin": miembro['pin'],
                "puntos": miembro['puntos_totales'],
                "rol": miembro.get('rol', 'usuario'),
                "telefono": miembro.get('telefono') or '',
                "emgNombre": miembro.get('emg_nombre') or '',
                "emgTelefono": miembro.get('emg_telefono') or '',
                "dobDia": str(miembro.get('dob_dia') or ''),
                "dobMes": str(miembro.get('dob_mes') or ''),
                "dobAnio": str(miembro.get('dob_anio') or ''),
                "email": usuario['email'] if usuario else ''
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if session: session.close()

@tribu_bp.route('/api/<app_slug>/admin/editar_usuario', methods=['POST', 'OPTIONS'])
def admin_editar_usuario(app_slug):
    """Actualiza la totalidad de los datos del usuario (Perfil, Configuración y Seguridad)"""
    if request.method == 'OPTIONS': 
        return jsonify({"status": "ok"}), 200
    session = None
    try:
        data = request.json
        session = get_db_session(app_slug)
        
        editor_pin = data.get('editor_pin')
        target_pin = data.get('target_pin', data.get('pin'))

        editor = session.execute(text("SELECT rol FROM member WHERE pin = :pin"), {"pin": editor_pin}).fetchone()
        target_member = session.execute(text("SELECT * FROM member WHERE pin = :pin"), {"pin": target_pin}).mappings().fetchone()

        if not target_member:
            return jsonify({"error": "Usuario destino no encontrado."}), 404

        editor_rol = editor[0] if editor and editor[0] else 'usuario'
        target_id = target_member['id']
        target_rol = target_member.get('rol', 'usuario')
        
        nuevo_rol = data.get('rol', target_rol)

        # 🛡️ REGLAS DE PODER 🛡️
        if editor_rol == 'usuario':
            return jsonify({"error": "No tienes permisos de Administrador."}), 403
        
        if editor_rol == 'admin':
            if target_rol == 'superadmin':
                return jsonify({"error": "No tienes nivel suficiente para editar a un Superusuario."}), 403
            if nuevo_rol == 'superadmin':
                return jsonify({"error": "Solo un Superusuario puede crear a otro Superusuario."}), 403
                
        # --- 1. ACTUALIZAR TABLA MEMBER (Datos Públicos) ---
        nuevo_nombre = data.get('nombre', target_member['nombre'])
        nuevo_apellido = data.get('apellido', target_member['apellido1'])
        nuevo_pin = data.get('nuevo_pin', data.get('pin', target_pin))
        nuevos_puntos = data.get('puntos', target_member['puntos_totales'])
        nuevo_telefono = data.get('telefono', target_member.get('telefono'))
        nuevo_emg_nombre = data.get('emgNombre', target_member.get('emg_nombre'))
        nuevo_emg_telefono = data.get('emgTelefono', target_member.get('emg_telefono'))
        nuevo_dob_dia = data.get('dobDia', target_member.get('dob_dia'))
        nuevo_dob_mes = data.get('dobMes', target_member.get('dob_mes'))
        nuevo_dob_anio = data.get('dobAnio', target_member.get('dob_anio'))
        
        session.execute(
            text("UPDATE member SET nombre = :n, apellido1 = :a, rol = :r, pin = :np, puntos_totales = :pt, telefono = :tel, emg_nombre = :emg_n, emg_telefono = :emg_t, dob_dia = :dd, dob_mes = :dm, dob_anio = :da WHERE id = :id"),
            {
                "n": nuevo_nombre, 
                "a": nuevo_apellido, 
                "r": nuevo_rol, 
                "np": nuevo_pin,
                "pt": nuevos_puntos,
                "tel": nuevo_telefono,
                "emg_n": nuevo_emg_nombre,
                "emg_t": nuevo_emg_telefono,
                "dd": nuevo_dob_dia,
                "dm": nuevo_dob_mes,
                "da": nuevo_dob_anio,
                "id": target_id
            }
        )
        
        # --- 2. ACTUALIZAR TABLA USER (Datos de Seguridad) ---
        nuevo_email = data.get('email')
        nueva_pass = data.get('password')
        
        if nuevo_email:
            session.execute(text("UPDATE user SET email = :e WHERE id = :id"), {"e": nuevo_email, "id": target_id})
            
        if nueva_pass and str(nueva_pass).strip() != '':
            hashed_pw = bcrypt.generate_password_hash(str(nueva_pass).strip()).decode('utf-8')
            session.execute(text("UPDATE user SET password = :p WHERE id = :id"), {"p": hashed_pw, "id": target_id})

        session.commit()
        return jsonify({"status": "ok", "mensaje": "Usuario actualizado completamente"})
    except Exception as e:
        if session: session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if session: session.close()

@tribu_bp.route('/api/<app_slug>/admin/borrar_usuario/<pin>', methods=['DELETE', 'OPTIONS'])
def admin_borrar_usuario(app_slug, pin):
    if request.method == 'OPTIONS': 
        return jsonify({"status": "ok"}), 200
    session = None
    try:
        editor_pin = request.args.get('editor_pin')
        session = get_db_session(app_slug)
        
        editor = session.execute(text("SELECT rol FROM member WHERE pin = :pin"), {"pin": editor_pin}).fetchone()
        editor_rol = editor[0] if editor and editor[0] else 'usuario'
        
        if editor_rol == 'usuario':
            return jsonify({"error": "No tienes permisos de Administrador."}), 403
            
        target = session.execute(text("SELECT id, rol FROM member WHERE pin = :pin"), {"pin": pin}).fetchone()
        if target:
            user_id = target[0]
            target_rol = target[1] if target[1] else 'usuario'
            
            # 🛡️ REGLA: Admin no borra Superadmin 🛡️
            if editor_rol == 'admin' and target_rol == 'superadmin':
                return jsonify({"error": "Acceso Denegado: Imposible borrar a un Superusuario."}), 403
                
            session.execute(text("DELETE FROM member WHERE id = :id"), {"id": user_id})
            session.execute(text("DELETE FROM user WHERE id = :id"), {"id": user_id})
            session.commit()
            return jsonify({"status": "ok"})
        else:
            return jsonify({"error": "Usuario no encontrado"}), 404
            
    except Exception as e:
        if session: session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if session: session.close()

@tribu_bp.route('/descargas_ota/<path:filename>')
def descargar_ota(filename):
    """Sirve los archivos ZIP de actualización desde la carpeta protegida"""
    response = make_response(send_from_directory(BASE_UPDATE_PATH, filename))
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    return response

@tribu_bp.route('/api/<app_slug>/check_update', methods=['GET', 'OPTIONS'])
def check_update(app_slug):
    """Endpoint para que el Frontend sepa si hay una nueva versión de HTML/CSS/JS"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    try:
        zip_path = os.path.join(BASE_UPDATE_PATH, 'www.zip')
        
        file_timestamp = "0"
        if os.path.exists(zip_path):
            file_timestamp = str(int(os.path.getmtime(zip_path)))

        archivos_modificados = [
            "Optimizaciones en la interfaz gráfica",
            "Mejoras de rendimiento y seguridad",
            "Nuevas funciones activadas"
        ]

        update_data = {
            "status": "ok",
            "version": "2.0.0", 
            "timestamp": file_timestamp,
            "archivos": archivos_modificados,
            "url": "https://kenth1977.pythonanywhere.com/descargas_ota/www.zip"
        }
        
        return jsonify(update_data), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500