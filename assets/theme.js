/* ============================================================
   AI QS — shared light/dark theme controller
   Load with `defer` so the toggle buttons exist in the DOM.
   The no-flash inline snippet in <head> sets the initial theme
   before paint; this file wires up the toggle + OS-preference sync.
   ============================================================ */
(function () {
  var root = document.documentElement;
  var metaTheme = document.getElementById('metaThemeColor');
  var colors = { dark: '#0A0F1C', light: '#FFFFFF' };

  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    if (metaTheme) metaTheme.setAttribute('content', colors[theme] || colors.dark);
    var next = theme === 'light' ? 'dark' : 'light';
    var label = 'Switch to ' + next + ' theme';
    var toggles = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute('aria-label', label);
      toggles[i].setAttribute('title', label);
    }
  }

  // Sync meta/labels with the theme the no-flash script already set
  apply(current());

  // Wire up every toggle on the page
  var toggles = document.querySelectorAll('.theme-toggle');
  for (var i = 0; i < toggles.length; i++) {
    toggles[i].addEventListener('click', function () {
      var next = current() === 'light' ? 'dark' : 'light';
      apply(next);
      try { localStorage.setItem('aiqs_theme', next); } catch (e) {}
    });
  }

  // Follow the OS preference until the visitor makes an explicit choice
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function (e) {
      var stored;
      try { stored = localStorage.getItem('aiqs_theme'); } catch (err) {}
      if (stored !== 'light' && stored !== 'dark') apply(e.matches ? 'light' : 'dark');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();
