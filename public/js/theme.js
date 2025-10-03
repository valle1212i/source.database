/* =======================================================
   theme.js – Enkel, global temahantering för kundportalen
   Användning:
   1) Lägg en TIDIG inline-snutt i <head> som sätter data-theme
      (se inställningar.html nedan) för att undvika FOUC.
   2) Inkludera sedan denna fil på alla sidor.
   ======================================================= */

(function () {
  const THEME_KEY = 'theme';
  const DEFAULT_THEME = 'light';

  function getSavedTheme() {
    try { return localStorage.getItem(THEME_KEY) || DEFAULT_THEME; }
    catch { return DEFAULT_THEME; }
  }

  function setThemeAttr(value) {
    document.documentElement.setAttribute('data-theme', value);
  }

  function saveTheme(value) {
    try { localStorage.setItem(THEME_KEY, value); } catch {}
  }

  function applyTheme(value) {
    setThemeAttr(value);
    saveTheme(value);
  }

  function initThemeFromStorage() {
    applyTheme(getSavedTheme());
  }

  // Koppla radio-knappar (name="theme") om de finns på sidan.
  function wireThemeRadios(root = document) {
    const saved = getSavedTheme();
    const radios = Array.from(root.querySelectorAll('input[name="theme"]'));
    if (radios.length) {
      const current = root.querySelector(`input[name="theme"][value="${saved}"]`);
      if (current) current.checked = true;

      radios.forEach(r =>
        r.addEventListener('change', (e) => {
          const val = e.target.value;
          applyTheme(val);
          // valfritt: visa en egen toast-funktion om den finns
          if (typeof window.showToast === 'function') {
            window.showToast('🎨 Tema uppdaterat.');
          }
        })
      );
    }
  }

  // Exponera lite API globalt
  window.Theme = {
    get: getSavedTheme,
    set: applyTheme,
    init: initThemeFromStorage,
    wireRadios: wireThemeRadios,
  };

  // Kör init på DOMContentLoaded (säkerhetsnät om inline-snipp saknas)
  document.addEventListener('DOMContentLoaded', () => {
    // Om någon ändrat data-theme innan (via inline-snipp), spara det som sanning
    const currentAttr = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    saveTheme(currentAttr);
    wireThemeRadios(document);
  });
})();
