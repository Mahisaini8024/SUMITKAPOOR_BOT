require('dotenv').config();
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN;
const BASE = `https://api.telegram.org/bot${token}`;

function call(method, data = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(`${BASE}/${method}`);
    const opts = {
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e){ resolve({raw:body});} });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  console.log('🔫 Kill step 1: setWebhook...');
  console.log('  ', await call('setWebhook', { url: 'https://example.com/kill' }));
  console.log('🔫 Kill step 2: deleteWebhook + drop pending...');
  console.log('  ', await call('deleteWebhook', { drop_pending_updates: true }));
  console.log('✅ Sessions killed. Launching bot...');
})().catch(e => console.error('ERR:', e));
