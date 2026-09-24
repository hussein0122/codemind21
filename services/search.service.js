export async function searchWeb(query) {
  const value = String(query || '').trim();
  if (!value || value.length > 500) throw new Error('INVALID_SEARCH_QUERY');
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(value)}&format=json&no_html=1&skip_disambig=0`;
  const response = await fetch(url, { headers: { 'user-agent': 'CodeMind-AI/1.0' } });
  if (!response.ok) throw new Error(`SEARCH_HTTP_${response.status}`);
  const data = await response.json();
  return {
    query: value,
    source: 'DuckDuckGo Instant Answer API',
    abstract: data.AbstractText || '',
    abstractUrl: data.AbstractURL || '',
    relatedTopics: (data.RelatedTopics || []).slice(0, 8).map((item) => ({ text: item.Text || '', url: item.FirstURL || '' })).filter((item) => item.text)
  };
}
