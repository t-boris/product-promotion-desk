/* global document, localStorage, window */
// Runs before the first paint, as a classic script in <head> (the page cannot wait for the core to say which theme the owner chose, and a
// dark theme must never flash light). It puts the last value the application confirmed (theme.ts keeps it in localStorage under the same key)
// on the page, with the same rules theme.ts and src/shared/themes.ts apply once the application starts; then theme.ts asks the core and
// follows it. The list of themes below is held equal to src/shared/themes.ts, and this script equal to those rules, by theme-boot.test.ts.
// Anything unreadable leaves the page as it is: no attribute, which follows macOS, still. (visual-system.md §33.5)
;(function () {
  var THEMES = ['daylight', 'lagoon', 'orchid', 'graphite', 'midnight', 'aubergine']
  try {
    var hint = JSON.parse(localStorage.getItem('ppd-appearance') || 'null')
    if (!hint || typeof hint !== 'object') return
    var root = document.documentElement
    if (typeof hint.theme === 'string' && THEMES.indexOf(hint.theme) !== -1) root.setAttribute('data-theme', hint.theme)
    if (hint.animatedBackground === true && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) root.setAttribute('data-animated', 'on')
  } catch {
    // No storage, or a damaged value.
  }
})()
