// Runs synchronously in <head> so the saved theme is applied before first paint.
(function () {
  var theme = 'dark';
  try {
    theme = localStorage.getItem('theme') ||
      (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  } catch (e) { /* storage unavailable: keep default */ }
  document.documentElement.setAttribute('data-theme', theme);
})();
