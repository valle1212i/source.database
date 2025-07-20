// 👇 Förutsätter att Socket.IO-klienten är laddad
const socket = io("https://source-database.onrender.com");

const chatBox = document.getElementById("chatMessages");
const input = document.getElementById("chatInput");

window.customerId = null;

// ✅ Ladda inloggad användare och historik
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/customers/me", {
      method: "GET",
      credentials: "include"
    });

    if (!res.ok) throw new Error("Kunde inte hämta användare");

    const data = await res.json();
    window.customerId = data._id;

    // 🚀 Hämta meddelanden efter ID
    fetchMessages();
  } catch (err) {
    alert("❌ Kunde inte hämta inloggad användare. Är du inloggad?");
    console.error(err);
  }
});

// 🔄 Hämta historiska meddelanden
async function fetchMessages() {
  try {
    const res = await fetch(`/api/chat/customer/${window.customerId}`);
    const messages = await res.json();

    messages.forEach(renderMessage);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
  }
}

// 📤 Skicka nytt meddelande
function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  const msgObj = {
    customerId: window.customerId,
    message: text,
    sender: "customer",
    timestamp: new Date()
  };

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

// 👂 Lyssna på nya inkommande meddelanden
socket.on("newMessage", (msg) => {
  renderMessage(msg);
});

// 🧱 Rendera meddelande (XSS-säkert)
function renderMessage(msg) {
  const div = document.createElement("div");
  div.className = msg.sender === "admin" ? "message admin" : "message customer";

  const name = document.createElement("strong");
  name.textContent = msg.sender === "admin" ? "Admin: " : "Du: ";

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
