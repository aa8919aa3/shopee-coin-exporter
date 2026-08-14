/**
 * Shopee Coin Collector Content Script Entry Point
 */

(function () {
  'use strict';

  function isTargetRoute() {
    return window.location.origin === 'https://shopee.tw' && /^\/user\/coin\/list\/?$/.test(window.location.pathname);
  }

  function syncRoute() {
    if (isTargetRoute()) {
      window.ShopeeCoinUI?.injectFloatButton();
    } else {
      window.ShopeeCoinUI?.destroy();
    }
  }

  function init() {
    syncRoute();

    ['pushState', 'replaceState'].forEach(method => {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(syncRoute);
        return result;
      };
    });
    window.addEventListener('popstate', syncRoute);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request?.action === 'OPEN_DASHBOARD') {
        if (!isTargetRoute()) {
          sendResponse({ status: 'ERROR', code: 'WRONG_ROUTE', message: '目前不是蝦幣紀錄頁面。' });
        } else if (!window.ShopeeCoinUI) {
          sendResponse({ status: 'ERROR', code: 'UI_NOT_READY', message: '儀表板尚未載入。' });
        } else {
          window.ShopeeCoinUI.openModal();
          sendResponse({ status: 'OK' });
        }
        return false;
      }

      if (request?.action === 'START_FETCH') {
        if (!isTargetRoute() || !window.ShopeeCoinUI) {
          sendResponse({ status: 'ERROR', code: 'UI_NOT_READY', message: '請先開啟蝦幣紀錄頁面。' });
          return false;
        }
        window.ShopeeCoinUI.openModal();
        Promise.resolve(window.ShopeeCoinUI.startCollecting())
          .then(result => sendResponse({ status: 'OK', result: { status: result?.status, complete: result?.complete } }))
          .catch(error => sendResponse({ status: 'ERROR', code: 'FETCH_FAILED', message: error.message || '抓取失敗' }));
        return true;
      }

      if (request?.action === 'STOP_FETCH') {
        window.ShopeeCoinUI?.stopCollecting();
        sendResponse({ status: 'OK' });
        return false;
      }

      sendResponse({ status: 'ERROR', code: 'UNKNOWN_ACTION', message: '不支援的操作。' });
      return false;
    } catch (error) {
      sendResponse({ status: 'ERROR', code: 'CONTENT_ERROR', message: error.message || '內容指令碼錯誤' });
      return false;
    }
  });
})();
