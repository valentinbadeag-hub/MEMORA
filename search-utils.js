(function (root, factory) {
  const search = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = search;
  root.MemoraSearch = search;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function matchesSearch(session, query) {
    if (!query) return true;
    const content = [
      new Date(session.created).toLocaleString(),
      session.transcript || '',
      session.notes || ''
    ].join(' ').toLocaleLowerCase();
    return content.includes(query.toLocaleLowerCase());
  }

  function excerptFor(text, query) {
    if (!query || !text) return '';
    const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (index < 0) return '';
    const start = Math.max(0, index - 70);
    const end = Math.min(text.length, index + query.length + 100);
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  return { matchesSearch, excerptFor };
});