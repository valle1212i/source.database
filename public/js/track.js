// CSRF-säker sidvisningsspårning (ej hårdkodad miljö)
(async () => {
  const isLocalhost = window.location.hostname === "localhost";
  const base = isLocalhost
    ? "http://localhost:3000"
    : "https://admin-portal-rn5z.onrender.com";

  try {
    // 1) Hämta CSRF-token (kräver cookies)
    const tRes = await fetch(`${base}/csrf-token`, { credentials: "include" });
    const { csrfToken } = await tRes.json();

    // 2) Skicka spårningen med token + cookies
    const url = window.location.hostname;
    const res = await fetch(`${base}/api/pageviews/track`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "CSRF-Token": csrfToken
      },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (data?.success) {
      console.log("📊 Sidvisning registrerad!");
    } else {
      console.warn("⚠️ Kunde inte registrera sidvisning:", data?.message);
    }
  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
  }
})();
