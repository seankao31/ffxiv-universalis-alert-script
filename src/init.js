const Init = (() => {
  function route(pathname) {
    if (pathname.startsWith('/market/')) {
      if (pathname.split('/').length === 3) { // /market/{id} only, not sub-paths
        MarketPage.init();
      }
    } else if (pathname.startsWith('/account/') && pathname.split('/').length === 3) {
      AlertsPage.injectTab();
      if (pathname === '/account/bulk-alerts') {
        AlertsPage.init();
      }
    }
  }

  function setupNavigationObserver() {
    let lastPath = window.location.pathname;

    const observer = new MutationObserver(() => {
      const currentPath = window.location.pathname;
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      route(currentPath);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function main() {
    setupNavigationObserver();
    route(window.location.pathname);
  }

  main();

  return { main, route, setupNavigationObserver };
})();

if (typeof module !== 'undefined') module.exports = Init;
