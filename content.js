/**
 * Shopee Coin Collector Content Script Entry Point
 */

(function () {
  'use strict';

  console.log('[Shopee Coin Collector] Content script loaded on', window.location.href);

  function init() {
    if (window.ShopeeCoinUI) {
      window.ShopeeCoinUI.injectFloatButton();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Listen for messages from extension popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'OPEN_DASHBOARD') {
      if (window.ShopeeCoinUI) {
        window.ShopeeCoinUI.openModal();
        sendResponse({ status: 'OK' });
      } else {
        sendResponse({ status: 'ERROR', message: 'UI not loaded' });
      }
    } else if (request.action === 'START_FETCH') {
      if (window.ShopeeCoinUI) {
        window.ShopeeCoinUI.openModal();
        window.ShopeeCoinUI.startCollecting();
        sendResponse({ status: 'OK' });
      }
    }
    return true;
  });
})();
