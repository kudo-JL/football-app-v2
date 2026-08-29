// Football League Manager — minimal client-side helpers
// Most interactivity is server-rendered; this file is for future enhancements.

(function () {
  // Auto-dismiss flash messages
  document.addEventListener('DOMContentLoaded', function () {
    const flashes = document.querySelectorAll('[data-flash]');
    flashes.forEach((el) => {
      setTimeout(() => el.remove(), 4000);
    });
  });
})();
