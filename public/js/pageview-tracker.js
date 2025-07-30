(function () {
  const isLocalhost = window.location.hostname === "localhost";
  const endpoint = isLocalhost
    ? "http://localhost:3000/api/pageviews/track"
    : "https://admin-portal-rn5z.onrender.com/api/pageviews/track";

  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: window.location.hostname
    })
  }).catch(() => {
    // Tyst felhantering (användaren ser inget)
  });
})();
