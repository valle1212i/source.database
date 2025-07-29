console.log("🔌 Försöker ansluta till Socket.IO...");

const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://source-database.onrender.com";

const socket = io(BASE_URL, {
  transports: ["websocket"],
  withCredentials: true
});

socket.on("connect", () => {
  console.log("✅ Ansluten till Socket.IO:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("❌ Socket.IO-fel:", err.message || err);
});

socket.on("disconnect", (reason) => {
  console.warn("⚠️ Frånkopplad:", reason);
});

let input, chatBox;
const sessionId = sessionStorage.getItem("activeChatSessionId") || Date.now().toString();
sessionStorage.setItem("activeChatSessionId", sessionId);
window.activeChatSessionId = sessionId;

window.addEventListener("DOMContentLoaded", async () => {
  input = document.getElementById("chatInput");
  chatBox = document.getElementById("chatMessages");

  if (!input || !chatBox) {
    console.error("❌ Saknar chatInput eller chatMessages i DOM.");
    return;
  }

  document.getElementById("chatForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  try {
    const res = await fetch(`${BASE_URL}/api/profile/me`, { credentials: "include" });
    if (!res.ok) throw new Error("Ej inloggad");

    const customer = await res.json();
    window.customerId = customer._id;

    await startChatSession();
    await loadHistory();
    await maybeSendWelcomeMessage();

  } catch (err) {
    console.error("❌ Fel vid initiering:", err.message);
    alert("❌ Du måste vara inloggad för att använda chatten.");
  }
});

function sendMessage() {
  const text = input.value.trim();
  if (!text || !window.customerId) return;

  const msg = {
    message: text,
    sender: "customer",
    timestamp: new Date(),
    sessionId: window.activeChatSessionId,
    customerId: window.customerId
  };

  socket.emit("sendMessage", msg);
  input.value = "";

  fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
    credentials: "include"
  }).catch(err => {
    console.error("❌ Kunde inte spara meddelande:", err);
  });
}

socket.on("newMessage", (msg) => {
  renderMessage(msg);
});

function renderMessage(msg) {
  const div = document.createElement("div");
  div.className = msg.sender === "admin" ? "message admin" : "message customer";

  const name = document.createElement("strong");
  name.textContent = msg.sender === "admin" ? "Support: " : "Du: ";

  const content = document.createElement("span");
  content.textContent = msg.message;

  const time = document.createElement("small");
  const t = new Date(msg.timestamp);
  time.textContent = isNaN(t) ? "Okänt datum" : t.toLocaleString("sv-SE");

  div.append(name, content, document.createElement("br"), time);
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function startChatSession() {
  console.log("🟢 Chattsession initierad:", window.activeChatSessionId, "för kund:", window.customerId);
}

async function loadHistory() {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/customer/me?sessionId=${window.activeChatSessionId}`, {
      credentials: "include"
    });
    const history = await res.json();
    if (!Array.isArray(history)) throw new Error("Felaktigt svar från servern");
    history.forEach(renderMessage);
  } catch (err) {
    console.error("❌ Kunde inte hämta historik:", err.message);
  }
}

async function maybeSendWelcomeMessage() {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/customer/me?sessionId=${window.activeChatSessionId}`, {
      credentials: "include"
    });
    const messages = await res.json();

    const alreadyWelcomed = messages.some(
      m => m.sender === "admin" && m.message.includes("välkommen")
    );

    if (!alreadyWelcomed) {
      const welcome = {
        message: "Hej och välkommen till Source livechat! Vi hjälper dig så snart vi kan 🙌",
        sender: "admin",
        timestamp: new Date(),
        sessionId: window.activeChatSessionId,
        customerId: window.customerId
      };

      socket.emit("sendMessage", welcome);

      fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(welcome)
      });
    }
  } catch (err) {
    console.warn("⚠️ Kunde inte kontrollera välkomstmeddelande:", err.message);
  }
}
