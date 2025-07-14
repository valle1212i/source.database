// 👇 Förutsätter att du har inkluderat Socket.IO-klienten i HTML innan denna fil laddas!
const socket = io("https://admin-portal-production.up.railway.app"); // byt till din Railway URL

const chatBox = document.getElementById("chatMessages");
const input = document.getElementById("chatInput");

// ✅ När sidan laddas – hämta inloggad användare och därefter meddelanden
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/customers/me", {
      method: "GET",
      credentials: "include"
    });

    if (!res.ok) throw new Error("Kunde inte hämta användare");

    const data = await res.json();
    customerId = data._id;

    // 🚀 Hämta meddelanden nu när ID finns
    fetchMessages();
  } catch (err) {
    alert("❌ Kunde inte hämta inloggad användare. Är du inloggad?");
    console.error(err);
  }
});

// 🔄 Hämta meddelandehistorik
async function fetchMessages() {
  try {
    const res = await fetch(`/api/chat/customer/${customerId}`);
    const messages = await res.json();

    messages.forEach(msg => {
      renderMessage(msg);
    });
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
  }
}

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  const msgObj = {
    customerId,
    message: text,
    sender: "customer",
    timestamp: new Date()
  };

  socket.emit("sendMessage", msgObj);

  // ❌ Inte rendera direkt – vänta på socket.on("newMessage")
  input.value = "";

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msgObj)
  }).catch(err => {
    console.error("❌ Kunde inte spara meddelande:", err);
  });
}


// 👂 Ta emot svar från admin
socket.on("newMessage", (msg) => {
  renderMessage(msg);
});

// 🧱 Rendera meddelande
function renderMessage(msg) {
  const div = document.createElement("div");

  let time = "Okänt datum";
  if (msg.timestamp) {
    const parsedDate = new Date(msg.timestamp);
    if (!isNaN(parsedDate)) {
      time = parsedDate.toLocaleString("sv-SE");
    }
  }

  div.innerHTML = `
    <strong>${msg.sender === "admin" ? "Admin" : "Du"}:</strong> ${msg.message}<br>
    <small>${time}</small>
  `;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

