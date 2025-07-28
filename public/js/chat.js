console.log("🔌 Försöker ansluta till Socket.IO...");

// 🌐 Dynamisk BASE_URL beroende på om det körs lokalt eller i produktion
const BASE_URL = window.location.hostname.includes("localhost")
  ? "http://localhost:3000"
  : "https://source-database.onrender.com";

const socket = io(BASE_URL, {
  transports: ["websocket"],
  withCredentials: true
});

// Socket.io-händelser
socket.on("connect", () => {
  console.log("✅ Ansluten till Socket.IO som kund. Socket-ID:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("❌ Kunde inte ansluta till Socket.IO:", err.message || err);
});

socket.on("disconnect", (reason) => {
  console.warn("⚠️ Socket.IO frånkopplad:", reason);
});

let customerId = null;
let customerName = "Du";
let input, chatBox;
let sessionStartTime = new Date();
let sessionId = sessionStorage.getItem("activeChatSessionId") || Date.now().toString();
sessionStorage.setItem("activeChatSessionId", sessionId);
window.activeChatSessionId = sessionId;

const questions = [
  { label: "Vad gäller ditt ärende?", type: "text", name: "subject", placeholder: "Ex: Faktura, Leverans, Konto" },
  { label: "Hur brådskande är det?", type: "select", name: "urgency", options: ["Låg", "Medel", "Hög"] },
  { label: "Vill du bli kontaktad via e-post eller telefon?", type: "text", name: "preferredContact", placeholder: "Ex: Telefon, E-post" }
];

const answers = {};
let currentQuestionIndex = 0;

function notifyAdminOfNewSession(customerId, sessionId) {
  const systemMsg = {
    customerId,
    sessionId,
    message: "🔔 Ny chatt startad",
    sender: "system",
    timestamp: new Date()
  };

  console.log("📤 Skickar systemmeddelande:", systemMsg);
  socket.emit("sendMessage", systemMsg);

  fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(systemMsg)
  }).catch(err => {
    console.error("❌ Kunde inte skicka systemmeddelande:", err);
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  const chatWrapper = document.querySelector(".chat-wrapper");

  if (localStorage.getItem("chatHidden") !== "true") {
    chatWrapper?.classList.remove("hidden");
  }

  document.querySelector(".close-chat")?.addEventListener("click", () => {
    chatWrapper?.classList.add("hidden");
    localStorage.setItem("chatHidden", "true");
  });

  try {
    const form = document.getElementById("chatForm");
    input = document.getElementById("chatInput");
    chatBox = document.getElementById("chatMessages");

    if (!form || !input || !chatBox) {
      console.error("❌ chatForm, chatInput eller chatMessages saknas i DOM.");
      return;
    }

    const res = await fetch(`${BASE_URL}/api/auth/me`, { credentials: "include" });
    if (!res.ok) throw new Error("Kunde inte hämta användare");
    const data = await res.json();
    window.customerId = data._id;
  } catch (err) {
    alert("❌ Kunde inte hämta inloggad användare. Är du inloggad?");
    console.error(err);
  }

  document.getElementById("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  showNextQuestion();
});

function showNextQuestion() {
  const chatIntro = document.querySelector(".chat-intro");
  const chatArea = document.getElementById("chatArea");
  const questionFlow = document.getElementById("questionFlow");

  if (!questionFlow) return;

  questionFlow.innerHTML = "";

  if (currentQuestionIndex >= questions.length) {
    chatIntro.classList.add("hidden");
    chatArea.classList.remove("hidden");

    window.activeChatSessionId = Date.now().toString();
    localStorage.setItem("activeChatSessionId", window.activeChatSessionId);

    startChatSession()
      .then(() => {
        if (customerId && !sessionStorage.getItem("notifiedAdmin")) {
          notifyAdminOfNewSession(customerId, window.activeChatSessionId);
          sessionStorage.setItem("notifiedAdmin", "true");
        }
        return loadHistory();
      })
      .then(() => {
        if (chatBox.children.length === 0 && customerId) {
          fetch(`${BASE_URL}/api/chat/customer/${customerId}?sessionId=${window.activeChatSessionId}`)
            .then(res => res.json())
            .then(existingMessages => {
              const alreadyWelcomed = existingMessages.some(
                msg => msg.sender === "admin" && msg.message.includes("välkommen")
              );

              if (!alreadyWelcomed) {
                const welcomeMessage = {
                  customerId,
                  message: "Hej och välkommen till Source livechat! Vi hjälper dig så snart vi kan 🙌",
                  sender: "admin",
                  timestamp: new Date(),
                  sessionId: window.activeChatSessionId
                };

                socket.emit("sendMessage", welcomeMessage);

                fetch(`${BASE_URL}/api/chat`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(welcomeMessage)
                });
              }
            });
        }
      });

    return;
  }

  const q = questions[currentQuestionIndex];
  const wrapper = document.createElement("div");
  wrapper.className = "question-wrapper fade-in";

  const label = document.createElement("label");
  label.textContent = q.label;
  wrapper.appendChild(label);

  let inputElement;

  if (q.type === "select") {
    inputElement = document.createElement("div");
    inputElement.className = "urgency-options";

    q.options.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt;
      btn.className = `urgency-btn urgency-${opt.toLowerCase()}`;
      btn.addEventListener("click", () => {
        answers[q.name] = opt;
        currentQuestionIndex++;
        showNextQuestion();
      });
      inputElement.appendChild(btn);
    });
  } else {
    inputElement = document.createElement("input");
    inputElement.type = "text";
    inputElement.placeholder = q.placeholder || "";
    inputElement.name = q.name;
    inputElement.required = true;
    inputElement.className = "question-input";

    const button = document.createElement("button");
    button.textContent = "Nästa";
    button.type = "button";
    button.className = "next-btn";

    button.addEventListener("click", () => {
      const value = inputElement.value.trim();
      if (!value) {
        inputElement.classList.add("input-error");
        return;
      }
      answers[q.name] = value;
      currentQuestionIndex++;
      showNextQuestion();
    });

    wrapper.appendChild(inputElement);
    wrapper.appendChild(button);
  }

  wrapper.appendChild(inputElement);
  questionFlow.appendChild(wrapper);
  inputElement.focus();
}

function sendMessage() {
  const text = input?.value.trim();
  if (!text) return;

  const msgObj = {
    customerId: window.customerId,
    message: text,
    sender: "customer",
    timestamp: new Date(),
    sessionId: window.activeChatSessionId
  };

  console.log("📤 Skickar meddelande till servern:", msgObj);

  socket.emit("sendMessage", msgObj);
  input.value = "";

  fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msgObj)
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

  const br = document.createElement("br");

  const time = document.createElement("small");
  let formatted = "Okänt datum";
  if (msg.timestamp) {
    const parsedDate = new Date(msg.timestamp);
    if (!isNaN(parsedDate)) {
      formatted = parsedDate.toLocaleString("sv-SE");
    }
  }
  time.textContent = formatted;

  div.appendChild(name);
  div.appendChild(content);
  div.appendChild(br);
  div.appendChild(time);

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

window.startChatSession = async function () {
  try {
    const res = await fetch(`${BASE_URL}/api/customers/me`, {
      method: "GET",
      credentials: "include"
    });

    if (!res.ok) throw new Error("Kunde inte hämta användare");

    const data = await res.json();
    customerId = data._id;
    customerName = data.name?.split(" ")[0] || "Du";
  } catch (err) {
    alert("❌ Kunde inte hämta användardata vid sessionstart.");
    console.error(err);
  }
};

async function loadHistory() {
  try {
    const res = await fetch(`${BASE_URL}/api/customers/me`, { credentials: 'include' });
    const userData = await res.json();
    customerId = userData._id;

    const historyRes = await fetch(
      `${BASE_URL}/api/chat/customer/${customerId}?sessionId=${window.activeChatSessionId}`,
      { credentials: 'include' }
    );
    const history = await historyRes.json();

    history.forEach(renderMessage);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelandehistorik:", err);
  }
}
