/**
 * Shopee Coin Record Filters
 * Performs allocation-conscious filtering for large record collections.
 */

window.ShopeeCoinFilters = (function () {
  'use strict';

  function filterRecords(records, rawKeyword = '', type = 'all', category = 'all') {
    const source = Array.isArray(records) ? records : [];
    const trimmedKeyword = String(rawKeyword || '').trim();
    const hasLatinLetters = /[a-z]/i.test(trimmedKeyword);
    const keyword = hasLatinLetters ? trimmedKeyword.toLowerCase() : trimmedKeyword;

    if (!keyword && type === 'all' && category === 'all') return source;

    const includesKeyword = value => {
      const text = String(value || '');
      return hasLatinLetters ? text.toLowerCase().includes(keyword) : text.includes(keyword);
    };

    return source.filter(record => {
      if (type !== 'all' && record?.type !== type) return false;
      if (category !== 'all' && record?.category !== category) return false;
      if (!keyword) return true;
      return includesKeyword(record?.title) ||
        includesKeyword(record?.orderSn) ||
        includesKeyword(record?.category) ||
        includesKeyword(record?.categoryRuleId) ||
        includesKeyword(record?.categoryExplanation);
    });
  }

  return { filterRecords };
})();
