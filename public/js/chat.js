console.log("\ud83d\udd0c F\u00f6rs\u00f6ker ansluta till Socket.IO...");

const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://source-database.onrender.com";

const socket = io(BASE_URL, {
  transports: ["websocket"],
  withCredentials: true
});

socket.on("connect", () => {
  console.log("\u2705 Ansluten till Socket.IO:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("\u274c Socket.IO-fel:", err.message || err);
});

socket.on("disconnect", (reason) => {
  console.warn("\u26a0\ufe0f Fr\u00e5nkopplad:", reason);
});

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
    text: "Vad g\u00e4ller \u00e4rendet?",
    type: "text"
  },
  {
    key: "description",
    text: "Ge en kort beskrivning om problemet s\u00e5 kommer vi snart att assistera dig:",
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
    console.error("\u274c Saknar chatInput eller chatMessages i DOM.");
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
      inputElement.placeholder = "Skriv h\u00e4r...";
    }

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "N\u00e4sta";
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
    const res = await fetch(`${BASE_URL}/api/customers/me`, { credentials: "include" });
    if (!res.ok) throw new Error("Ej inloggad");

    const customer = await res.json();
    window.customerId = customer._id;

    await startChatSession();
    await maybeSendWelcomeMessage();
  } catch (err) {
    console.error("\u274c Fel vid initiering:", err.message);
    alert("\u274c Du m\u00e5ste vara inloggad f\u00f6r att anv\u00e4nda chatten.");
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

  // ❌ TA BORT detta — vi ska inte rendera direkt längre:
  // renderMessage(msg);

  input.value = "";

  // Emit & spara
  socket.emit("sendMessage", msg);

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
  time.textContent = isNaN(t) ? "Ok\u00e4nt datum" : t.toLocaleString("sv-SE");

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

  // ✅ Skicka till adminportalen (via Socket.IO)
  socket.emit("newSession", sessionPayload);

  // ✅ Logga för felsökning
  console.log("📤 newSession skickad till adminportalen:", sessionPayload);
}



async function maybeSendWelcomeMessage() {
  const welcome = {
    message: "Hej och v\u00e4lkommen till Source livechat! Vi hj\u00e4lper dig s\u00e5 snart vi kan \ud83d\ude4c",
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
