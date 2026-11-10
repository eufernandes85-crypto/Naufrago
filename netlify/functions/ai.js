// Proxy de IA: a chave fica aqui no servidor, nunca no navegador.
const P = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
const KEY = { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY }[P];
const MODEL = process.env.AI_MODEL || { anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash' }[P];
const hits = new Map();
const out = (c, o) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

exports.handler = async (ev) => {
  if (!KEY) return out(503, { error: 'chave de API ausente' });
  const ao = process.env.ALLOWED_ORIGIN;
  if (ao) { const o = ev.headers.origin || ev.headers.referer || ''; if (!o.startsWith(ao)) return out(403, { error: 'origem nao permitida' }); }
  if (ev.httpMethod === 'GET') return out(200, { ok: true, provider: P, model: MODEL });
  if (ev.httpMethod !== 'POST') return out(405, { error: 'metodo' });
  const ip = String(ev.headers['x-nf-client-connection-ip'] || ev.headers['x-forwarded-for'] || '?').split(',')[0], now = Date.now();
  const l = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (l.length >= Number(process.env.RATE_PER_MIN || 30)) return out(429, { error: 'muitas chamadas' });
  l.push(now); hits.set(ip, l);
  let prompt = '';
  try { prompt = String(JSON.parse(ev.body || '{}').prompt || ''); } catch (e) {}
  if (!prompt || prompt.length > 16000) return out(400, { error: 'prompt invalido' });
  try {
    let r, j, text = '';
    if (P === 'anthropic') {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }) });
      j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
      text = (j.content || []).map(c => c.text || '').join('');
    } else if (P === 'openai') {
      r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY }, body: JSON.stringify({ model: MODEL, max_completion_tokens: 900, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
      j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
      text = j.choices[0].message.content || '';
    } else if (P === 'gemini') {
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json' } }) });
      j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
      text = (j.candidates[0].content.parts || []).map(p => p.text || '').join('');
    } else return out(500, { error: 'AI_PROVIDER invalido' });
    return out(200, { text });
  } catch (e) { return out(502, { error: String(e.message || e) }); }
};
