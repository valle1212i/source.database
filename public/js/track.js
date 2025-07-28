(async () => {
  try {
    const url = window.location.hostname;
    const res = await fetch("http://localhost:3000/api/pageviews/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (data.success) {
      console.log("📊 Sidvisning registrerad!");
    } else {
      console.warn("⚠️ Kunde inte registrera sidvisning:", data.message);
    }
  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
  }
})();
