// Hämta CSRF-token från servern
async function getCsrfToken() {
  try {
    const res = await fetch("/csrf-token", { credentials: "include" });
    const data = await res.json();
    return data.csrfToken;
  } catch (err) {
    console.error("Kunde inte hämta CSRF-token:", err);
    return null;
  }
}

// Lägg till klick-hanterare för logout-knappen (om den finns)
document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logout");
  if (!logoutBtn) return; // ingen logout-knapp på sidan

  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("Är du säker på att du vill logga ut?")) return;

    const csrf = await getCsrfToken();
    if (!csrf) {
      alert("Kunde inte hämta säkerhets-token. Försök igen.");
      return;
    }

    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "CSRF-Token": csrf }
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          localStorage.clear();
          window.location.href = "/login.html";
        } else {
          alert("Utloggning misslyckades.");
        }
      })
      .catch(err => {
        console.error("Fel vid utloggning:", err);
        alert("Kunde inte logga ut.");
      });
  });
});
