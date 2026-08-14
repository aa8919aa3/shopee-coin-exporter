document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const targetUrl = 'https://shopee.tw/user/coin/list/?type=all';

  function isTargetUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'shopee.tw' && /^\/user\/coin\/list\/?$/.test(url.pathname);
    } catch (error) {
      return false;
    }
  }

  function openDashboard(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'OPEN_DASHBOARD' }, response => {
      if (chrome.runtime.lastError) {
        alert('擴充功能尚未注入完成，請重新整理蝦幣紀錄頁面後再試。');
        return;
      }
      if (!response || response.status !== 'OK') {
        alert(response?.message || '無法開啟蝦幣分析儀表板。');
        return;
      }
      window.close();
    });
  }

  function waitForTargetTab(tabId) {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      alert('蝦幣紀錄頁面載入逾時，請稍後再試。');
    }, 20000);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete' || !isTargetUrl(tab.url)) return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => openDashboard(tabId), 200);
    }
    chrome.tabs.onUpdated.addListener(listener);
  }

  document.getElementById('btn-open-dashboard').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const activeTab = tabs[0];
      if (activeTab?.id && isTargetUrl(activeTab.url)) {
        openDashboard(activeTab.id);
        return;
      }
      chrome.tabs.create({ url: targetUrl }, tab => {
        if (chrome.runtime.lastError || !tab?.id) {
          alert('無法開啟蝦幣紀錄頁面。');
          return;
        }
        waitForTargetTab(tab.id);
      });
    });
  });

  document.getElementById('btn-go-shopee').addEventListener('click', () => {
    chrome.tabs.create({ url: targetUrl });
  });
});
