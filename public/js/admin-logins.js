document.addEventListener("DOMContentLoaded", async () => {
  const tableBody = document.querySelector("#logins-table tbody");

  try {
    const res = await fetch("/api/security/all-logins", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Kunde inte hämta data");
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error("Felaktigt svar från servern");
    }

    if (data.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5">Inga inloggningar hittades.</td></tr>`;
      return;
    }

    data.forEach(log => {
      const row = document.createElement("tr");

      const userName = log.user?.name || "–";
      const userEmail = log.user?.email || "–";
      const ip = log.ip || "–";
      const device = log.userAgent?.split(")")[0]?.replace("(", "") || "–";

      const time = new Date(log.timestamp).toLocaleString("sv-SE", {
        dateStyle: "short",
        timeStyle: "short",
      });

      row.innerHTML = `
        <td>${userName}</td>
        <td>${userEmail}</td>
        <td>${ip}</td>
        <td>${device}</td>
        <td>${time}</td>
      `;

      tableBody.appendChild(row);
    });
  } catch (err) {
    console.error("Fel:", err);
    tableBody.innerHTML = `<tr><td colspan="5">❌ Kunde inte hämta loggar</td></tr>`;
  }
});
