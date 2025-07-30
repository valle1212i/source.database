console.log("🔌 Försöker ansluta till Socket.IO...");

const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://admin-portal-rn5z.onrender.com";

// ✅ Socket.IO med fallback: websocket + polling
const socket = io(BASE_URL, {
  transports: ["websocket", "polling"],
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

// 🧠 Session-ID
let input, chatBox;
const sessionId = sessionStorage.getItem("activeChatSessionId") || Date.now().toString();
sessionStorage.setItem("activeChatSessionId", sessionId);
window.activeChatSessionId = sessionId;

let customerData = {
  topic: "",
  description: ""
};

const questions = [
  {
    key: "topic",
    text: "Vad gäller ärendet?",
    type: "text"
  },
  {
    key: "description",
    text: "Ge en kort beskrivning om problemet så kommer vi snart att assistera dig:",
    type: "textarea",
    maxLength: 300
  }
];

let currentQuestionIndex = 0;
let questionPhaseComplete = false;

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
    sendMessage(userInput);
  });

  showNextQuestion();
});

function showNextQuestion() {
  const flow = document.getElementById("questionFlow");
  flow.innerHTML = "";

  if (currentQuestionIndex < questions.length) {
    const q = questions[currentQuestionIndex];

    const label = document.createElement("label");
    label.textContent = q.text;

    let inputElement;
    if (q.type === "textarea") {
      inputElement = document.createElement("textarea");
      inputElement.maxLength = q.maxLength;
      inputElement.rows = 4;
      inputElement.placeholder = "Max 300 tecken...";
    } else {
      inputElement = document.createElement("input");
      inputElement.type = "text";
      inputElement.placeholder = "Skriv här...";
    }

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Nästa";
    nextBtn.type = "button";

    nextBtn.addEventListener("click", () => {
      const val = inputElement.value.trim();
      if (!val) {
        inputElement.classList.add("input-error");
        return;
      }
      customerData[q.key] = val;

      const msg = {
        message: val,
        sender: "customer",
        timestamp: new Date(),
        sessionId: window.activeChatSessionId,
        customerId: "pre-chat"
      };
      renderMessage(msg);

      currentQuestionIndex++;
      showNextQuestion();
    });

    flow.appendChild(label);
    flow.appendChild(inputElement);
    flow.appendChild(nextBtn);
    inputElement.focus();
  } else {
    document.querySelector(".chat-intro").classList.add("hidden");
    document.getElementById("chatArea").classList.remove("hidden");
    document.getElementById("chatForm").classList.remove("hidden");
    input.value = "";
    questionPhaseComplete = true;
    initChat();
  }
}

async function initChat() {
  try {
    const res = await fetch("/api/customers/me", { credentials: "include" });
    if (!res.ok) throw new Error("Ej inloggad");

    const customer = await res.json();
    window.customerId = customer._id;

    await startChatSession();
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

  input.value = "";

  socket.emit("sendMessage", msg);
  console.log("📤 Meddelande skickat via Socket.IO:", msg);

  fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
    credentials: "include"
  })
    .then(res => res.json())
    .then(data => console.log("✅ Sparat till /api/chat:", data))
    .catch(err => {
      console.error("❌ Kunde inte spara meddelande:", err);
    });
}

socket.on("newMessage", (msg) => {
  renderMessage(msg);
});

function renderMessage(msg) {
  const div = document.createElement("div");
  div.className = msg.sender === "admin" ? "message admin"
               : msg.sender === "system" ? "message system"
               : "message customer";

  const name = document.createElement("strong");
  name.textContent =
    msg.sender === "admin" ? "Support: "
  : msg.sender === "system" ? "System: "
  : "Du: ";

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
  console.log("🟢 Chattsession startad:", window.activeChatSessionId);

  const sessionPayload = {
    sessionId: window.activeChatSessionId,
    customerId: window.customerId,
    topic: customerData.topic?.trim() || "Ej angivet",
    description: customerData.description?.trim() || "Ej angivet"
  };

  socket.emit("newSession", sessionPayload);
  console.log("📤 newSession skickad till adminportalen:", sessionPayload);
}

async function maybeSendWelcomeMessage() {
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
  })
    .then(res => res.json())
    .then(data => console.log("✅ Välkomstmeddelande sparat:", data))
    .catch(err => {
      console.error("❌ Kunde inte spara välkomstmeddelande:", err);
    });
}
