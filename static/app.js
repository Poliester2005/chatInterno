const logEl = document.getElementById("log");
const msgEl = document.getElementById("msg");
const sendBtn = document.getElementById("send");

const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const moreBtn = document.getElementById("moreBtn");
const metaEl = document.getElementById("meta");

const overlay = document.getElementById("overlay");
const usernameInput = document.getElementById("usernameInput");
const usernameBtn = document.getElementById("usernameBtn");
const hintEl = document.getElementById("hint");
const roomsEl = document.getElementById("rooms");
const refreshRoomsBtn = document.getElementById("refreshRoomsBtn");

let currentUsername = null;
let currentRoom = null;
let oldestId = null; // usado para paginação
let hasMore = false;
let roomsList = [];

function now() {
  return new Date().toLocaleTimeString();
}

function setMeta() {
  metaEl.textContent = currentRoom
    ? `| sala atual: ${currentRoom} | oldestId: ${oldestId ?? "-"} | hasMore: ${hasMore}`
    : `| nenhuma sala selecionada`;
}

function appendLine(line) {
  logEl.textContent += `[${now()}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog(title) {
  logEl.textContent = "";
  if (title) appendLine(title);
}

function renderRooms(rooms) {
  roomsList = rooms || [];
  if (roomsList.length === 0) {
    roomsEl.innerHTML = '<div style="padding: 12px; color: #999; text-align: center;">Nenhuma sala ainda</div>';
    return;
  }
  
  roomsEl.innerHTML = roomsList.map(r => {
    const isActive = r.room === currentRoom ? 'active' : '';
    return `
      <div class="room-item ${isActive}" data-room="${r.room}">
        <div class="room-name">${r.room}</div>
        <div class="room-stats">${r.total_msgs} mensagens</div>
      </div>
    `;
  }).join('');
  
  // Add click handlers
  document.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', () => {
      const room = item.dataset.room;
      roomInput.value = room;
      joinRoom();
    });
  });
}

function openUsernameModal(msg) {
  overlay.style.display = "flex";
  hintEl.textContent = msg || "";
  setTimeout(() => usernameInput.focus(), 50);
}

function closeUsernameModal() {
  overlay.style.display = "none";
  hintEl.textContent = "";
}

// Socket connect
const socket = io(window.location.origin + "/chat", {
  transports: ["websocket", "polling"],
  withCredentials: true,
});

socket.on("connect", () => {
  appendLine("✅ conectado");
  socket.emit("list_rooms");
});

socket.on("disconnect", (r) => {
  appendLine(`⚠️ desconectado: ${r}`);
  sendBtn.disabled = true;
  leaveBtn.disabled = true;
  moreBtn.disabled = true;
});

socket.on("connected", (payload) => {
  const u = payload?.username;
  if (u) {
    currentUsername = u;
    closeUsernameModal();
    sendBtn.disabled = !currentRoom; // só habilita se tiver sala
    appendLine(`👤 username na sessão: ${u}`);
  } else {
    openUsernameModal("Informe um username para entrar.");
  }
});

socket.on("username_set", (payload) => {
  currentUsername = payload.username;
  closeUsernameModal();
  appendLine(`👤 username definido: ${currentUsername}`);
  sendBtn.disabled = !currentRoom;
});

socket.on("joined", (payload) => {
  currentRoom = payload.room;
  leaveBtn.disabled = false;
  sendBtn.disabled = false;
  appendLine(`📌 entrou na sala: ${currentRoom}`);
  renderRooms(roomsList); // Update active room highlight
  setMeta();
});

socket.on("left", (payload) => {
  appendLine(`👋 saiu da sala: ${payload.room}`);
  if (currentRoom === payload.room) {
    currentRoom = null;
    oldestId = null;
    hasMore = false;
    sendBtn.disabled = true;
    leaveBtn.disabled = true;
    moreBtn.disabled = true;
    setMeta();
  }
});

// Histórico inicial da sala
socket.on("history", (payload) => {
  if (!payload || payload.room !== roomInput.value.trim()) {
    // pode acontecer se você trocar rápido de sala
  }
  const room = payload.room;
  const msgs = payload.messages || [];

  clearLog(`📜 histórico da sala "${room}" (${msgs.length} msgs)`);
  oldestId = msgs.length ? msgs[0].id : null; // como vêm em ordem cronológica, o 1º é o mais antigo do lote
  hasMore = !!payload.has_more;

  for (const m of msgs) {
    appendLine(`${m.username}: ${m.text}`);
  }

  moreBtn.disabled = !hasMore;
  setMeta();
});

// Página extra (mensagens mais antigas)
socket.on("more_messages", (payload) => {
  const room = payload.room;
  if (room !== currentRoom) return;

  const msgs = payload.messages || [];
  if (msgs.length === 0) {
    hasMore = false;
    moreBtn.disabled = true;
    setMeta();
    return;
  }

  // Inserir no topo: para simplificar em "texto puro", vamos reconstruir o log.
  // Para UI real, você renderizaria elementos no DOM e inseriria no topo.
  const existing = logEl.textContent.split("\n").filter(Boolean);
  const header = existing[0]; // primeira linha (título)
  const rest = existing.slice(1);

  const newLines = [];
  for (const m of msgs) {
    newLines.push(`[${now()}] ${m.username}: ${m.text}`);
  }

  // atualizar oldestId e hasMore
  oldestId = msgs[0].id; // lote vem cronológico, 0 é o mais antigo do lote
  hasMore = !!payload.has_more;
  moreBtn.disabled = !hasMore;

  // recria
  logEl.textContent =
    header + "\n" + newLines.join("\n") + "\n" + rest.join("\n") + "\n";
  setMeta();
});

// Mensagens novas
socket.on("message", (payload) => {
  if (payload.room !== currentRoom) return;
  appendLine(`${payload.username}: ${payload.text}`);
});

socket.on("error", (payload) => {
  const msg = payload?.data ?? "Erro";
  appendLine(`❌ ${msg}`);
  if (!currentUsername) openUsernameModal(msg);
});

// Rooms list events
socket.on("rooms_list", (payload) => {
  console.log("Received rooms_list:", payload);
  renderRooms(payload?.rooms);
});

socket.on("rooms_update", (payload) => {
  console.log("Received rooms_update:", payload);
  renderRooms(payload?.rooms);
});

// UI actions
function submitUsername() {
  const u = usernameInput.value.trim();
  if (!u) {
    hintEl.textContent = "Username não pode ser vazio.";
    return;
  }
  socket.emit("set_username", { username: u });
}

function joinRoom() {
  const room = (roomInput.value || "geral").trim() || "geral";

  if (!currentUsername) {
    openUsernameModal("Defina um username antes de entrar.");
    return;
  }

  // Se já está em outra sala, sai dela primeiro
  if (currentRoom && currentRoom !== room) {
    socket.emit("leave", { room: currentRoom });
  }

  // Reset paginação
  oldestId = null;
  hasMore = false;
  moreBtn.disabled = true;
  clearLog(`⏳ carregando sala "${room}"...`);

  socket.emit("join", { room, limit: 50 });
  setMeta();
}

function leaveRoom() {
  if (!currentRoom) return;
  socket.emit("leave", { room: currentRoom });
}

function loadMore() {
  if (!currentRoom || !oldestId) return;
  socket.emit("load_more", {
    room: currentRoom,
    before_id: oldestId,
    limit: 50,
  });
}

function sendMessage() {
  if (!currentRoom) return;
  const text = msgEl.value.trim();
  if (!text) return;
  socket.emit("message", { room: currentRoom, text });
  msgEl.value = "";
  msgEl.focus();
}

joinBtn.addEventListener("click", joinRoom);
leaveBtn.addEventListener("click", leaveRoom);
moreBtn.addEventListener("click", loadMore);

sendBtn.addEventListener("click", sendMessage);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

usernameBtn.addEventListener("click", submitUsername);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitUsername();
});

refreshRoomsBtn.addEventListener("click", () => {
  socket.emit("list_rooms");
});

openUsernameModal("Conectando...");
setMeta();
