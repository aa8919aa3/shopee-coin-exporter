document.addEventListener('DOMContentLoaded', () => {
  const targetUrl = 'https://shopee.tw/user/coin/list/?type=all';

  document.getElementById('btn-open-dashboard').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('shopee.tw/user/coin')) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'OPEN_DASHBOARD' }, (res) => {
          if (chrome.runtime.lastError) {
            alert('請在蝦皮蝦幣紀錄頁面重新整理後再嘗試點擊。');
          } else {
            window.close();
          }
        });
      } else {
        // Open tab if not on page
        chrome.tabs.create({ url: targetUrl });
      }
    });
  });

  document.getElementById('btn-go-shopee').addEventListener('click', () => {
    chrome.tabs.create({ url: targetUrl });
  });
});
