// Self-check for translateService.js — run: node app/src/features/translateService.demo.mjs
import assert from 'node:assert';
import { buildRequest, parseResponse, cacheKey, translateConfigured, TRANSLATE_PROVIDERS } from './translateService.js';

// Google: key in query, JSON POST, source omitted when empty (auto-detect).
const g = buildRequest('google', { text: 'hello', target: 'ja', key: 'K1' });
assert.ok(g.url.startsWith('https://translation.googleapis.com/') && g.url.includes('key=K1'));
const gBody = JSON.parse(g.init.body);
assert.equal(gBody.q, 'hello');
assert.equal(gBody.target, 'ja');
assert.ok(!('source' in gBody), 'no source → auto-detect');
assert.equal(JSON.parse(buildRequest('google', { text: 'x', target: 'ja', source: 'en', key: 'K' }).init.body).source, 'en');

// LibreTranslate: endpoint-based, trailing slash trimmed, optional api_key.
const l = buildRequest('libre', { text: 'hi', target: 'fr', endpoint: 'https://lt.example.com/', key: 'S' });
assert.equal(l.url, 'https://lt.example.com/translate');
assert.equal(JSON.parse(l.init.body).api_key, 'S');
assert.equal(JSON.parse(buildRequest('libre', { text: 'hi', target: 'fr', endpoint: 'https://lt.example.com' }).init.body).api_key, undefined);

// MyMemory: keyless GET with langpair (source defaults to en — it has no autodetect).
const m = buildRequest('mymemory', { text: 'good day', target: 'ja' });
assert.ok(m.url.includes('api.mymemory.translated.net') && m.url.includes(encodeURIComponent('en|ja')));
assert.equal(m.init, undefined);

// Parsers: happy paths.
assert.equal(parseResponse('google', { data: { translations: [{ translatedText: 'こんにちは' }] } }), 'こんにちは');
assert.equal(parseResponse('libre', { translatedText: 'bonjour' }), 'bonjour');
assert.equal(parseResponse('mymemory', { responseStatus: 200, responseData: { translatedText: 'こんにちは' } }), 'こんにちは');
assert.equal(parseResponse('mymemory', { responseStatus: '200', responseData: { translatedText: 'ok' } }), 'ok', 'string status coerced');

// Parsers: error shapes throw with the provider's message.
assert.throws(() => parseResponse('google', { error: { message: 'API key not valid' } }), /API key not valid/);
assert.throws(() => parseResponse('libre', { error: 'Invalid target' }), /Invalid target/);
assert.throws(() => parseResponse('mymemory', { responseStatus: 403, responseDetails: 'QUOTA EXCEEDED' }), /QUOTA/);

// Cache keys: stable per text, distinct across text/target/provider.
const cfg = { translateProvider: 'google', translateTarget: 'ja' };
assert.equal(cacheKey(cfg, 'same line'), cacheKey(cfg, 'same line'));
assert.notEqual(cacheKey(cfg, 'line a'), cacheKey(cfg, 'line b'));
assert.notEqual(cacheKey(cfg, 'x'), cacheKey({ ...cfg, translateTarget: 'fr' }, 'x'));
assert.notEqual(cacheKey(cfg, 'x'), cacheKey({ ...cfg, translateProvider: 'libre' }, 'x'));

// Configuration gating per provider.
assert.equal(translateConfigured({ translateProvider: 'mymemory' }), true);
assert.equal(translateConfigured({ translateProvider: 'google' }), false);
assert.equal(translateConfigured({ translateProvider: 'google', translateKey: 'k' }), true);
assert.equal(translateConfigured({ translateProvider: 'libre' }), false);
assert.equal(translateConfigured({ translateProvider: 'libre', translateEndpoint: 'https://x' }), true);
assert.equal(TRANSLATE_PROVIDERS.some((p) => p.id === 'google'), true, 'google is offered');

console.log('translateService.demo: all assertions passed ✅');
