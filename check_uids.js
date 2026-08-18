const crypto = require('crypto');

async function testBothUIDs() {
  const YUBIT_API_KEY    = 'XC5tLDGpVdMN8oqI15';
  const YUBIT_SECRET_KEY = '8ogwxJohIS2zN3kwPuW2ORBquH86YktJrcct';
  const YUBIT_API_BASE   = 'https://openapi.yubit.com';

  const tRes = await fetch('https://api-spot.weex.com/api/v3/time');
  const tJson = await tRes.json();
  const timeOffset = tJson.serverTime - Date.now();

  async function queryUID(uid) {
    const timestamp  = String(Date.now() + timeOffset);
    const recvWindow = '5000';
    const method     = 'GET';
    const path       = '/oapi/partner/affiliate/private/v1/validateUser';
    const payload    = 'uid=' + uid;

    const originalText = method.toUpperCase() + path + timestamp + YUBIT_API_KEY + recvWindow + payload;
    const hmac = crypto.createHmac('sha256', YUBIT_SECRET_KEY);
    hmac.update(originalText);
    const sign = hmac.digest('hex').toLowerCase();

    const headers = {
      'MF-ACCESS-API-KEY': YUBIT_API_KEY,
      'MF-ACCESS-SIGN': sign,
      'MF-ACCESS-TIMESTAMP': timestamp,
      'MF-ACCESS-RECV-WINDOW': recvWindow,
      'MF-ACCESS-SIGN-VERSION': '2',
      'Content-Type': 'application/json'
    };

    const res = await fetch(`${YUBIT_API_BASE}${path}?${payload}`, { method: 'GET', headers });
    const json = await res.json();
    console.log(`🔍 Query UID [${uid}] Result:`, JSON.stringify(json));
  }

  await queryUID('1079756460');
  await queryUID('1327382982');
}

testBothUIDs();
