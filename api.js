/**
 * Shopee Coin Data Collector API Engine
 * Handles API requests, cancellation, retry, data validation, and normalization.
 */

window.ShopeeCoinCollector = (function () {
  'use strict';

  const COIN_SCALE = 100000;
  const DEFAULT_PAGE_SIZE = 100;
  const MAX_PAGES = 2000;
  const MAX_RECORDS = 200000;
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_RETRIES = 3;

  class CollectorError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'CollectorError';
      this.code = code;
      this.details = details;
      this.retriable = Boolean(details.retriable);
    }
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function coinsToMicros(value) {
    const number = toFiniteNumber(value);
    return number === null ? null : Math.round(number * COIN_SCALE);
  }

  function microsToCoins(value) {
    return Number.isSafeInteger(value) ? value / COIN_SCALE : 0;
  }

  function parseScaledAmount(primaryValue, scaledValue) {
    const primary = coinsToMicros(primaryValue);
    if (primary !== null) return primary;
    const scaled = toFiniteNumber(scaledValue);
    return scaled === null ? null : Math.round(scaled);
  }

  function isAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ABORTED';
  }

  function formatLocalDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    const ss = String(dateObj.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }

  function parseTimestamp(value) {
    const raw = toFiniteNumber(value);
    if (raw === null || raw <= 0) return null;
    const timestampMs = raw > 1e12 ? Math.trunc(raw) : Math.trunc(raw * 1000);
    const date = new Date(timestampMs);
    return Number.isFinite(date.getTime()) ? { timestampMs, date } : null;
  }

  function stableHash(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function waitWithSignal(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  class CoinRecord {
    constructor(data) {
      this.id = String(data.id);
      this.timestampMs = data.timestampMs;
      this.timestamp = new Date(data.timestampMs).toISOString();
      this.dateStr = data.dateStr || formatLocalDate(new Date(data.timestampMs));
      this.monthKey = /^\d{4}-\d{2}/.test(this.dateStr) ? this.dateStr.substring(0, 7) : '其他';
      this.title = String(data.title || '蝦幣變動');
      this.type = ['gain', 'spend', 'expired'].includes(data.type) ? data.type : 'unknown';
      this.amountMicros = Math.abs(Number.isSafeInteger(data.amountMicros) ? data.amountMicros : 0);
      this.signedAmountMicros = this.type === 'gain' ? this.amountMicros : -this.amountMicros;
      this.amount = microsToCoins(this.amountMicros);
      this.displayAmount = microsToCoins(this.signedAmountMicros);
      this.expiryDate = String(data.expiryDate || '-');
      this.orderSn = String(data.orderSn || '-');
      this.category = String(data.category || this.inferCategory(this.title));
    }

    inferCategory(title) {
      if (!title) return '其他';
      if (title.includes('簽到') || title.includes('報到')) return '每日簽到';
      if (title.includes('過期') || title.includes('失效')) return '蝦幣過期';
      if (title.includes('退款') || title.includes('退貨') || title.includes('補償')) return '退款/補償';
      if (title.includes('折抵') || title.includes('使用') || title.includes('付款')) return '消費折抵';
      if (title.includes('訂單') || title.includes('購物') || title.includes('完成訂單')) return '購物/訂單';
      if (title.includes('遊戲') || title.includes('蝦蝦果園') || title.includes('消消樂') || title.includes('寶箱')) return '蝦皮遊戲';
      if (title.includes('任務') || title.includes('活動') || title.includes('挑戰')) return '行銷活動/任務';
      if (title.includes('直播')) return '蝦皮直播';
      return '其他活動';
    }
  }

  class APIClient {
    constructor() {
      this.isCollecting = false;
      this.collectedRecords = new Map();
      this.accountSummary = null;
      this.lastResult = null;
      this.activeRun = null;
      this.nextRunId = 1;
    }

    stop() {
      if (this.activeRun && !this.activeRun.controller.signal.aborted) {
        this.activeRun.controller.abort();
      }
    }

    clear() {
      this.stop();
      this.activeRun = null;
      this.isCollecting = false;
      this.collectedRecords.clear();
      this.accountSummary = null;
      this.lastResult = null;
    }

    async fetchJSON(url, { signal, offset = null, retries = MAX_RETRIES } = {}) {
      let lastError = null;

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
        const abortTimeout = () => timeoutController.abort();
        signal?.addEventListener('abort', abortTimeout, { once: true });

        try {
          const response = await fetch(url, {
            credentials: 'include',
            signal: timeoutController.signal,
            headers: { Accept: 'application/json' }
          });

          if (response.status === 401 || response.status === 403) {
            throw new CollectorError('AUTH', '蝦皮登入狀態已失效，請重新登入後再試。', { status: response.status, offset });
          }

          const retriable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (!response.ok) {
            const retryAfter = Number(response.headers.get('Retry-After'));
            const error = new CollectorError('HTTP', `蝦皮 API 回傳 HTTP ${response.status}`, {
              status: response.status,
              offset,
              retriable,
              retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null
            });
            if (!retriable) throw error;
            lastError = error;
          } else {
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('json')) {
              throw new CollectorError('PARSE', '蝦皮 API 未回傳 JSON，可能需要重新登入。', { offset });
            }
            try {
              return await response.json();
            } catch (error) {
              throw new CollectorError('PARSE', '無法解析蝦皮 API 回應。', { offset, cause: error.message });
            }
          }
        } catch (error) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (error instanceof CollectorError && !error.retriable) throw error;
          const isTimeout = timeoutController.signal.aborted;
          lastError = error instanceof CollectorError
            ? error
            : new CollectorError(isTimeout ? 'TIMEOUT' : 'NETWORK', isTimeout ? '蝦皮 API 請求逾時。' : '蝦皮 API 網路請求失敗。', {
                offset,
                retriable: true,
                cause: error.message
              });
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abortTimeout);
        }

        if (attempt < retries) {
          const retryAfterMs = lastError?.details?.retryAfterMs;
          const backoffMs = retryAfterMs || Math.min(5000, 400 * (2 ** attempt)) + Math.floor(Math.random() * 200);
          await waitWithSignal(backoffMs, signal);
        }
      }

      throw lastError || new CollectorError('NETWORK', '蝦皮 API 請求失敗。', { offset });
    }

    async fetchAccountSummary(signal) {
      const payload = await this.fetchJSON('/api/v4/coin/get_user_coins_summary', { signal, retries: 2 });
      if (payload.error && payload.error !== 0) {
        throw new CollectorError('API', payload.error_msg || `摘要 API 錯誤 ${payload.error}`, { errorCode: payload.error });
      }

      const coins = payload.coins ?? payload.data?.coin_info ?? payload.data?.coins;
      if (!coins || typeof coins !== 'object') {
        throw new CollectorError('SCHEMA', '摘要 API 缺少 coins 欄位。');
      }

      const availableMicros = parseScaledAmount(coins.available_amount, coins.fe_available_amount);
      if (availableMicros === null) {
        throw new CollectorError('SCHEMA', '摘要 API 的可用餘額格式無效。');
      }

      const expiryItems = [];
      if (Array.isArray(coins.expiry_info?.summary)) {
        for (const item of coins.expiry_info.summary) {
          const amountMicros = parseScaledAmount(item.coin_amount, item.fe_coin_amount);
          const year = Number(item.year);
          const month = Number(item.month);
          const day = Number(item.day);
          const date = new Date(year, month - 1, day);
          const validDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
          if (amountMicros !== null && amountMicros > 0 && validDate) {
            expiryItems.push({
              date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
              amountMicros,
              amount: microsToCoins(amountMicros)
            });
          }
        }
      }
      expiryItems.sort((a, b) => a.date.localeCompare(b.date));

      return {
        availableAmountMicros: availableMicros,
        availableAmount: microsToCoins(availableMicros),
        expiryItems,
        nextExpiry: expiryItems[0] || null,
        fetchedAt: new Date().toISOString()
      };
    }

    normalizeRawLogItem(item, context = {}) {
      if (!item || typeof item !== 'object') {
        throw new CollectorError('INVALID_ITEM', '交易項目不是物件。', context);
      }

      const signedMicros = coinsToMicros(item.coin_amount ?? item.coin ?? item.amount ?? item.coins);
      if (signedMicros === null) {
        throw new CollectorError('INVALID_AMOUNT', '交易金額格式無效。', context);
      }

      const parsedTime = parseTimestamp(item.ctime ?? item.create_time ?? item.timestamp ?? item.mtime);
      if (!parsedTime) {
        throw new CollectorError('INVALID_TIME', '交易時間格式無效。', context);
      }

      const name = String(item.name ?? item.title ?? item.description ?? item.text ?? item.event_name ?? '').trim();
      const reason = String(item.info?.reason ?? '').trim();
      const combinedText = `${name} ${reason}`;

      let type;
      if (combinedText.includes('過期') || combinedText.includes('失效')) {
        type = 'expired';
      } else if (signedMicros < 0) {
        type = 'spend';
      } else if (signedMicros > 0) {
        type = 'gain';
      } else if (item.coin_type === 2 || item.type === 2 || /折抵|使用|付款/.test(combinedText)) {
        type = 'spend';
      } else {
        type = 'gain';
      }

      const title = name || reason || '蝦幣變動';
      const fullTitle = reason && reason !== title ? `${title} - ${reason}` : title;
      const orderSn = item.order_sn ?? item.ordersn ?? item.order_id ?? '-';
      const amountMicros = Math.abs(signedMicros);

      let expiryDate = '-';
      const expiryTime = parseTimestamp(item.expiry_time ?? item.expire_time);
      if (expiryTime) expiryDate = formatLocalDate(expiryTime.date).substring(0, 10);

      const serverId = item.id ?? item.transaction_id;
      const fingerprint = [parsedTime.timestampMs, signedMicros, orderSn, fullTitle, context.offset, context.index].join('|');
      const id = serverId !== null && serverId !== undefined && serverId !== ''
        ? `api_${serverId}`
        : `fallback_${stableHash(fingerprint)}`;

      return new CoinRecord({
        id,
        timestampMs: parsedTime.timestampMs,
        title: fullTitle,
        type,
        amountMicros,
        expiryDate,
        orderSn: orderSn && orderSn !== 0 ? String(orderSn) : '-'
      });
    }

    async fetchViaAPI(progressCallback) {
      if (this.activeRun) this.stop();

      const runId = this.nextRunId++;
      const controller = new AbortController();
      const run = { runId, controller };
      this.activeRun = run;
      this.isCollecting = true;

      const records = new Map();
      const warnings = [];
      let accountSummary = null;
      let summaryError = null;
      let pagesFetched = 0;
      let rejectedRecords = 0;
      let offset = 0;
      let reachedEnd = false;
      let terminalError = null;
      let previousPageFingerprint = null;

      try {
        try {
          accountSummary = await this.fetchAccountSummary(controller.signal);
        } catch (error) {
          if (isAbortError(error)) throw error;
          summaryError = this.serializeError(error);
          warnings.push(`官方餘額摘要無法取得：${error.message}`);
        }

        while (!controller.signal.aborted && pagesFetched < MAX_PAGES && records.size < MAX_RECORDS) {
          const apiUrl = `/api/v4/coin/get_user_coin_transaction_list?type=all&offset=${offset}&limit=${DEFAULT_PAGE_SIZE}`;
          let payload;
          try {
            payload = await this.fetchJSON(apiUrl, { signal: controller.signal, offset });
          } catch (error) {
            if (isAbortError(error)) throw error;
            terminalError = error;
            break;
          }

          if (payload.error && payload.error !== 0) {
            terminalError = new CollectorError('API', payload.error_msg || `交易 API 錯誤 ${payload.error}`, {
              errorCode: payload.error,
              offset
            });
            break;
          }

          const candidateLists = [payload.items, payload.data?.items, payload.data?.coin_transactions, payload.data?.list];
          const items = candidateLists.find(Array.isArray);
          if (!items) {
            terminalError = new CollectorError('SCHEMA', '交易 API 缺少 items 陣列。', { offset });
            break;
          }

          const explicitHasMore = payload.has_more ?? payload.data?.has_more;
          if (items.length === 0) {
            if (explicitHasMore === true || explicitHasMore === 1) {
              terminalError = new CollectorError('SCHEMA', '交易 API 回傳空頁但宣告仍有下一頁。', { offset });
            } else {
              reachedEnd = true;
            }
            break;
          }

          const pageFingerprint = stableHash(items.map(item => String(item?.id ?? item?.transaction_id ?? JSON.stringify(item))).join('|'));
          if (pageFingerprint === previousPageFingerprint) {
            terminalError = new CollectorError('PAGINATION', '交易 API 重複回傳相同頁面。', { offset });
            break;
          }
          previousPageFingerprint = pageFingerprint;

          const beforeCount = records.size;
          items.forEach((item, index) => {
            try {
              const record = this.normalizeRawLogItem(item, { offset, index });
              const existing = records.get(record.id);
              if (existing && (existing.timestampMs !== record.timestampMs || existing.signedAmountMicros !== record.signedAmountMicros)) {
                warnings.push(`交易 ID 衝突：${record.id}`);
                rejectedRecords += 1;
                return;
              }
              records.set(record.id, record);
            } catch (error) {
              rejectedRecords += 1;
              if (warnings.length < 20) warnings.push(`略過第 ${offset + index + 1} 筆異常資料：${error.message}`);
            }
          });

          pagesFetched += 1;
          offset += items.length;
          const addedCount = records.size - beforeCount;

          if (typeof progressCallback === 'function') {
            try {
              progressCallback({ runId, status: 'fetching', fetchedCount: records.size, pagesFetched, addedCount, rejectedRecords });
            } catch (error) {
              console.warn('[ShopeeCoinCollector] Progress callback failed:', error);
            }
          }

          if (explicitHasMore === false || explicitHasMore === 0) {
            reachedEnd = true;
            break;
          }
          if (![undefined, null, true, false, 0, 1].includes(explicitHasMore)) {
            terminalError = new CollectorError('SCHEMA', '交易 API 的 has_more 格式無效。', { offset });
            break;
          }
          if (addedCount === 0) {
            terminalError = new CollectorError('PAGINATION', '交易分頁沒有新增任何資料，已停止以避免無限循環。', { offset });
            break;
          }

          await waitWithSignal(100, controller.signal);
        }

        if (!reachedEnd && !terminalError && !controller.signal.aborted) {
          terminalError = new CollectorError('LIMIT', '交易筆數超過安全上限，結果可能不完整。', {
            pagesFetched,
            recordCount: records.size
          });
        }
      } catch (error) {
        if (!isAbortError(error)) terminalError = error;
      } finally {
        const stopped = controller.signal.aborted;
        let status;
        if (stopped) status = 'stopped';
        else if (reachedEnd && rejectedRecords === 0) status = 'complete';
        else if (records.size > 0) status = 'partial';
        else status = 'failed';

        const sortedRecords = Array.from(records.values()).sort((a, b) => b.timestampMs - a.timestampMs || a.id.localeCompare(b.id));
        const result = {
          runId,
          status,
          complete: status === 'complete',
          records: sortedRecords,
          accountSummary,
          summaryError,
          pagesFetched,
          rejectedRecords,
          warnings,
          failedOffset: terminalError?.details?.offset ?? null,
          error: terminalError ? this.serializeError(terminalError) : null
        };

        if (this.activeRun?.runId === runId) {
          this.collectedRecords = new Map(sortedRecords.map(record => [record.id, record]));
          this.accountSummary = accountSummary;
          this.lastResult = result;
          this.activeRun = null;
          this.isCollecting = false;
        }
        return result;
      }
    }

    scrapeFromDOM() {
      const rows = document.querySelectorAll('.coin-history-item, .shopee-coin-log-item, tr.coin-row, .Majt3V');
      const records = [];
      let rejectedRecords = 0;

      rows.forEach((element, index) => {
        try {
          const title = element.querySelector('.WYcY3j, .title, [class*="title"]')?.innerText?.trim() || '';
          const description = element.querySelector('.Xvdd6G, .description, [class*="desc"]')?.innerText?.trim() || '';
          const dateText = element.querySelector('.uunn, .date, .time, [class*="date"], [class*="time"]')?.innerText?.trim() || '';
          const amountText = element.querySelector('.jClYSy, .amount, .coins, [class*="amount"]')?.innerText?.trim() || '';
          const date = new Date(dateText.replace(/-/g, '/'));
          const amount = toFiniteNumber(amountText.replace(/[^\d.+-]/g, ''));
          if (!title || !Number.isFinite(date.getTime()) || amount === null) throw new Error('必要欄位無效');

          const combinedText = `${title} ${description}`;
          const type = /過期|失效/.test(combinedText) ? 'expired' : (amount < 0 || /折抵|使用/.test(combinedText) ? 'spend' : 'gain');
          records.push(new CoinRecord({
            id: `dom_${stableHash([date.getTime(), combinedText, amount, index].join('|'))}`,
            timestampMs: date.getTime(),
            title: description ? `${title} - ${description}` : title,
            type,
            amountMicros: Math.abs(coinsToMicros(amount) || 0)
          }));
        } catch (error) {
          rejectedRecords += 1;
        }
      });

      records.sort((a, b) => b.timestampMs - a.timestampMs);
      return { records, rejectedRecords };
    }

    serializeError(error) {
      return {
        code: error?.code || 'UNKNOWN',
        message: error?.message || '未知錯誤',
        details: error?.details || {}
      };
    }

    getRecordsArray() {
      return Array.from(this.collectedRecords.values());
    }

    getAccountSummary() {
      return this.accountSummary;
    }

    getLastResult() {
      return this.lastResult;
    }
  }

  return {
    COIN_SCALE,
    CoinRecord,
    CollectorError,
    coinsToMicros,
    microsToCoins,
    APIClient: new APIClient()
  };
})();
