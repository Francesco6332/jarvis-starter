import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb } from '../dist/web.js';

test('hosted web search keeps the API key server-side and returns dated source text', async t => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'server-only-test-key';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  const result = await searchWeb('notizie tecnologia di oggi', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer server-only-test-key');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.tools, [{ type: 'web_search_preview' }]);
    assert.match(body.input, /notizie tecnologia/);
    return Response.json({ output_text: 'Fonte: esempio.test (2 ottobre 2026). Risultato verificato.' });
  });
  assert.equal(result.query, 'notizie tecnologia di oggi');
  assert.match(result.text, /Fonte/);
  assert.ok(result.searchedAt);
});

test('web search requires the backend key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(searchWeb('articoli'), /chiave API mancante/);
  if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
});
