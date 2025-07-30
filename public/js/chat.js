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

let customerData = {
  name: "",
  topic: "",
};

const questions = [
  { key: "name", text: "Vad heter du?" },
  { key: "topic", text: "Vad gäller ditt ärende?" }
];
let currentQuestionIndex = 0;

window.addEventListener("DOMContentLoaded", async () => {
  input = document.getElementById("chatInput");
  chatBox = document.getElementById("chatMessages");

  if (!input || !chatBox) {
    console.error("❌ Saknar chatInput eller chatMessages i DOM.");
    return;
  }

  document.getElementById("chatForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const userInput = input.value.trim();
    if (!userInput) return;

    if (currentQuestionIndex < questions.length) {
      const key = questions[currentQuestionIndex].key;
      customerData[key] = userInput;

      renderMessage({ sender: "customer", message: userInput, timestamp: new Date() });
      currentQuestionIndex++;
      input.value = "";
      showNextQuestion();
    } else {
      sendMessage(userInput);
    }
  });

  showNextQuestion(); // 👉 startar frågeflödet
});

function showNextQuestion() {
  if (currentQuestionIndex < questions.length) {
    const q = questions[currentQuestionIndex];
    renderMessage({ sender: "system", message: q.text, timestamp: new Date() });
  } else {
    document.querySelector(".chat-intro").classList.add("hidden");
    document.getElementById("chatArea").classList.remove("hidden");
    initChat(); // startar socket, hämtar historik, osv.
  }
}

async function initChat() {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/me`, { credentials: "include" });
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
}

function sendMessage(text) {
  if (!text || !window.customerId) return;

  const msg = {
    message: text,
    sender: "customer",
    timestamp: new Date(),
    sessionId: window.activeChatSessionId,
    customerId: window.customerId
  };

  socket.emit("sendMessage", msg);
  renderMessage(msg);
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
  div.className = msg.sender === "admin" ? "message admin" : msg.sender === "system" ? "message system" : "message customer";

  const name = document.createElement("strong");
  name.textContent =
    msg.sender === "admin" ? "Support: " :
    msg.sender === "system" ? "System: " : "Du: ";

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
