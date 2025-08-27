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

            const tdName = document.createElement("td");
      tdName.textContent = userName ?? "";

      const tdEmail = document.createElement("td");
      tdEmail.textContent = userEmail ?? "";

      const tdIp = document.createElement("td");
      tdIp.textContent = ip ?? "";

      const tdDevice = document.createElement("td");
      tdDevice.textContent = device ?? "";

      const tdTime = document.createElement("td");
      tdTime.textContent = time ?? "";

      row.append(tdName, tdEmail, tdIp, tdDevice, tdTime);
      tableBody.appendChild(row);
    });
  } catch (err) {
  console.error("Fel:", err);

  // Töm tabellkroppen säkert
  while (tableBody.firstChild) tableBody.removeChild(tableBody.firstChild);

  // Bygg en säker felrad utan innerHTML
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 5;
  td.appendChild(document.createTextNode("❌ Kunde inte hämta loggar"));
  tr.appendChild(td);
  tableBody.appendChild(tr);
}
});
