const socket = io("https://source-database.onrender.com");

let customerId = null;
let customerName = "Du";
let input, chatBox;
let sessionStartTime = new Date();
let sessionId = sessionStorage.getItem("activeChatSessionId") || Date.now().toString();
sessionStorage.setItem("activeChatSessionId", sessionId);

const questions = [
  {
    label: "Vad gäller ditt ärende?",
    type: "text",
    name: "subject",
    placeholder: "Ex: Faktura, Leverans, Konto",
  },
  {
    label: "Hur brådskande är det?",
    type: "select",
    name: "urgency",
    options: ["Låg", "Medel", "Hög"],
  },
  {
    label: "Vill du bli kontaktad via e-post eller telefon?",
    type: "text",
    name: "preferredContact",
    placeholder: "Ex: Telefon, E-post",
  },
];

const answers = {};
let currentQuestionIndex = 0;

// Starta frågeflödet när sidan laddas
window.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("chatForm");
  input = document.getElementById("chatInput");
  chatBox = document.getElementById("chatMessages");

  if (!form || !input || !chatBox) {
    console.error("❌ chatForm, chatInput eller chatMessages saknas i DOM.");
    return;
  }

  form.addEventListener("submit", function (e) {
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

    startChatSession().then(() => {
      loadHistory().then(() => {
        if (chatBox.children.length === 0 && customerId) {
          const welcomeMessage = {
            customerId,
            message: "Hej och välkommen till Source livechat! Vi hjälper dig så snart vi kan 🙌",
            sender: "admin",
            timestamp: new Date(),
            sessionId: window.activeChatSessionId
          };

          socket.emit("sendMessage", welcomeMessage);

          fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(welcomeMessage)
          });

          renderMessage(welcomeMessage);
        }
      });
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
    customerId,
    message: text,
    sender: "customer",
    timestamp: new Date(),
    sessionId
  };

  renderMessage(msgObj);
  socket.emit("sendMessage", msgObj);

  input.value = "";

  fetch("/api/chat", {
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
  if (!chatBox) return;

  const div = document.createElement("div");
  div.classList.add(msg.sender === "admin" ? "received" : "sent");

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleString("sv-SE")
    : "Okänt datum";

  const senderName = msg.sender === "admin" ? "Support" : customerName;

  div.innerHTML = `
    <strong>${senderName}:</strong><br>
    ${msg.message}<br>
    <small>${time}</small>
  `;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

window.startChatSession = async function () {
  try {
    const res = await fetch("/api/customers/me", {
      method: "GET",
      credentials: "include"
    });

    if (!res.ok) throw new Error("Kunde inte hämta användare");

    const data = await res.json();
    customerId = data._id;
    customerName = data.name?.split(" ")[0] || "Du";

    await fetchMessages();

  } catch (err) {
    alert("❌ Kunde inte hämta användardata vid sessionstart.");
    console.error(err);
  }
};

async function loadHistory() {
  try {
    const res = await fetch('/api/customers/me', { credentials: 'include' });
    const userData = await res.json();
    customerId = userData._id;

    const historyRes = await fetch(`/api/chat/customer/${customerId}`, { credentials: 'include' });
    const history = await historyRes.json();

    history.forEach(msg => {
      renderMessage(msg);
    });
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelandehistorik:", err);
  }
}
