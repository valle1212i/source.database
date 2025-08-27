// CSRF-säker sidvisningsspårning
(async function () {
  const isLocalhost = window.location.hostname === "localhost";
  const base = isLocalhost
    ? "http://localhost:3000"
    : "https://admin-portal-rn5z.onrender.com";

  try {
    // 1) Hämta CSRF-token från servern (kräver cookies)
    const tRes = await fetch(`${base}/csrf-token`, { credentials: "include" });
    const { csrfToken } = await tRes.json();

    // 2) Skicka spårningen med token + cookies
    await fetch(`${base}/api/pageviews/track`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "CSRF-Token": csrfToken
      },
      body: JSON.stringify({ url: window.location.hostname })
    });
  } catch {
    // Tyst felhantering (användaren ser inget)
  }
})();
