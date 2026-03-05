# ==============================================================================
# ARCHIVO: chat.py
# ROL: EL HIJO
# DESCRIPCIÓN: Micro-módulo anidado en tribu.py, maneja la mensajería interna.
# ==============================================================================

import os
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename

# Este es el blueprint hijo, que se registra dentro de tribu_bp
chat_bp = Blueprint('chat_api', __name__)

# --- CONFIGURACIÓN ---
BASE_DB_PATH = '/home/kenth1977/myDBs/DBs'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp3', 'wav', 'pdf', 'docx', 'txt'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_chat_db_path(app_slug):
    safe_slug = "".join([c for c in app_slug if c.isalnum()])
    return os.path.join(BASE_DB_PATH, f"{safe_slug}.db")

def _init_chat_table(cursor):
    """Inicializa y parchea la tabla si es necesario (Auto-Patch)"""
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT,
            sender_pin TEXT,
            receiver_pin TEXT,
            texto TEXT,
            file_path TEXT,
            file_type TEXT,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Parche de seguridad para asegurar columnas en DBs existentes
    try:
        cursor.execute("ALTER TABLE chat_message ADD COLUMN sender_pin TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE chat_message ADD COLUMN receiver_pin TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE chat_message ADD COLUMN is_read INTEGER DEFAULT 0")
    except: pass
    try:
        cursor.execute("UPDATE chat_message SET sender_pin = pin WHERE sender_pin IS NULL")
    except: pass

# ==============================================================================
# RUTAS DE CHAT
# ==============================================================================

@chat_bp.route('/api/<app_slug>/chat/<mi_pin>/<otro_pin>', methods=['GET'])
def obtener_mensajes_privados(app_slug, mi_pin, otro_pin):
    db_path = get_chat_db_path(app_slug)
    if not os.path.exists(db_path):
        return jsonify([])

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        _init_chat_table(cursor)

        # Marcar como leídos los mensajes que recibo de la otra persona
        cursor.execute('''
            UPDATE chat_message SET is_read = 1 
            WHERE receiver_pin = ? AND sender_pin = ? AND is_read = 0
        ''', (mi_pin, otro_pin))
        conn.commit()

        cursor.execute('''
            SELECT * FROM chat_message 
            WHERE (sender_pin = ? AND receiver_pin = ?) 
               OR (sender_pin = ? AND receiver_pin = ?)
            ORDER BY created_at DESC LIMIT 100
        ''', (mi_pin, otro_pin, otro_pin, mi_pin))
        
        rows = cursor.fetchall()
        conn.close()
        
        mensajes = [dict(row) for row in rows]
        mensajes.reverse() # Orden cronológico para el chat
        
        for m in mensajes:
            if m.get('created_at'):
                try:
                    # Intento de formateo avanzado de fecha
                    dt = datetime.strptime(m['created_at'], '%Y-%m-%d %H:%M:%S')
                    m['fecha'] = dt.strftime('%H:%M')
                    m['fecha_larga'] = dt.strftime('%d/%m/%Y %H:%M')
                except:
                    # Fallback si el formato difiere
                    m['fecha'] = str(m['created_at'])[-8:-3]
                    m['fecha_larga'] = str(m['created_at'])
        return jsonify(mensajes)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/api/<app_slug>/chat/enviar', methods=['POST', 'OPTIONS'])
def enviar_mensaje(app_slug):
    # Manejo de CORS Preflight
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    db_path = get_chat_db_path(app_slug)
    if not os.path.exists(db_path):
        return jsonify({"error": "Base de datos no encontrada"}), 404

    try:
        nombre = request.form.get('nombre')
        sender_pin = request.form.get('sender_pin')
        receiver_pin = request.form.get('receiver_pin')
        texto = request.form.get('texto')
        
        file_url = None
        f_type = None

        if 'file' in request.files:
            file = request.files['file']
            if file and allowed_file(file.filename):
                filename = secure_filename(f"{app_slug}_{datetime.now().timestamp()}_{file.filename}")
                upload_path = os.path.join(current_app.root_path, 'static', 'uploads', 'chat')
                if not os.path.exists(upload_path): os.makedirs(upload_path)
                
                file.save(os.path.join(upload_path, filename))
                file_url = f"/static/uploads/chat/{filename}"
                
                ext = filename.rsplit('.', 1)[1].lower()
                if ext in ['png', 'jpg', 'jpeg', 'gif']: f_type = 'image'
                elif ext in ['mp3', 'wav']: f_type = 'audio'
                else: f_type = 'doc'

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        _init_chat_table(cursor)
        
        cursor.execute('''
            INSERT INTO chat_message (nombre, sender_pin, receiver_pin, texto, file_path, file_type, is_read)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        ''', (nombre, sender_pin, receiver_pin, texto, file_url, f_type))
        
        conn.commit()
        conn.close()
        
        return jsonify({"status": "ok", "file_url": file_url})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/api/<app_slug>/chat/unread/<mi_pin>', methods=['GET'])
def notificaciones_globales(app_slug, mi_pin):
    """Devuelve la cantidad total de mensajes sin leer en toda la app"""
    db_path = get_chat_db_path(app_slug)
    if not os.path.exists(db_path): return jsonify({"total_unread": 0})
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        _init_chat_table(cursor)
        cursor.execute('SELECT COUNT(*) FROM chat_message WHERE receiver_pin = ? AND is_read = 0', (mi_pin,))
        total = cursor.fetchone()[0]
        conn.close()
        return jsonify({"total_unread": total})
    except:
        return jsonify({"total_unread": 0})

# --- RUTAS DE ELIMINACIÓN Y LIMPIEZA CON SOPORTE CORS ---

@chat_bp.route('/api/<app_slug>/chat/mensaje/<int:msg_id>', methods=['DELETE', 'OPTIONS'])
def borrar_mensaje(app_slug, msg_id):
    """Borra un mensaje específico para todos los usuarios"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
        
    db_path = get_chat_db_path(app_slug)
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM chat_message WHERE id = ?', (msg_id,))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/api/<app_slug>/chat/limpiar', methods=['POST', 'OPTIONS'])
def limpiar_chat(app_slug):
    """Borra toda la conversación entre dos personas"""
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
        
    db_path = get_chat_db_path(app_slug)
    try:
        data = request.get_json()
        mi_pin = data.get('mi_pin')
        otro_pin = data.get('otro_pin')
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute('''
            DELETE FROM chat_message 
            WHERE (sender_pin = ? AND receiver_pin = ?) 
               OR (sender_pin = ? AND receiver_pin = ?)
        ''', (mi_pin, otro_pin, otro_pin, mi_pin))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500