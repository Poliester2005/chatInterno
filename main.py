from flask import Flask, session, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import sqlite3
from datetime import datetime

app = Flask(__name__)
app.secret_key = "your_secret_key"
socketio = SocketIO(app, cors_allowed_origins="*")

DB_PATH = "chat.db"


# -------------------------
# DB helpers
# -------------------------
def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Inicializa o banco de dados com as tabelas necessárias."""
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room TEXT NOT NULL,
            username TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room, id)")
    conn.commit()
    conn.close()
    print(f"✅ Banco de dados inicializado: {DB_PATH}")


def ensure_db_initialized():
    """Garante que o banco de dados está inicializado."""
    conn = db_conn()
    cur = conn.cursor()
    # Verifica se a tabela existe
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
    )
    if not cur.fetchone():
        conn.close()
        print("⚠️ Tabela não encontrada. Inicializando banco de dados...")
        init_db()
    else:
        conn.close()


def save_message(room: str, username: str, text: str):
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO messages (room, username, text, created_at) VALUES (?, ?, ?, ?)",
        (room, username, text, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def get_messages_page(room: str, limit: int = 50, before_id: int | None = None):
    """
    Retorna uma página de mensagens mais recentes.
    - Se before_id for None: pega as últimas 'limit' mensagens.
    - Se before_id tiver valor: pega mensagens com id < before_id.
    Retorno: (msgs_em_ordem_cronologica, has_more)
    """
    conn = db_conn()
    cur = conn.cursor()

    if before_id is None:
        cur.execute(
            """
            SELECT id, room, username, text, created_at
            FROM messages
            WHERE room = ?
            ORDER BY id DESC
            LIMIT ?
        """,
            (room, limit),
        )
    else:
        cur.execute(
            """
            SELECT id, room, username, text, created_at
            FROM messages
            WHERE room = ?
              AND id < ?
            ORDER BY id DESC
            LIMIT ?
        """,
            (room, before_id, limit),
        )

    rows = cur.fetchall()

    # Descobrimos se existe mais:
    if rows:
        oldest_id = rows[-1]["id"]  # ainda em DESC aqui
        cur.execute(
            """
            SELECT 1
            FROM messages
            WHERE room = ?
              AND id < ?
            LIMIT 1
        """,
            (room, oldest_id),
        )
        has_more = cur.fetchone() is not None
    else:
        has_more = False

    conn.close()

    # rows estão em DESC, vamos inverter para exibir do mais antigo ao mais novo
    msgs = [dict(r) for r in rows][::-1]
    return msgs, has_more


# -------------------------
# HTTP route
# -------------------------
@app.route("/")
def index():
    return render_template("teste.html")


# -------------------------
# Socket.IO events
# -------------------------
@socketio.on("connect", namespace="/chat")
def on_connect():
    # Apenas informa o username atual (se houver)
    emit("connected", {"username": session.get("username")}, namespace="/chat")


@socketio.on("set_username", namespace="/chat")
def set_username(payload):
    username = (payload or {}).get("username", "").strip()
    if not username:
        emit("error", {"data": "Username não pode ser vazio."}, namespace="/chat")
        return
    if len(username) > 24:
        emit("error", {"data": "Username muito longo (máx 24)."}, namespace="/chat")
        return

    session["username"] = username
    session.permanent = True
    emit("username_set", {"username": username}, namespace="/chat")


@socketio.on("join", namespace="/chat")
def on_join(payload):
    """
    payload: { room: "geral", limit: 50 }
    """
    ensure_db_initialized()
    
    room = (payload or {}).get("room", "geral").strip() or "geral"
    limit = int((payload or {}).get("limit", 50))

    # Opcional: se quiser forçar um padrão de nomes de sala:
    # room = room.lower()

    join_room(room)

    msgs, has_more = get_messages_page(room=room, limit=limit, before_id=None)

    # Envia histórico inicial desta sala para quem entrou
    emit(
        "history",
        {"room": room, "messages": msgs, "has_more": has_more},
        namespace="/chat",
    )

    # Confirma entrada
    emit("joined", {"room": room}, namespace="/chat")


@socketio.on("leave", namespace="/chat")
def on_leave(payload):
    room = (payload or {}).get("room", "").strip()
    if room:
        leave_room(room)
        emit("left", {"room": room}, namespace="/chat")


@socketio.on("load_more", namespace="/chat")
def on_load_more(payload):
    """
    payload: { room: "geral", before_id: 123, limit: 50 }
    """
    room = (payload or {}).get("room", "geral").strip() or "geral"
    before_id = (payload or {}).get("before_id")
    limit = int((payload or {}).get("limit", 50))

    if before_id is None:
        emit(
            "error",
            {"data": "before_id é obrigatório para paginação."},
            namespace="/chat",
        )
        return

    try:
        before_id = int(before_id)
    except ValueError:
        emit("error", {"data": "before_id inválido."}, namespace="/chat")
        return

    msgs, has_more = get_messages_page(room=room, limit=limit, before_id=before_id)

    emit(
        "more_messages",
        {"room": room, "messages": msgs, "has_more": has_more},
        namespace="/chat",
    )


def get_rooms(limit: int = 100):
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            room,
            COUNT(*) as total_msgs,
            MAX(id) as last_id,
            MAX(created_at) as last_at
        FROM messages
        GROUP BY room
        ORDER BY last_id DESC
        LIMIT ?
    """,
        (limit,),
    )
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@socketio.on("list_rooms", namespace="/chat")
def on_list_rooms(payload=None):
    """Lista todas as salas disponíveis."""
    ensure_db_initialized()
    rooms = get_rooms(limit=200)
    emit("rooms_list", {"rooms": rooms}, namespace="/chat")


@socketio.on("message", namespace="/chat")
def on_message(payload):
    """
    payload esperado: { room: "geral", text: "..." }
    Envia mensagem para a sala e atualiza lista de salas.
    """
    username = session.get("username", "Anônimo")
    room = (payload or {}).get("room", "geral").strip() or "geral"
    text = ((payload or {}).get("text", "") or "").strip()

    if not text:
        return
    if len(text) > 1000:
        emit(
            "error",
            {"data": "Mensagem muito longa (máx 1000 caracteres)."},
            namespace="/chat",
        )
        return

    save_message(room, username, text)

    # 1) Mensagem para a sala
    emit(
        "message",
        {
            "room": room,
            "username": username,
            "text": text,
            "created_at": datetime.utcnow().isoformat(),
        },
        namespace="/chat",
        room=room,
    )

    # 2) Atualiza lista de salas para todos
    rooms = get_rooms(limit=200)
    emit("rooms_update", {"rooms": rooms}, namespace="/chat", broadcast=True)


# -------------------------
# Run app
# -------------------------
if __name__ == "__main__":
    init_db()
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)