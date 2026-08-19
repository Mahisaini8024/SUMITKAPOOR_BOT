require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
let createCanvas, registerFont;
try {
  const canvasPkg = require('canvas');
  createCanvas = canvasPkg.createCanvas;
  registerFont = canvasPkg.registerFont;
} catch (e) {
  console.log('⚠️ Canvas module fallback active:', e.message);
}

// Register Roboto font checking both root directory and fonts/ subfolder
const fontPath1 = path.join(__dirname, 'fonts', 'Roboto.ttf');
const fontPath2 = path.join(__dirname, 'Roboto.ttf');
const fontPath  = fs.existsSync(fontPath1) ? fontPath1 : (fs.existsSync(fontPath2) ? fontPath2 : null);

if (fontPath && registerFont) {
  try {
    registerFont(fontPath, { family: 'CustomRoboto' });
    console.log('✅ CustomRoboto font registered for Canvas from:', fontPath);
  } catch (e) {
    console.error('⚠️ Font registration error:', e.message);
  }
} else {
  console.log('⚠️ Roboto.ttf font file not found or registerFont not available');
}

const token        = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID     = process.env.ADMIN_CHAT_ID; // Admin ka Telegram Chat ID

const WELCOME_PHOTO = fs.readFileSync(path.join(__dirname, 'photo_2026-08-07_13-35-02.jpg'));
const DATA_FILE     = path.join(__dirname, 'users.json');
const UID_FILE      = path.join(__dirname, 'approved_uids.json'); // ← Auto-verified UIDs list
const FALLBACK_GROUP_INVITE = process.env.VIP_GROUP_INVITE || 'https://t.me/+T-I4ZK6uUyU0ZmEx';
let vipChatId    = process.env.VIP_CHAT_ID    || null;
let logGroupId   = process.env.LOG_GROUP_ID   || null; // Admin Log Group
const YUBIT_SIGNUP  = 'https://www.yubit.com/register?inviteCode=WISEVIP';
const WEEX_SIGNUP   = 'https://weex.com/register?vipCode=abfm';

// ─── WEEX PARTNER API CONFIG ─────────────────────────────────
const WEEX_API_KEY    = process.env.WEEX_API_KEY    || '';
const WEEX_SECRET_KEY = process.env.WEEX_SECRET_KEY || '';
const WEEX_PASSPHRASE = process.env.WEEX_PASSPHRASE || '';
const WEEX_API_BASE   = 'https://api-spot.weex.com';

// ─── WEEX API TIME SYNC ─────────────────────────────────────
let timeOffset = 0;
async function syncWeexTime() {
  try {
    const tRes = await fetch(`${WEEX_API_BASE}/api/v3/time`);
    const tJson = await tRes.json();
    if (tJson && tJson.serverTime) {
      timeOffset = tJson.serverTime - Date.now();
      console.log(`⏰ WEEX Time synced! Server time offset: ${Math.round(timeOffset / 1000)}s`);
    }
  } catch (e) {
    console.error('⚠️ Time sync failed:', e.message);
  }
}
syncWeexTime();
setInterval(syncWeexTime, 10 * 60 * 1000); // Sync every 10 mins

// ─── WEEX API SIGNATURE HELPER ───────────────────────────────
function generateWeexSignature(timestamp, method, requestPath, queryString, body = '') {
  let message = timestamp + method.toUpperCase() + requestPath;
  if (queryString) message += '?' + queryString;
  if (body) message += body;
  const hmac = crypto.createHmac('sha256', WEEX_SECRET_KEY);
  hmac.update(message);
  return hmac.digest('base64');
}

function getWeexHeaders(method, requestPath, queryString, body = '') {
  const timestamp = String(Date.now() + timeOffset);
  const sign = generateWeexSignature(timestamp, method, requestPath, queryString, body);
  return {
    'ACCESS-KEY': WEEX_API_KEY,
    'ACCESS-SIGN': sign,
    'ACCESS-PASSPHRASE': WEEX_PASSPHRASE,
    'ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json'
  };
}

// ─── WEEX LIVE UID VERIFICATION ──────────────────────────────
async function verifyUIDViaWeexAPI(uid) {
  if (!WEEX_API_KEY || !WEEX_SECRET_KEY || !WEEX_PASSPHRASE) {
    console.log('⚠️ WEEX API keys not configured, falling back to local check');
    return { isReferral: isApprovedUID(uid), depositOk: false, deposit: '0', error: null, fallback: true };
  }

  try {
    // Step 1: Verify if UID belongs to our affiliate
    const verifyPath = '/api/v3/agency/verifyReferrals';
    const verifyQS = `userIds=${uid}`;
    const verifyHeaders = getWeexHeaders('GET', verifyPath, verifyQS);
    const verifyUrl = `${WEEX_API_BASE}${verifyPath}?${verifyQS}`;

    console.log(`🔍 WEEX API: Verifying UID ${uid}...`);
    const verifyRes = await fetch(verifyUrl, { method: 'GET', headers: verifyHeaders });
    const verifyJson = await verifyRes.json();
    console.log(`📡 WEEX Verify Response:`, JSON.stringify(verifyJson));

    // Handle API response - check if data is in result/data wrapper or direct array
    let verifyData = verifyJson;
    if (verifyJson.data) verifyData = verifyJson.data;
    else if (verifyJson.result) verifyData = verifyJson.result;

    if (!Array.isArray(verifyData) || verifyData.length === 0) {
      return { isReferral: false, depositOk: false, deposit: '0', error: 'UID not found in WEEX system' };
    }

    const isReferral = verifyData[0].isRefferal === true;
    if (!isReferral) {
      return { isReferral: false, depositOk: false, deposit: '0', error: null };
    }

    // Step 2: Check deposit amount
    const assetPath = '/api/v3/agency/getAssert';
    const assetQS = `userId=${uid}`;
    const assetHeaders = getWeexHeaders('GET', assetPath, assetQS);
    const assetUrl = `${WEEX_API_BASE}${assetPath}?${assetQS}`;

    console.log(`💰 WEEX API: Checking assets for UID ${uid}...`);
    const assetRes = await fetch(assetUrl, { method: 'GET', headers: assetHeaders });
    const assetJson = await assetRes.json();
    console.log(`📡 WEEX Asset Response:`, JSON.stringify(assetJson));

    let assetData = assetJson;
    if (assetJson.data) assetData = assetJson.data;
    else if (assetJson.result) assetData = assetJson.result;

    const depositTotal = parseFloat(assetData.depositTotalAmount || '0');
    const availBalance = parseFloat(assetData.availableBalance || '0');
    // User qualifies if deposit >= 100 OR available balance >= 100
    const depositOk = depositTotal >= 100 || availBalance >= 100;

    return {
      isReferral: true,
      depositOk,
      deposit: depositTotal.toFixed(2),
      balance: availBalance.toFixed(2),
      error: null
    };
  } catch (err) {
    console.error('❌ WEEX API Error:', err.message);
    // Fallback to local check on API failure
    return { isReferral: isApprovedUID(uid), depositOk: false, deposit: '0', error: err.message, fallback: true };
  }
}

// ─── YUBIT PARTNER API CONFIG ────────────────────────────────
const YUBIT_API_KEY    = process.env.YUBIT_API_KEY    || '';
const YUBIT_SECRET_KEY = process.env.YUBIT_SECRET_KEY || '';
const YUBIT_API_BASE   = 'https://openapi.yubit.com';

// ─── WEBSHARE STATIC IP PROXY CONFIG (Dedicated IP: 31.59.20.176) ───
const https = require('https');
let HttpsProxyAgent = null;
const STATIC_PROXY_URL = process.env.YUBIT_STATIC_PROXY || 'http://qnmoekzb:xxyeb710yxai@31.59.20.176:6754';

import('https-proxy-agent').then(m => {
  HttpsProxyAgent = m.HttpsProxyAgent;
  console.log('✅ Webshare Static IP Proxy Loaded! (Dedicated IP: 31.59.20.176)');
}).catch(e => console.error('⚠️ Proxy agent import error:', e.message));

// ─── YUBIT API FETCH (routed via Static IP Proxy 31.59.20.176) ───
function yubitFetch(path, queryString, headers) {
  return new Promise((resolve, reject) => {
    const urlStr = `${YUBIT_API_BASE}${path}${queryString ? '?' + queryString : ''}`;
    const urlObj = new URL(urlStr);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      timeout: 12000
    };

    if (HttpsProxyAgent && STATIC_PROXY_URL) {
      options.agent = new HttpsProxyAgent(STATIC_PROXY_URL);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, json: async () => json });
        } catch (e) {
          resolve({ status: res.statusCode, json: async () => ({ error: 'Invalid JSON', raw: data }) });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('YUBIT API Request Timeout via Static Proxy'));
    });

    req.end();
  });
}

// ─── YUBIT SERVER TIME SYNC ─────────────────────────────────
let yubitTimeOffset = 0;
async function syncYubitTime() {
  try {
    const res = await yubitFetch('/oapi/partner/affiliate/private/v1/validateUser', '', {});
    const json = await res.json();
    if (json && json.time) {
      yubitTimeOffset = Number(json.time) - Date.now();
      console.log(`⏰ YUBIT Time Synced! Offset: ${Math.round(yubitTimeOffset / 1000)}s`);
    }
  } catch (e) {
    console.log('⚠️ Yubit time sync check:', e.message);
  }
}
setTimeout(syncYubitTime, 1500);
setInterval(syncYubitTime, 5 * 60 * 1000); // sync every 5 min

// ─── YUBIT API SIGNATURE HELPER ──────────────────────────────
function generateYubitSignature(method, path, timestamp, apiKey, recvWindow, payload = '') {
  const originalText = method.toUpperCase() + path + timestamp + apiKey + recvWindow + payload;
  const hmac = crypto.createHmac('sha256', YUBIT_SECRET_KEY);
  hmac.update(originalText);
  return hmac.digest('hex').toLowerCase();
}

function getYubitHeaders(method, path, timestamp, apiKey, recvWindow, payload = '') {
  const sign = generateYubitSignature(method, path, timestamp, apiKey, recvWindow, payload);
  return {
    'MF-ACCESS-API-KEY': apiKey,
    'MF-ACCESS-SIGN': sign,
    'MF-ACCESS-TIMESTAMP': timestamp,
    'MF-ACCESS-RECV-WINDOW': recvWindow,
    'MF-ACCESS-SIGN-VERSION': '2',
    'Content-Type': 'application/json'
  };
}

// ─── YUBIT LIVE UID VERIFICATION ─────────────────────────────
async function verifyUIDViaYubitAPI(uid) {
  if (!YUBIT_API_KEY || !YUBIT_SECRET_KEY) {
    console.log('⚠️ YUBIT API keys not configured, falling back to local check');
    return { isReferral: isApprovedUID(uid), depositOk: false, deposit: '0', error: null, fallback: true };
  }

  try {
    const timestamp = String(Date.now() + yubitTimeOffset);
    const recvWindow = '10000';

    // Step 1: Validate User — check if this UID is a direct referral under our partner account
    const valPath = '/oapi/partner/affiliate/private/v1/validateUser';
    const valQS = `uid=${uid}`;
    const valHeaders = getYubitHeaders('GET', valPath, timestamp, YUBIT_API_KEY, recvWindow, valQS);

    console.log(`🔍 YUBIT API: Validating UID ${uid}...`);
    const valRes = await yubitFetch(valPath, valQS, valHeaders);
    const valJson = await valRes.json();
    console.log(`📡 YUBIT Validate Response:`, JSON.stringify(valJson));

    // If server returned time, update offset dynamically
    if (valJson.time) {
      yubitTimeOffset = Number(valJson.time) - Date.now();
    }

    // ─── IP Mismatch (code 26200012) ─────────────────────────────
    if (valJson.code === 26200012 || valJson.message === 'unmatched ip.') {
      console.log(`⚠️ YUBIT IP mismatch for UID ${uid} — using local DB fallback`);
      const localOk = isApprovedUID(uid);
      return { isReferral: localOk, depositOk: localOk, deposit: localOk ? '100.00' : '0.00', balance: localOk ? '100.00' : '0.00', ipFallback: true };
    }

    // ─── NOT a referral under Wise Advice ────────────────────────
    if (valJson.data === false || valJson.data === 'false') {
      console.log(`❌ YUBIT: UID ${uid} is NOT under Wise Advice referral`);
      return { isReferral: false, depositOk: false, deposit: '0.00', balance: '0.00', error: null };
    }

    // ─── API error / UID not found ────────────────────────────────
    if (valJson.code !== 0 && valJson.code !== '0' && valJson.data !== true) {
      console.log(`❌ YUBIT: UID ${uid} validation failed — code: ${valJson.code}, msg: ${valJson.message}`);
      return { isReferral: false, depositOk: false, deposit: '0.00', balance: '0.00', error: valJson.message || 'UID not found' };
    }

    // ─── UID IS a valid referral — now check balance ──────────────
    console.log(`✅ YUBIT: UID ${uid} confirmed under Wise Advice! Checking balance...`);

    const balPath = '/oapi/partner/affiliate/private/v1/get-user-all-balance';
    const balQS = `uid=${uid}`;
    const balTimestamp = String(Date.now() + yubitTimeOffset);
    const balHeaders = getYubitHeaders('GET', balPath, balTimestamp, YUBIT_API_KEY, recvWindow, balQS);

    console.log(`💰 YUBIT API: Checking balance for UID ${uid}...`);
    const balRes = await yubitFetch(balPath, balQS, balHeaders);
    const balJson = await balRes.json();
    console.log(`📡 YUBIT Balance Response:`, JSON.stringify(balJson));

    let totalBal = 0;
    if ((balJson.code === 0 || balJson.code === '0') && balJson.result && balJson.result.items && balJson.result.items.length > 0) {
      const item = balJson.result.items[0];
      totalBal = parseFloat(item.totalBalance || item.fundingBalance || item.availableBalance || '0');
    }

    const depositOk = totalBal >= 100;
    console.log(`💰 YUBIT: UID ${uid} balance = $${totalBal.toFixed(2)} | depositOk = ${depositOk}`);

    return {
      isReferral: true,
      depositOk,
      deposit: totalBal.toFixed(2),
      balance: totalBal.toFixed(2),
      error: null
    };
  } catch (err) {
    console.error('❌ YUBIT API Error:', err.message);
    return { isReferral: false, depositOk: false, deposit: '0.00', balance: '0.00', error: err.message, fallback: true };
  }
}

if (!token) { console.error('❌ TELEGRAM_BOT_TOKEN missing'); process.exit(1); }

const bot = new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
      allowed_updates: ['message', 'callback_query', 'chat_member', 'my_chat_member']
    }
  }
});

// Configure "OPEN ACCOUNT" Bot Menu Button to launch WEEX Register MiniApp/WebApp
bot.setChatMenuButton({
  menu_button: JSON.stringify({
    type: 'web_app',
    text: 'OPEN ACCOUNT',
    web_app: { url: WEEX_SIGNUP }
  })
}).then(() => console.log('✅ Chat Menu Button "OPEN ACCOUNT" set to WEEX MiniApp/WebApp!'))
  .catch(e => console.error('⚠️ Menu Button Set Error:', e.message));

console.log('🤖 Bot v6.5 starting... (VIP Member Left Alert Active)');

// Auto-detect and post Public Server IP to Admin Log Group on boot
fetch('https://api.ipify.org?format=json')
  .then(r => r.json())
  .then(d => {
    console.log(`🌐 SERVER PUBLIC IP: ${d.ip}`);
    sendToLogGroup(`🌐 *SERVER PUBLIC IP:* \`${d.ip}\`\n\n📌 Send this IP to Yubit Team (@YUBIT_BEN / @YUBIT_CS03) to whitelist Yubit API!`);
  })
  .catch(e => console.error('⚠️ Could not fetch public IP:', e.message));

// /ip - Instant command to check server public IP
bot.onText(/\/ip/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    send(chatId, `🌐 *SERVER PUBLIC IP:* \`${data.ip}\`\n\n📌 Send this IP to Yubit Team (@YUBIT_BEN / @YUBIT_CS03) to whitelist Yubit API!`);
  } catch (e) {
    send(chatId, `⚠️ Error fetching IP: ${e.message}`);
  }
});

// ─── 5. VIP MEMBER CHURN & LEFT MONITOR ────────────────────────
bot.on('chat_member', async (update) => {
  try {
    const oldStatus = update.old_chat_member ? update.old_chat_member.status : '';
    const newStatus = update.new_chat_member ? update.new_chat_member.status : '';

    // Check if member left or was kicked (status changed from member/admin to left/kicked)
    const isLeave = (oldStatus === 'member' || oldStatus === 'administrator') && 
                    (newStatus === 'left' || newStatus === 'kicked');

    if (!isLeave) return;

    const user = update.new_chat_member.user;
    const userId = user.id;
    const userName = user.username ? `@${user.username}` : user.first_name || 'User';

    // Find user in database
    const uDb = loadUsers();
    const uData = uDb[userId] || {};
    const uid = uData.yubitUID || 'N/A';
    const rawExch = (uData.exchangeChoice || uData.q3 || 'N/A').toUpperCase();
    const exchBadge = rawExch.includes('WEEX') ? '🌐 WEEX' : rawExch.includes('YUBIT') ? '🟡 YUBIT' : 'N/A';
    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

    const oneLineText = `🚨 *VIP MEMBER LEFT:* *${escMd(user.first_name || 'User')}* (${escMd(userName)}) | UID: \`${uid}\``;

    console.log(`🚨 VIP Member Left Alert: User ${userId} (${userName}) left channel ${update.chat.title || update.chat.id}`);

    // 1. Send Direct DM to User notifying them about VIP deactivation
    const userDMText = 
`⚠️ *VIP ACCESS DEACTIVATED*
${S}
Hi *${escMd(user.first_name || 'User')}*, you have exited the *Wise Advice VIP Channel*.

📌 Your VIP membership status is now deactivated. 
💰 To rejoin the VIP channel, make sure your exchange account (WEEX / YUBIT) has *$100+ deposit*, then use the menu below to re-verify your UID.
${S}
👇 *Use /start to re-verify & get a new VIP link!*`;

    bot.sendMessage(userId, userDMText, { parse_mode: 'Markdown' })
       .catch(e => console.log(`ℹ️ Could not send DM to user ${userId} on leave:`, e.message));

    // 2. Send 1-Line Alert to Data Log Group with View Full Details button
    if (logGroupId) {
      bot.sendMessage(logGroupId, oneLineText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `👤 View Full Details (${escMd(user.first_name || 'User')})`, callback_data: `view_left_user_${userId}` }]
          ]
        }
      }).catch(e => console.error('❌ Left Alert send error:', e.message));
    }
  } catch (err) {
    console.error('❌ Chat member update error:', err.message);
  }
});

// ─── ADMIN LOG GROUP HELPER ───────────────────────────────────
async function sendToLogGroup(text) {
  if (!logGroupId) return;
  try {
    await bot.sendMessage(logGroupId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (e) {
    console.error('❌ Log Group send error:', e.message);
  }
}

// ─── AUTOMATED DAILY MIDNIGHT BACKUP (12:00 AM) ──────────────
function sendDailyBackupToLogGroup() {
  if (!logGroupId) return;
  const u = loadUsers();
  const list = Object.values(u);
  if (!list.length) return;

  const header = 'Name,Country,Capital,Exchange,Email,Telegram,Mobile,UID,Status,ChatID,Date';
  const rows = list.map(d => [
    d.firstName || '', d.q1 || '', d.q2 || '', d.q3 || '',
    d.q4 || '', d.q5 || '', d.q6 || '', d.yubitUID || '',
    d.status || '', d.chatId || '',
    d.completedAt ? new Date(d.completedAt).toLocaleString('en-IN') : ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv     = [header, ...rows].join('\n');
  const tmpFile = path.join(__dirname, `daily_backup_${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, csv, 'utf8');

  const todayStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  bot.sendDocument(logGroupId, tmpFile, {
    caption: `📦 *AUTOMATED DAILY BACKUP REPORT*\n━━━━━━━━━━━━━━━━━━━━\n🗓️ *Date:* \`${todayStr}\`\n👥 *Total Registered Leads:* \`${list.length}\`\n💾 *File:* \`Full Data Backup.csv\`\n\n⚡ _Automated Midnight Backup System Active_`,
    parse_mode: 'Markdown'
  }).then(() => {
    console.log(`✅ Daily Automated Backup sent to Log Group (${list.length} users)`);
  }).catch(e => {
    console.error('❌ Daily Backup Send Error:', e.message);
  }).finally(() => {
    try { fs.unlinkSync(tmpFile); } catch(_) {}
  });
}

// Check every minute if it's 12:00 AM (00:00) IST
let lastBackupDate = '';
setInterval(() => {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  // Format: "13/08/2026, 00:00:15"
  const [datePart, timePart] = now.split(', ');
  if (timePart && timePart.startsWith('00:00') && lastBackupDate !== datePart) {
    lastBackupDate = datePart;
    console.log('⏰ Triggering Daily Midnight Backup...');
    sendDailyBackupToLogGroup();
  }
}, 30000);


// ─── 1-LINE MOBILE-PERFECT LEAD NOTIFICATION ENGINE ─────────
async function sendLeadToLogGroup(data, uid, status, chatId, extraInfo = '') {
  if (!logGroupId) return;
  const name     = data.firstName || 'User';
  const rawExch  = (data.exchangeChoice || data.q3 || 'WEEX').toUpperCase();
  const exchBadge= rawExch.includes('WEEX') ? '🟢 WEEX' : '🟡 YUBIT';
  const tgHandle = data.q5 || (data.userName ? `@${data.userName}` : '@User');

  let oneLineText = '';
  if (status === 'approved') {
    const balStr = extraInfo ? ` | $${parseFloat(extraInfo).toFixed(2)}` : '';
    oneLineText = `✅ *VIP APPROVED:* *${escMd(name)}* (${escMd(tgHandle)}) | *${exchBadge}* | UID: \`${uid || 'N/A'}\`${balStr}`;
  } else if (status === 'deposit_low') {
    const balStr = extraInfo ? ` | $${parseFloat(extraInfo).toFixed(2)}` : ' | $0.00';
    oneLineText = `⚠️ *DEPOSIT LOW:* *${escMd(name)}* (${escMd(tgHandle)}) | *${exchBadge}* | UID: \`${uid || 'N/A'}\`${balStr}`;
  } else if (status === 'not_found') {
    oneLineText = `❌ *NOT REGISTERED:* *${escMd(name)}* (${escMd(tgHandle)}) | *${exchBadge}* | UID: \`${uid || 'N/A'}\``;
  } else {
    oneLineText = `⚡ *NEW LEAD:* *${escMd(name)}* (${escMd(tgHandle)}) | *${exchBadge}* | UID: \`${uid || 'N/A'}\``;
  }

  const opts = {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: `👤 View Full Details (${escMd(name)})`, callback_data: `view_user_${chatId}` }]
      ]
    }
  };

  bot.sendMessage(logGroupId, oneLineText, opts).catch(e => console.error('❌ Lead card send error:', e.message));
}


/**
 * Generate 1-Time Single-Use VIP Group Invite Link (member_limit: 1)
 */
async function createOneTimeVIPLink(userId, userName = 'VIP Member') {
  const targetGroup = process.env.VIP_CHAT_ID || vipChatId;
  if (targetGroup) {
    try {
      const expireDate = Math.floor(Date.now() / 1000) + 15 * 60; // 15 mins validity
      const linkObj = await bot.createChatInviteLink(targetGroup, {
        name: `VIP - ${userId}`,
        expire_date: expireDate,
        member_limit: 1,
        creates_join_request: false
      });
      if (linkObj && linkObj.invite_link) {
        console.log(`⚡ Created 1-time single-use VIP link for user ${userId}: ${linkObj.invite_link}`);
        return linkObj.invite_link;
      }
    } catch (err) {
      console.error(`⚠️ createChatInviteLink failed for Chat ID "${targetGroup}":`, err.message);
      if (err.message.includes('chat not found') || err.message.includes('not found')) {
        console.error(`👉 REASON: The Bot is NOT added as an Admin to group ${targetGroup} yet, or the Chat ID is wrong.`);
      } else if (err.message.includes('rights') || err.message.includes('admin')) {
        console.error(`👉 REASON: The Bot is in the group, but lacks "Invite Users via Link" admin permission.`);
      }
    }
  }
  return FALLBACK_GROUP_INVITE;
}


// Set Chat Menu Button (OPEN ACCOUNT)
bot.setChatMenuButton({
  menu_button: JSON.stringify({
    type: 'web_app',
    text: 'OPEN ACCOUNT',
    web_app: { url: YUBIT_SIGNUP }
  })
}).catch(() => {});

// ─── SEPARATORS / PROGRESS ───────────────────────────────────
const S = '━━━━━━━━━━━━━━━━━━━━';
function progressBar(step, total = 6) {
  return '▰'.repeat(step) + '▱'.repeat(total - step) + ` ${step}/${total}`;
}
function escMd(s) { return String(s).replace(/[_*[\]`]/g, '\\$&'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function isAdmin(id) { return ADMIN_ID && String(id) === String(ADMIN_ID); }

// ─── UID DATABASE ─────────────────────────────────────────────
// approved_uids.json = { "12345678": true, "87654321": true, ... }
function loadUIDs() {
  try { return JSON.parse(fs.readFileSync(UID_FILE, 'utf8')); }
  catch (_) { return {}; }
}
function saveUIDs(db) { fs.writeFileSync(UID_FILE, JSON.stringify(db, null, 2)); }
function isApprovedUID(uid) { const db = loadUIDs(); return !!db[String(uid).trim()]; }
function addUID(uid) { const db = loadUIDs(); db[String(uid).trim()] = true; saveUIDs(db); }
function removeUID(uid) { const db = loadUIDs(); delete db[String(uid).trim()]; saveUIDs(db); }
function countUIDs() { return Object.keys(loadUIDs()).length; }

// ─── USER DATA ────────────────────────────────────────────────
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (_) { return {}; }
}
function saveUsers(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
let users = loadUsers();
const userState = {};
function getState(id) {
  if (!userState[id]) userState[id] = { step: 0, data: { startedAt: new Date().toISOString() } };
  return userState[id];
}
function setState(id, s) { userState[id] = s; }
function resetState(id) { userState[id] = { step: 0, data: { startedAt: new Date().toISOString() } }; }
function saveFinal(id, d) {
  users[id] = { ...d, completedAt: new Date().toISOString(), chatId: id };
  saveUsers(users);
  delete userState[id];
}

// ─── KEYBOARDS ────────────────────────────────────────────────
const rkGrid = (arr1d, cols = 3) => {
  const rows = [];
  for (let i = 0; i < arr1d.length; i += cols) {
    rows.push(arr1d.slice(i, i + cols).map(label => ({ text: label })));
  }
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: true } };
};

const OPTIONS_LIST = {
  q1: ['🇮🇳 India', '🇵🇰 Pakistan', '🌍 Europe', '🇬🇧 UK', '🇺🇸 USA', '🇨🇳 China', '🇰🇷 Korea', '🇯🇵 Japan', '🌐 Others'],
  q2: ['Below $100', '$100 to $1000', '$1000 to $10000', '$10000 to $25000', '$25000 to $100000', '$100000 and above'],
  q3: ['Binance', 'Bybit', 'Weex', 'Blofin', 'Bingx', 'Bitunix', 'Yubit', 'OKX', 'Other']
};
const mk  = arr2d => ({ inline_keyboard: arr2d.map(r => r.map(l => ({ text: l, callback_data: l }))) });
const mkD = ()    => ({ inline_keyboard: [
  [{ text: 'What Is Deposit Bonus ?', callback_data: 'INFO_DEPOSIT' }],
  [{ text: 'What is Volume Bonus ?',  callback_data: 'INFO_VOLUME' }],
  [{ text: 'Want Free Vip Signals',   callback_data: 'WANT_SIGNALS' }]
]});
const mkVIP = ()  => ({ inline_keyboard: [
  [{ text: 'Signup on Yubit',                          callback_data: 'DEC_NEW'   }],
  [{ text: 'Already Member of Yubit Under WiseAdvice', callback_data: 'DEC_EXIST' }]
]});
const rkD = ()    => ({
  reply_markup: {
    keyboard: [
      [{ text: 'What Is Deposit Bonus ?' }],
      [{ text: 'What is Volume Bonus ?' }],
      [{ text: 'Want Free Vip Signals' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
});
const rkSignalsMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: 'WEEX' }],
      [{ text: 'YUBIT' }],
      [{ text: '🔙 Back to Main Menu' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
});
const rkWeexSub = () => ({
  reply_markup: {
    keyboard: [
      [{ text: 'Signup on WEEX' }],
      [{ text: 'Already a member on WEEX under Wise Advice' }],
      [{ text: '🔙 Back to Exchanges' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
});
const rkYubitSub = () => ({
  reply_markup: {
    keyboard: [
      [{ text: 'Signup on YUBIT' }],
      [{ text: 'Already a member on YUBIT under Wise Advice' }],
      [{ text: '🔙 Back to Exchanges' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
});

// ─── VALIDATION ───────────────────────────────────────────────
const vEmail    = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const vMobile   = v => /^\+[1-9]\d{7,14}$/.test(v.replace(/[\s-]/g, ''));
const vTelegram = v => { const t = v.trim(); return t.startsWith('@') && t.length >= 5; };
const vUID      = v => /^\d{4,20}$/.test(v.trim());

// ─── MESSAGES ─────────────────────────────────────────────────
const CAPTIONS = [
  `✦ *WISE ADVICE × WEEX* ✦\n${S}\n💰 *$1,000,000 CHALLENGE*\n\n📊 Entry ›› $250,000 USDT\n🏆 Target ›› $1,000,000 USDT\n⚡ ROI ›› 4× in 1 Challenge\n${S}\n👋 Hey *{FN}* — let's go!\n${S}\n🔗 *Signup via Wise Advice:*\n${WEEX_SIGNUP}`,
  `👑 *MILLION DOLLAR CLUB* 👑\n${S}\n🚀 *WEEX × WISE ADVICE QUEST*\n\n⚔️  $250K ──► $1M\n🎯  1 Account · 1 Goal\n${S}\n🔥 Welcome *{FN}*!\n${S}\n🔑 *Register via Wise Advice:*\n${WEEX_SIGNUP}`,
  `💎 *ELITE TRADING ARENA* 💎\n${S}\n🏆 *WISE ADVICE × WEEX — $1M*\n\n  💵 Start ›  $250K USDT\n  🎯 Goal  ›  $1M USDT\n  📈 Skill + Discipline\n${S}\n🔥 *{FN}* — are you ready?\n${S}\n⚡ *Join WEEX (Wise Advice):*\n${WEEX_SIGNUP}`,
  `🔱 *WISE ADVICE ROYALTY* 🔱\n${S}\n🎯 *$1M TRADING CHALLENGE*\n\n  🏛️ Only Serious Traders\n  📡 Premium Signals\n  💰 Life-Changing Money\n${S}\n✨ Namaste *{FN}* — welcome!\n${S}\n🚀 *Signup via Wise Advice:*\n${WEEX_SIGNUP}`,
];
const INTROS = [
  fn => `🔐 *VIP ACCESS PORTAL*\n${S}\n👋 Salaam *${fn}*!\n\nComplete 6-step verification to unlock the *$1M Group*. All fields are *mandatory*.\n${S}\n📊 Progress: ${progressBar(0)}\n${S}\n📌 *Step 1 of 6 — Region*\n🌍 Where are you from?`,
  fn => `🎯 *CHALLENGE REGISTRATION*\n${S}\n⚡ *${fn}* — 6 steps to VIP!\nAll fields compulsory.\n${S}\n📊 Progress: ${progressBar(0)}\n${S}\n📌 *Step 1 of 6 — Country*\n🌍 Select your location:`,
  fn => `💎 *$1M ELITE SQUAD*\n${S}\n👋 Welcome *${fn}*!\n6 Steps · All Mandatory.\n${S}\n📊 Progress: ${progressBar(0)}\n${S}\n📌 *Step 1 of 6 — Location*\n🌍 Choose your country:`,
];
const Q1C = [
  v => `✅ *Step 1 Complete!*\n${S}\n📍 Country: *${escMd(v)}*\n📊 Progress: ${progressBar(1)}\n${S}\n📌 *Step 2 of 6 — Capital*\n💰 Your portfolio size?`,
  v => `🌍 *Locked ›› ${escMd(v)}*\n${S}\n📊 Progress: ${progressBar(1)}\n${S}\n📌 *Step 2 of 6 — Capital*\n💵 Select your fund range:`,
];
const Q2C = [
  v => `✅ *Step 2 Complete!*\n${S}\n💰 Capital: *${escMd(v)}*\n📊 Progress: ${progressBar(2)}\n${S}\n📌 *Step 3 of 6 — Exchange*\n📊 Which platform you trade?`,
  v => `💰 *Locked ›› ${escMd(v)}*\n${S}\n📊 Progress: ${progressBar(2)}\n${S}\n📌 *Step 3 of 6 — Exchange*\n🏛️ Select your exchange:`,
];
const Q3C = [
  v => `✅ *Step 3 Complete!*\n${S}\n📊 Exchange: *${escMd(v)}*\n📊 Progress: ${progressBar(3)}\n${S}\n📌 *Step 4 of 6 — Email*\n📧 Enter your email ID:\n\nExample: name@gmail.com`,
];
const STEP5 = [
  `✅ *Step 4 Complete!*\n${S}\n📊 Progress: ${progressBar(4)}\n${S}\n📌 *Step 5 of 6 — Telegram*\n💬 Enter your @username:\n\nExample: @yourusername`,
];
const STEP6 = [
  `✅ *Step 5 Complete!*\n${S}\n📊 Progress: ${progressBar(5)}\n${S}\n📌 *Step 6 of 6 — Mobile* 🏁\n📱 Number with country code:\n\nExample: +919876543210`,
];
const FINAL_OK = [
  (fn, d) => `🏆 *REGISTRATION COMPLETE!*\n${S}\n🎉 Congrats, *${fn}*!\n📊 Progress: ${progressBar(6)} ✅\n${S}\n📋 *YOUR SUMMARY:*\n\n🌍 Country  › ${escMd(d.q1)}\n💰 Capital  › ${escMd(d.q2)}\n📊 Exchange › ${escMd(d.q3)}\n📧 Email    › ${escMd(d.q4)}\n💬 Telegram › ${escMd(d.q5)}\n📱 Mobile   › ${d.q6}\n${S}\n🔓 Access submitted!\n👇 Join VIP group below:`,
];
const DEC_MSGS = [
  () => `🔥 *WISE ADVICE × YUBIT VIP* 🔥\n${S}\nWe will give you:\n• 📡 *Free VIP signals* for futures trading in Our VIP Group.\n• 💰 *Deposit Bonus*\n• 📈 *Volume Bonus*\n\n⚠️ *Only condition:* You have to Signup using our Link and you must have *$100* in your Yubit Wallet to join our VIP group.\n${S}\n👇 *Select an option below:*`
];
const UID_MSGS = [
  fn => `✅ *WISE ADVICE MEMBER FOUND*\n${S}\nGreat, *${fn}*! You're already family.\n${S}\n🔑 *Final Step — Yubit UID*\n\n💡 *How to find your UID:*\n1️⃣ Open Yubit App\n2️⃣ Go to Profile / Me\n3️⃣ Copy UID (numbers only)\n\n⚡ Min *$100 balance* needed.\n${S}\n👇 Paste your *YUBIT UID*:`,
];
const BONUS_MSGS = [
  fn => `🎁 *BONUS PACKAGE UNLOCKED*\n${S}\n*${fn}*, signup via Wise Advice\nand claim *3-Tier Bonus:*\n${S}\n1️⃣ 💰 *DEPOSIT BONUS*\n   Extra USDT on 1st deposit\n\n2️⃣ 📈 *VOLUME BONUS*\n   Daily cashback on trades\n\n3️⃣ 📡 *PREMIUM SIGNALS*\n   VIP buy/sell signals\n${S}\n🔗 *REGISTER (WISE ADVICE):*\n${YUBIT_SIGNUP}\n${S}\n✅ Signup → Deposit → VIP 👇`,
];
const ERR = {
  email:    [`❌ *Invalid Email*\n${S}\nFormat: *name@domain.com*\n\nExample: trader@gmail.com\n${S}\n🔄 Re-enter your email:`],
  telegram: [`❌ *Invalid Telegram ID*\n${S}\nMust start with *@*\nMin 5 characters.\n\nExample: @myusername\n${S}\n🔄 Re-enter your handle:`],
  mobile:   [`❌ *Invalid Mobile Number*\n${S}\nMust include *country code*\n\nExample: +919876543210\n${S}\n🔄 Re-enter with +code:`],
  uid:      [`❌ *Invalid Yubit UID*\n${S}\nUID = numbers only (4+ digits)\n\nExample: 12345678\n${S}\n🔄 Enter UID again:`],
};

// ─── SEND HELPERS ─────────────────────────────────────────────
const send = (id, text, opts={}) => bot.sendMessage(id, text, { parse_mode: 'Markdown', ...opts });
const sendStep1 = (id, fn) => send(id, pick(INTROS)(fn), rkGrid(OPTIONS_LIST.q1, 3));
const sendStep2 = (id, v)  => send(id, pick(Q1C)(v),     rkGrid(OPTIONS_LIST.q2, 3));
const sendStep3 = (id, v)  => send(id, pick(Q2C)(v),     rkGrid(OPTIONS_LIST.q3, 3));
const sendStep4 = (id, v)  => send(id, pick(Q3C)(v));
const sendStep5 = (id)     => send(id, pick(STEP5));
const sendStep6 = (id)     => send(id, pick(STEP6));

async function sendDecision(id, data, fn) {
  await send(id, pick(DEC_MSGS)(fn, data), rkD());
}
async function sendProtectedVIPLink(chatId, textMsg, link) {
  const fullText = `${textMsg}\n\n🔗 *VIP GROUP INVITE LINK:*\n${link}\n\n⚠️ *Note:* This link is single-use only (1 join limit). The moment 1 person joins, Telegram automatically revokes and expires this link.`;
  return bot.sendMessage(chatId, fullText, {
    parse_mode: 'Markdown',
    protect_content: true, // 🚫 Disables forwarding & content saving in Telegram
    disable_web_page_preview: true
  });
}

async function sendGroupLink(id, data, fn) {
  await send(id, pick(FINAL_OK)(fn, data));
  const link = await createOneTimeVIPLink(id, fn);
  await sendProtectedVIPLink(id, `🏆 *YOUR VIP GROUP ACCESS:*\n${S}\n🎉 Verified under Wise Advice!`, link);
}

async function sendNewUser(id, fn) {
  await send(id, pick(BONUS_MSGS)(fn), { disable_web_page_preview: true });
  const link = await createOneTimeVIPLink(id, fn);
  await sendProtectedVIPLink(id, `🏆 *YOUR VIP GROUP INVITE:*\n${S}`, link);
}

// ─── UID VERIFICATION RESULT ──────────────────────────────────
async function handleUIDResult(chatId, uid, data, approved) {
  const fn = data.firstName || 'User';

  if (approved) {
    // ✅ UID is in our approved list — registered under Wise Advice
    saveFinal(chatId, { ...data, yubitUID: uid, status: 'approved' });
    const link = await createOneTimeVIPLink(chatId, fn);
    await sendProtectedVIPLink(
      chatId,
      `🎉 *UID VERIFIED SUCCESSFULLY!*\n${S}\n✅ UID *${uid}* confirmed under *Wise Advice*!\n💰 You qualify for VIP access!\n${S}\n🏆 *ONE-TIME VIP GROUP ACCESS:*`,
      link
    );
    // 📢 Send 1-line VIP Approved Alert to Admin Log Group with details button
    sendLeadToLogGroup(data, uid, 'approved', chatId, data.balance || data.deposit || '');
    console.log(`✅ UID ${uid} approved for chatId ${chatId}`);
  } else {
    // ❌ UID not found in our list — not registered under Wise Advice
    users[chatId] = { ...data, yubitUID: uid, status: 'not_found', chatId };
    saveUsers(users);
    // Keep user state in Step 8 so they can directly enter new UID without /start!
    const st = getState(chatId);
    st.step = 8;
    setState(chatId, st);

    const exch = (data && data.exchangeChoice) || 'YUBIT';
    const signupLink = exch === 'WEEX' ? WEEX_SIGNUP : YUBIT_SIGNUP;
    const exchName   = exch === 'WEEX' ? 'WEEX' : 'Yubit';

    await send(chatId,
      `❌ *UID Not Registered*\n${S}\nUID *${uid}* is not registered under Wise Advice ${exchName}.\n${S}\n🔗 *Register here to qualify:*\n${signupLink}\n${S}\n💰 Deposit *$100+*, then send your new UID below:`,
      { disable_web_page_preview: true }
    );
    // 📢 Send 1-line Not Registered Alert to Admin Log Group with details button
    sendLeadToLogGroup(data, uid, 'not_found', chatId);
    console.log(`❌ UID ${uid} NOT found for chatId ${chatId}`);
  }
}

// ─── ERROR HANDLERS ───────────────────────────────────────────
bot.on('polling_error', e => console.error('❌ Polling:', e.message.substring(0, 120)));
bot.on('error', e => console.error('❌ Bot:', e.message));
process.on('uncaughtException', e => console.error('💥 Uncaught:', e.message));
process.on('SIGINT', () => { bot.stopPolling(); process.exit(0); });

// ─── USER COMMANDS ────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id, fn = msg.from.first_name || 'User';
  resetState(id);
  try {
    await bot.sendPhoto(id, WELCOME_PHOTO, {
      caption: pick(CAPTIONS).replace('{FN}', fn),
      parse_mode: 'Markdown', disable_web_page_preview: true
    });
  } catch (e) { console.error('❌ Photo:', e.message); }
  const st = getState(id);
  st.step = 1; st.data.firstName = fn; setState(id, st);
  await sendStep1(id, fn);
});

bot.onText(/\/reset/, msg => {
  resetState(msg.chat.id);
  send(msg.chat.id, `🔄 *Form Reset!*\n\nSend /start to begin again.`);
});
bot.onText(/\/help/, msg => {
  send(msg.chat.id, `📋 *HELP MENU*\n${S}\n/start — Begin registration\n/reset — Restart the form\n/myid  — Get your Chat ID`);
});
bot.onText(/\/info/, msg => {
  send(msg.chat.id, `ℹ️ *SUMIT KAPOOR BOT*\n${S}\nv4.0.0 · Auto UID Verify\n✅ $1M Trading Challenge`);
});
bot.onText(/\/myid/, msg => {
  send(msg.chat.id, `🆔 *Your Telegram Chat ID:*\n\`${msg.chat.id}\`\n\n_Deta to admin for .env setup_`);
});

bot.onText(/\/viplink/, async (msg) => {
  const id = msg.chat.id;
  const fn = msg.from.first_name || 'User';
  const u = loadUsers();
  if (u[id] && u[id].status === 'approved') {
    const link = await createOneTimeVIPLink(id, fn);
    await sendProtectedVIPLink(
      id,
      `🔑 *YOUR ONE-TIME PROTECTED VIP ACCESS:*\n${S}\n⚠️ *Notice:* This button works ONLY 1 TIME for you. Copying and forwarding are disabled. Once you join, the link expires immediately.\n${S}\n👇 *Tap below to Join VIP Group:*`,
      link
    );
  } else {
    await send(id, `❌ *Access Denied*\n${S}\nYou have not completed UID verification yet.\nSend /start to verify your UID and unlock VIP access.`);
  }
});

// ─── ADMIN COMMANDS ───────────────────────────────────────────
// /setvipchat - Set VIP group chat ID for 1-time single-use invite link generation
bot.onText(/\/setvipchat(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel';
  
  let targetChatId = match && match[1] ? match[1].trim() : (isGroup ? String(chatId) : null);

  if (!targetChatId && !isGroup) {
    return send(chatId, `❌ Usage:\n• Send \`/setvipchat\` inside your VIP Group, OR\n• Send \`/setvipchat -100xxxxxxxxxx\` here.`);
  }

  if (msg.chat.type === 'private' && !isAdmin(chatId)) return;

  vipChatId = targetChatId;
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('VIP_CHAT_ID=')) {
      envContent = envContent.replace(/VIP_CHAT_ID=.*/, `VIP_CHAT_ID=${vipChatId}`);
    } else {
      envContent += `\nVIP_CHAT_ID=${vipChatId}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) {
    console.error('Error updating .env with VIP_CHAT_ID:', e.message);
  }

  await send(chatId, `✅ *VIP Group ID Set Successfully!*\n${S}\n📌 VIP Chat ID: \`${vipChatId}\`\n\n⚡ 1-Time single-use invite links (\`member_limit: 1\`) are now ACTIVE for all verified VIP members!`);
  console.log(`✅ VIP Chat ID updated to: ${vipChatId}`);
});

// /adduid 12345678 — Add single UID to approved list
bot.onText(/\/adduid (.+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const uid = match[1].trim();
  if (!vUID(uid)) return send(msg.chat.id, `❌ Invalid UID format: ${uid}`);
  addUID(uid);
  send(msg.chat.id, `✅ UID *${uid}* added to approved list.\nTotal: ${countUIDs()} UIDs`);
  console.log(`✅ Admin added UID: ${uid}`);
});

// /removeuid 12345678 — Remove UID from approved list
bot.onText(/\/removeuid (.+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const uid = match[1].trim();
  removeUID(uid);
  send(msg.chat.id, `🗑️ UID *${uid}* removed.\nTotal: ${countUIDs()} UIDs`);
});

// /checkuid 12345678 — Check UID via Live APIs (WEEX + YUBIT) & Local DB
bot.onText(/\/checkuid (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const uid = match[1].trim();
  const chatId = msg.chat.id;
  await send(chatId, `🔍 Checking UID *${uid}* via Live APIs (WEEX & YUBIT)...`);
  
  const localOk = isApprovedUID(uid);
  const weexRes = await verifyUIDViaWeexAPI(uid);
  const yubitRes = await verifyUIDViaYubitAPI(uid);

  let response = `📊 *LIVE UID CHECK RESULT: ${uid}*\n${S}\n`;
  response += `📌 *Local Whitelist DB:* ${localOk ? '✅ Approved' : '❌ Not Found'}\n${S}\n`;

  response += `🔵 *WEEX LIVE API:*\n`;
  if (weexRes.fallback) {
    response += `⚠️ *Status:* ${weexRes.error || 'Keys Not Configured'}\n`;
  } else {
    response += `🌐 *Referral:* ${weexRes.isReferral ? '✅ Yes (Wise Advice)' : '❌ No'}\n`;
    response += `💰 *Deposit:* $${weexRes.deposit || '0'}\n`;
    response += `📊 *Deposit OK ($100+):* ${weexRes.depositOk ? '✅ Yes' : '❌ No'}\n`;
  }
  response += `${S}\n`;

  response += `🟡 *YUBIT LIVE API:*\n`;
  if (yubitRes.fallback) {
    response += `⚠️ *Status:* ${yubitRes.error || 'Keys Not Configured'}\n`;
  } else {
    response += `🌐 *Referral:* ${yubitRes.isReferral ? '✅ Yes (Wise Advice)' : '❌ No'}\n`;
    response += `💰 *Balance:* $${yubitRes.balance || '0'}\n`;
    response += `📊 *Balance OK ($100+):* ${yubitRes.depositOk ? '✅ Yes' : '❌ No'}\n`;
  }
  response += S;

  send(chatId, response);
});

// /listuid — Show all approved UIDs
bot.onText(/\/?(listuid|📋 Approved UIDs)/i, (msg) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;
  const db = loadUIDs();
  const keys = Object.keys(db);
  if (!keys.length) return send(chatId, `📋 No approved UIDs yet.\n\nUse /adduid or upload a file.`);
  const chunks = [];
  for (let i = 0; i < keys.length; i += 50) {
    chunks.push(keys.slice(i, i + 50).join('\n'));
  }
  send(chatId, `📋 *Approved UIDs (${keys.length} total):*`);
  chunks.forEach(chunk => send(chatId, `\`\`\`\n${chunk}\n\`\`\``));
});

// /stats — Show bot stats
bot.onText(/\/?(stats|📈 Stats)/i, (msg) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;
  const u = loadUsers();
  const total    = Object.keys(u).length;
  const approved = Object.values(u).filter(x => x.status === 'approved').length;
  const notFound = Object.values(u).filter(x => x.status === 'not_found').length;
  const newUsers = Object.values(u).filter(x => !x.status).length;
  send(chatId,
    `📊 *BOT STATISTICS*\n${S}\n👥 Total Users: ${total}\n✅ UID Approved: ${approved}\n❌ UID Not Found: ${notFound}\n🆕 New Users: ${newUsers}\n${S}\n🗂️ Approved UIDs DB: ${countUIDs()} entries`
  );
});

// /clearuids — Clear all approved UIDs (danger!)
bot.onText(/\/clearuids/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  saveUIDs({});
  send(msg.chat.id, `⚠️ All approved UIDs cleared! DB is now empty.`);
});

// ─── ADMIN LOG GROUP KEYBOARD MENU ──────────────────────────────
const rkAdminLogMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: '📅 Today Users' }, { text: '📊 All Users' }],
      [{ text: '🔍 Search UID' }, { text: '📢 Broadcast' }],
      [{ text: '📥 Export' }, { text: '📈 Stats' }, { text: '📋 Approved UIDs' }]
    ],
    resize_keyboard: true,
    persistent: true
  }
});

// /setloggroup — Send inside Admin Log Group to register it
bot.onText(/\/setloggroup(?:\s+(.+))?/, async (msg, match) => {
  const chatId  = msg.chat.id;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  let target    = match && match[1] ? match[1].trim() : (isGroup ? String(chatId) : null);

  if (!target) return send(chatId, `❌ Usage:\n• Send \`/setloggroup\` inside your Admin Log Group, OR\n• Send \`/setloggroup -100xxxxxxxxxx\` here.`);
  if (msg.chat.type === 'private' && !isAdmin(chatId)) return;

  logGroupId = target;
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('LOG_GROUP_ID=')) {
      envContent = envContent.replace(/LOG_GROUP_ID=.*/, `LOG_GROUP_ID=${logGroupId}`);
    } else {
      envContent += `\nLOG_GROUP_ID=${logGroupId}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) { console.error('Error saving LOG_GROUP_ID:', e.message); }

  await send(chatId, `✅ *Admin Log Group Set!*\n━━━━━━━━━━━━━━━━━━━━\n📌 Group ID: \`${logGroupId}\`\n\n⚡ From now on, every new lead will be auto-sent here in real-time!`);
  await send(logGroupId, `✅ *Bot Connected to this Log Group!*\n━━━━━━━━━━━━━━━━━━━━\nEvery new user registration & UID verification result will appear here automatically. 🔔\n\n👇 *Use the buttons below to control the bot:*`, rkAdminLogMenu());
  console.log(`✅ Log Group ID set to: ${logGroupId}`);
});

// /panel or /menu — Show Log Group Admin Keyboard
bot.onText(/\/?(panel|menu|adminmenu)/i, async (msg) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;
  await send(chatId, `🎛️ *Admin Control Panel*\n━━━━━━━━━━━━━━━━━━━━\nSelect an option using the buttons below:`, rkAdminLogMenu());
});

// /search — Search User by UID / Name / Email / Telegram
bot.onText(/\/?(search|🔍 Search UID|🔍 Search)(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;

  const query = match && match[2] ? match[2].trim() : null;

  if (!query) {
    return send(chatId,
      `🔍 *SEARCH USER DATABASE*\n━━━━━━━━━━━━━━━━━━━━\n` +
      `Please specify the UID or Name to search.\n\n` +
      `*Usage Examples:*\n` +
      `• \`/search 1890817673\`\n` +
      `• \`/search John\`\n` +
      `• \`/search user@gmail.com\``
    );
  }

  const u = loadUsers();
  const qLower = query.toLowerCase();
  const matches = Object.values(u).filter(d => {
    return (
      (d.yubitUID && d.yubitUID.toLowerCase().includes(qLower)) ||
      (d.firstName && d.firstName.toLowerCase().includes(qLower)) ||
      (d.q4 && d.q4.toLowerCase().includes(qLower)) || // Email
      (d.q5 && d.q5.toLowerCase().includes(qLower)) || // Telegram
      (d.chatId && String(d.chatId).includes(qLower))
    );
  });

  if (!matches.length) {
    return send(chatId, `❌ *No user found* matching: \`${query}\``);
  }

  for (const targetUser of matches.slice(0, 5)) {
    const st = targetUser.status === 'approved' ? '✅ Approved' : targetUser.status === 'not_found' ? '❌ Not Found' : '⏳ Pending';
    const date = targetUser.completedAt ? new Date(targetUser.completedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : 'N/A';
    
    const card =
      `👤 *USER DETAILS MATCHED*\n━━━━━━━━━━━━━━━━━━━━\n` +
      `• *Name:* ${targetUser.firstName || 'N/A'}\n` +
      `• *UID:* \`${targetUser.yubitUID || 'N/A'}\`\n` +
      `• *Status:* ${st}\n` +
      `• *Exchange:* ${targetUser.q3 || 'N/A'}\n` +
      `• *Country:* ${targetUser.q1 || 'N/A'}\n` +
      `• *Capital:* ${targetUser.q2 || 'N/A'}\n` +
      `• *Email:* ${targetUser.q4 || 'N/A'}\n` +
      `• *Telegram:* ${targetUser.q5 || 'N/A'}\n` +
      `• *Mobile:* ${targetUser.q6 || 'N/A'}\n` +
      `• *Chat ID:* \`${targetUser.chatId}\`\n` +
      `• *Registered:* ${date}`;

    await send(chatId, card);
  }

  if (matches.length > 5) {
    await send(chatId, `ℹ️ _Found ${matches.length} total matches. Showing first 5._`);
  }
});

// /broadcast — Broadcast message to all bot users
bot.onText(/\/?(broadcast|bc|📢 Broadcast)(?:\s+([\s\S]+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;

  const broadcastMsg = match && match[2] ? match[2].trim() : null;

  if (!broadcastMsg) {
    return send(chatId,
      `📢 *BROADCAST MESSAGE TO ALL USERS*\n━━━━━━━━━━━━━━━━━━━━\n` +
      `Send a broadcast message/announcement to all registered bot members.\n\n` +
      `*Usage Example:*\n` +
      `\`/broadcast 🚨 New VIP Signal Alert! Check your VIP channel now.\`\n\n` +
      `_Tip: You can include formatting (Markdown), links, and emojis!_`
    );
  }

  const u = loadUsers();
  const userIds = Object.keys(u);

  if (!userIds.length) {
    return send(chatId, `⚠️ No registered users to broadcast to.`);
  }

  await send(chatId, `🚀 *Broadcasting message to ${userIds.length} users...*`);

  let successCount = 0;
  let failCount = 0;

  for (const uid of userIds) {
    try {
      await bot.sendMessage(uid, broadcastMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
      successCount++;
    } catch (e) {
      failCount++;
    }
    await new Promise(r => setTimeout(r, 60));
  }

  await send(chatId,
    `✅ *BROADCAST COMPLETE*\n━━━━━━━━━━━━━━━━━━━━\n` +
    `• *Total Target Users:* ${userIds.length}\n` +
    `• *Successfully Delivered:* ${successCount}\n` +
    `• *Failed / Blocked:* ${failCount}`
  );
});

// ─── MOBILE-PERFECT MARKDOWN TEXT TABLE GENERATOR ─────────────
function generateTextTable(list, title = 'USER DATABASE TABLE') {
  const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }).substring(0, 16);
  let text = `📊 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `👥 *Total Users:* \`${list.length}\`  |  🕒 \`${dateStr} IST\`\n\n`;

  text += `\`\`\`\n`;
  text += ` #| Name    |Exch| UID      |St\n`;
  text += `──┼─────────┼────┼──────────┼──\n`;

  list.forEach((d, i) => {
    const idx = String(i + 1).padStart(2, ' ');
    const name = (d.firstName || d.userName || 'User').substring(0, 8).padEnd(8, ' ');
    const rawExch = (d.q3 || d.exchangeChoice || 'WEEX').toUpperCase();
    const exch = (rawExch.includes('WEEX') ? 'WEEX' : 'YUBI').padEnd(4, ' ');
    const uid = (d.yubitUID || '-').substring(0, 9).padEnd(9, ' ');
    const st = d.status === 'approved' ? 'OK' : d.status === 'not_found' ? 'NF' : 'LD';

    text += `${idx}| ${name} |${exch}| ${uid}|${st}\n`;
  });

  text += `\`\`\``;
  return text;
}

// /today — Today's Users Clean Text Table
bot.onText(/\/?(today|todayusers|📅 Today Users)/i, async (msg) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;

  const u = loadUsers();
  const todayStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  const list = Object.values(u).filter(d => {
    if (!d.completedAt) return false;
    return new Date(d.completedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === todayStr;
  });

  if (!list.length) {
    return send(chatId, `📅 *Today's User Registrations (0)*\n━━━━━━━━━━━━━━━━━━━━\nNo new users registered today (${todayStr}) yet.`);
  }

  const tableText = generateTextTable(list, `TODAY'S REGISTRATIONS (${todayStr})`);
  send(chatId, tableText);
});

// /users — All Users Clean Text Table
bot.onText(/\/?(users|📊 All Users)/i, async (msg) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;

  const u    = loadUsers();
  const list = Object.values(u);
  if (!list.length) return send(chatId, `📋 No users registered yet.`);

  const tableText = generateTextTable(list, `ALL REGISTERED USERS TABLE`);
  send(chatId, tableText);
});

// /export — Export all users as CSV file
bot.onText(/\/?(export|📥 Export)/i, async (msg) => {
  const chatId = msg.chat.id;
  const isLog  = logGroupId && String(chatId) === String(logGroupId);
  if (!isAdmin(chatId) && !isLog) return;

  const u = loadUsers();
  const list = Object.values(u);
  if (!list.length) return send(chatId, `📋 No users to export yet.`);

  const header = 'Name,Country,Capital,Exchange,Email,Telegram,Mobile,UID,Status,ChatID,Date';
  const rows = list.map(d => [
    d.firstName || '',
    d.q1 || '',
    d.q2 || '',
    d.q3 || '',
    d.q4 || '',
    d.q5 || '',
    d.q6 || '',
    d.yubitUID || '',
    d.status || '',
    d.chatId || '',
    d.completedAt ? new Date(d.completedAt).toLocaleString('en-IN') : ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv    = [header, ...rows].join('\n');
  const tmpFile = path.join(__dirname, `export_${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, csv, 'utf8');

  try {
    await bot.sendDocument(chatId, tmpFile, {
      caption: `📊 *User Export — ${list.length} Users*\n_Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}_`,
      parse_mode: 'Markdown'
    });
  } finally {
    fs.unlinkSync(tmpFile);
  }
  console.log(`✅ Exported ${list.length} users to CSV for chatId ${chatId}`);
});

// ─── FILE UPLOAD — Bulk UID Import ────────────────────────────
// Admin can send a .txt file with one UID per line to bulk import
bot.on('document', async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const doc = msg.document;
  const name = doc.file_name || '';
  if (!name.endsWith('.txt') && !name.endsWith('.csv')) {
    return send(msg.chat.id, `📄 Please send a *.txt* or *.csv* file with one UID per line.`);
  }
  try {
    const fileLink = await bot.getFileLink(doc.file_id);
    const https = require('https');
    let raw = '';
    await new Promise((res, rej) => {
      https.get(fileLink, r => { r.on('data', d => raw += d); r.on('end', res); r.on('error', rej); });
    });
    const lines  = raw.split(/[\r\n,;]+/).map(l => l.trim()).filter(l => /^\d{4,20}$/.test(l));
    const db     = loadUIDs();
    let added = 0;
    lines.forEach(uid => { if (!db[uid]) { db[uid] = true; added++; } });
    saveUIDs(db);
    send(msg.chat.id,
      `✅ *Bulk Import Complete!*\n${S}\n📂 File: ${escMd(name)}\n✅ New UIDs added: *${added}*\n⏭️ Already existed: ${lines.length - added}\n📋 Total in DB: *${countUIDs()}*`
    );
    console.log(`✅ Admin bulk imported ${added} UIDs`);
  } catch (e) {
    send(msg.chat.id, `❌ Error reading file: ${e.message}`);
    console.error('❌ File import:', e.message);
  }
});

// ─── CALLBACK QUERY ───────────────────────────────────────────
bot.on('callback_query', async (cb) => {
  const id  = cb.message.chat.id;
  const val = cb.data;
  const st  = getState(id);
  try { await bot.answerCallbackQuery(cb.id); } catch (_) {}

  // 1. Admin Approve UID & Send VIP Link Button: admin_approve_<uid>_<chatId>
  if (val && val.startsWith('admin_approve_')) {
    const parts = val.split('_');
    const uid = parts[2];
    const targetChatId = parts[3];
    const adminName = cb.from.first_name || 'Admin';

    addUID(uid);

    const u = loadUsers();
    const targetUser = u[targetChatId] || {};
    targetUser.status = 'approved';
    targetUser.yubitUID = uid;
    saveFinal(targetChatId, targetUser);

    const link = await createOneTimeVIPLink(targetChatId, targetUser.firstName || 'User');
    await sendProtectedVIPLink(
      targetChatId,
      `🎉 *UID APPROVED BY ADMIN!*\n${S}\n✅ Your UID *${uid}* has been verified by Wise Advice Admin!\n💰 VIP Access Granted!\n${S}\n🏆 *ONE-TIME VIP GROUP ACCESS:*`,
      link
    );

    await bot.answerCallbackQuery(cb.id, { text: `✅ Approved UID ${uid}! VIP link sent to user in DM.`, show_alert: true });

    const updatedCaption = `${cb.message.text}\n\n✅ *APPROVED BY ADMIN* (@${cb.from.username || adminName})`;
    bot.editMessageText(updatedCaption, {
      chat_id: id,
      message_id: cb.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `👤 View Data (${targetUser.firstName || 'User'})`, callback_data: `view_user_${targetChatId}` }]
        ]
      }
    }).catch(() => {});
    return;
  }

  // 2. Admin Reject Button: admin_reject_<uid>_<chatId>
  if (val && val.startsWith('admin_reject_')) {
    const parts = val.split('_');
    const uid = parts[2];
    const targetChatId = parts[3];

    const u = loadUsers();
    const targetUser = u[targetChatId] || {};
    targetUser.status = 'rejected';
    saveFinal(targetChatId, targetUser);

    await bot.answerCallbackQuery(cb.id, { text: `❌ Lead ${uid} Rejected.`, show_alert: true });

    const updatedCaption = `${cb.message.text}\n\n❌ *REJECTED BY ADMIN* (@${cb.from.username || cb.from.first_name})`;
    bot.editMessageText(updatedCaption, {
      chat_id: id,
      message_id: cb.message.message_id,
      parse_mode: 'Markdown'
    }).catch(() => {});
    return;
  }

  // 3. Admin Live API Check Button: admin_check_api_<uid>
  if (val && val.startsWith('admin_check_api_')) {
    const uid = val.replace('admin_check_api_', '');
    const weexRes = await verifyUIDViaWeexAPI(uid);
    const yubitRes = await verifyUIDViaYubitAPI(uid);

    let info = `🔍 LIVE API CHECK FOR UID ${uid}:\n\n`;
    info += `🔵 WEEX: ${weexRes.isReferral ? '✅ Referral (Wise Advice)' : '❌ No'} | Deposit: $${weexRes.deposit || '0'}\n`;
    info += `🟡 YUBIT: ${yubitRes.isReferral ? '✅ Referral (Wise Advice)' : '❌ No'} | Balance: $${yubitRes.balance || '0'}`;

    return bot.answerCallbackQuery(cb.id, { text: info, show_alert: true });
  }

  // 4. View User Profile Button: view_user_<chatId>
  if (val && val.startsWith('view_user_')) {
    const targetChatId = val.replace('view_user_', '');
    const u = loadUsers();
    const targetUser = u[targetChatId];
    if (!targetUser) return bot.sendMessage(id, `❌ User data not found for Chat ID: ${targetChatId}`);

    const badge = targetUser.status === 'approved' ? '✅ VERIFIED' : targetUser.status === 'not_found' ? '❌ NOT FOUND' : '⏳ PENDING';
    const date  = targetUser.completedAt ? new Date(targetUser.completedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : 'N/A';

    const card =
      `👤 *USER PROFILE* ${badge}\n` +
      `───────────────\n` +
      `👤 *Name:* ${escMd(targetUser.firstName || 'N/A')}\n` +
      `🌍 *Country:* ${escMd(targetUser.q1 || 'N/A')}\n` +
      `💰 *Capital:* ${escMd(targetUser.q2 || 'N/A')}\n` +
      `📊 *Exchg:* ${escMd(targetUser.q3 || 'N/A')}\n` +
      `📧 *Email:* ${escMd(targetUser.q4 || 'N/A')}\n` +
      `💬 *Tlgrm:* ${escMd(targetUser.q5 || 'N/A')}\n` +
      `📱 *Mob:* ${escMd(targetUser.q6 || 'N/A')}\n` +
      `🔑 *UID:* \`${targetUser.yubitUID || 'N/A'}\`\n` +
      `🆔 *ChatID:* \`${targetUser.chatId || 'N/A'}\`\n` +
      `🕐 *Time:* ${date}\n` +
      `───────────────`;
    return bot.sendMessage(id, card, { parse_mode: 'Markdown', protect_content: true });
  }

  // 5. View VIP Member Left Full Details Button: view_left_user_<userId>
  if (val && val.startsWith('view_left_user_')) {
    const targetUserId = val.replace('view_left_user_', '');
    const uDb = loadUsers();
    const uData = uDb[targetUserId] || {};
    const uid = uData.yubitUID || 'N/A';
    const rawExch = (uData.exchangeChoice || uData.q3 || 'N/A').toUpperCase();
    const exchBadge = rawExch.includes('WEEX') ? '🌐 WEEX' : rawExch.includes('YUBIT') ? '🟡 YUBIT' : 'N/A';

    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

    const fullCard =
      `🚨 *VIP MEMBER LEFT ALERT - FULL DETAILS*\n` +
      `${S}\n` +
      `👤 *Name:* ${escMd(uData.firstName || 'User')}\n` +
      `💬 *Telegram:* ${escMd(uData.q5 || '@User')}\n` +
      `🆔 *Chat ID:* \`${targetUserId}\`\n` +
      `🔑 *UID:* \`${uid}\`\n` +
      `🏛️ *Exchange:* *${exchBadge}*\n` +
      `🌍 *Country:* ${escMd(uData.q1 || 'India')}\n` +
      `💰 *Capital:* ${escMd(uData.q2 || '$100 to $1000')}\n` +
      `📧 *Email:* ${escMd(uData.q4 || 'N/A')}\n` +
      `📱 *Mobile:* ${escMd(uData.q6 || 'N/A')}\n` +
      `🗓️ *Date Left:* \`${dateStr}\`\n` +
      `${S}\n` +
      `⚠️ _Status: Member has exited VIP Channel._`;

    await bot.answerCallbackQuery(cb.id).catch(() => {});
    return bot.sendMessage(id, fullCard, { parse_mode: 'Markdown', protect_content: true });
  }

  try {
    if (st.step === 1) {
      st.data.q1 = val.replace(/[\u{1F1E0}-\u{1F1FF}]{2}\s*/gu, '').trim();
      st.step = 2; setState(id, st);
      await sendStep2(id, st.data.q1);

    } else if (st.step === 2) {
      st.data.q2 = val; st.step = 3; setState(id, st);
      await sendStep3(id, val);

    } else if (st.step === 3) {
      st.data.q3 = val; st.step = 4; setState(id, st);
      await sendStep4(id, val);

    } else if (val === 'INFO_DEPOSIT') {
      const depImg = path.join(__dirname, 'depositbonus.jpg');
      const text = `💰 *NEW USER DEPOSIT BONUS*\n${S}\nDeposit & Get Rewarded on Yubit!\n\n• Deposit *$100* ──► Get *$20* Futures Bonus\n• Deposit *$500* ──► Get *$75* Futures Bonus\n• Deposit *$1,000* ──► Get *$150* Futures Bonus\n• Deposit *$5,000* ──► Get *$500* Futures Bonus\n• Deposit *$10,000* ──► Get *$1,000* Futures Bonus\n\n🗓️ *Rewards Distributed Every Friday*\n${S}\n🔗 *Register via Wise Advice:*\n${YUBIT_SIGNUP}`;
      if (fs.existsSync(depImg)) {
        await bot.sendPhoto(id, fs.readFileSync(depImg), { caption: text, parse_mode: 'Markdown' });
      } else {
        await send(id, text);
      }

    } else if (val === 'INFO_VOLUME') {
      const volImg = path.join(__dirname, 'volumebonus.jpg');
      const text = `📈 *MONTHLY VOLUME REWARDS*\n${S}\nTrade More, Earn More on Yubit!\n\n• Trade ≥ *1M* ──► *150 USDT* + *$150* Bonus\n• Trade ≥ *5M* ──► *750 USDT* + *$350* Bonus\n• Trade ≥ *10M* ──► *1,500 USDT* + *$600* Bonus\n• Trade ≥ *25M* ──► *3,500 USDT* + *$2,000* Bonus\n• Trade ≥ *50M* ──► *7,000 USDT* + *$4,000* Bonus\n• Trade ≥ *100M* ──► *15,000 USDT* + *$8,000* Bonus\n\n🗓️ *Distributed on 1st of Every Month*\n${S}\n🔗 *Register via Wise Advice:*\n${YUBIT_SIGNUP}`;
      if (fs.existsSync(volImg)) {
        await bot.sendPhoto(id, fs.readFileSync(volImg), { caption: text, parse_mode: 'Markdown' });
      } else {
        await send(id, text);
      }

    } else if (val === 'WANT_SIGNALS') {
      await send(id, `📡 *FREE VIP SIGNALS PORTAL*\n${S}\nJoin our VIP group by signing up or verifying your existing Yubit account.\n\n👇 *Choose your option below:*`, { reply_markup: mkVIP() });

    } else if (val === 'DEC_EXIST') {
      st.step = 8; setState(id, st);
      await send(id, `🔑 *ENTER YOUR YUBIT UID*\n${S}\nPlease enter your Yubit UID below. If you registered under us and have $100 deposit, you will get our Telegram VIP group link immediately.\n\n💡 *How to find UID:*\nYubit App ➔ Profile / Me ➔ Copy User ID\n${S}\n👇 *Paste your Yubit UID below:*`);

    } else if (val === 'DEC_NEW') {
      saveFinal(id, st.data);
      await send(id, `🚀 *SIGNUP ON YUBIT*\n${S}\nRegister using the link below to qualify for Wise Advice VIP access & bonuses:\n\n🔗 ${YUBIT_SIGNUP}\n${S}\n✅ After registering & depositing $100+, click *Already Member* to enter your UID!`, { disable_web_page_preview: true });
    }
  } catch (e) { console.error('❌ CB:', e.message); }
});

// ─── MESSAGE HANDLER ──────────────────────────────────────────
bot.on('message', async (msg) => {
  const id = msg.chat.id, text = msg.text;
  
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    console.log(`📌 Group message in "${msg.chat.title}" | Chat ID: ${msg.chat.id}`);
    if (!vipChatId) {
      vipChatId = String(msg.chat.id);
      console.log(`✅ Automatically set VIP Chat ID to ${vipChatId}`);
    }
  }

  if (!text || text.startsWith('/')) return;
  const st = getState(id);
  if (msg.from) {
    if (!st.data.firstName && msg.from.first_name) st.data.firstName = msg.from.first_name;
    if (!st.data.userName && msg.from.username) st.data.userName = msg.from.username;
    if (!st.data.q5 && msg.from.username) st.data.q5 = `@${msg.from.username}`;
  }

  try {
    // ── REPLY KEYBOARD TEXT HANDLERS ─────────────────────────
    if (text.includes('Deposit Bonus')) {
      const depImg = path.join(__dirname, 'depositbonus.jpg');
      const caption = `💰 *NEW USER DEPOSIT BONUS*\n${S}\nDeposit & Get Rewarded on Yubit!\n\n• Deposit *$100* ──► Get *$20* Futures Bonus\n• Deposit *$500* ──► Get *$75* Futures Bonus\n• Deposit *$1,000* ──► Get *$150* Futures Bonus\n• Deposit *$5,000* ──► Get *$500* Futures Bonus\n• Deposit *$10,000* ──► Get *$1,000* Futures Bonus\n\n🗓️ *Rewards Distributed Every Friday*\n${S}\n🔗 *Register via Wise Advice:*\n${YUBIT_SIGNUP}`;
      if (fs.existsSync(depImg)) {
        await bot.sendPhoto(id, fs.readFileSync(depImg), { caption, parse_mode: 'Markdown' });
      } else {
        await send(id, caption);
      }
      return;
    }

    if (text.includes('Volume Bonus')) {
      const volImg = path.join(__dirname, 'volumebonus.jpg');
      const caption = `📈 *MONTHLY VOLUME REWARDS*\n${S}\nTrade More, Earn More on Yubit!\n\n• Trade ≥ *1M* ──► *150 USDT* + *$150* Bonus\n• Trade ≥ *5M* ──► *750 USDT* + *$350* Bonus\n• Trade ≥ *10M* ──► *1,500 USDT* + *$600* Bonus\n• Trade ≥ *25M* ──► *3,500 USDT* + *$2,000* Bonus\n• Trade ≥ *50M* ──► *7,000 USDT* + *$4,000* Bonus\n• Trade ≥ *100M* ──► *15,000 USDT* + *$8,000* Bonus\n\n🗓️ *Distributed on 1st of Every Month*\n${S}\n🔗 *Register via Wise Advice:*\n${YUBIT_SIGNUP}`;
      if (fs.existsSync(volImg)) {
        await bot.sendPhoto(id, fs.readFileSync(volImg), { caption, parse_mode: 'Markdown' });
      } else {
        await send(id, caption);
      }
      return;
    }

    if (text.includes('Want Free Vip Signals')) {
      await send(id, `📡 *FREE VIP SIGNALS PORTAL*\n${S}\nJoin VIP group from *WEEX* or *YUBIT*!\n\n👇 *Select your exchange:*`, rkSignalsMenu());
      return;
    }

    if (text === 'WEEX') {
      await send(id, `🔵 *WEEX VIP ACCESS*\n${S}\nSignup or verify your existing WEEX account under Wise Advice:\n\n👇 *Choose your option:*`, rkWeexSub());
      return;
    }

    if (text === 'YUBIT') {
      await send(id, `🟡 *YUBIT VIP ACCESS*\n${S}\nSignup or verify your existing Yubit account under Wise Advice:\n\n👇 *Choose your option:*`, rkYubitSub());
      return;
    }

    if (text.includes('Back to Main Menu') || text === '🔙 Back to Main Menu') {
      await sendDecision(id, st.data, st.data.firstName || 'User');
      return;
    }

    if (text.includes('Back to Exchanges') || text === '🔙 Back to Exchanges') {
      await send(id, `📡 *FREE VIP SIGNALS PORTAL*\n${S}\nJoin VIP group from *WEEX* or *YUBIT*!\n\n👇 *Select your exchange:*`, rkSignalsMenu());
      return;
    }

    if (text === 'Signup on WEEX') {
      saveFinal(id, st.data);
      await send(id, `🚀 *SIGNUP ON WEEX*\n${S}\nRegister using the link below to qualify for Wise Advice VIP access:\n\n🔗 ${WEEX_SIGNUP}\n${S}\n✅ After registering & depositing $100+, click *Already a member on WEEX* to enter your UID!`, { disable_web_page_preview: true });
      return;
    }

    if (text === 'Signup on YUBIT' || text === 'Signup on Yubit') {
      saveFinal(id, st.data);
      await send(id, `🚀 *SIGNUP ON YUBIT*\n${S}\nRegister using the link below to qualify for Wise Advice VIP access & bonuses:\n\n🔗 ${YUBIT_SIGNUP}\n${S}\n✅ After registering & depositing $100+, click *Already a member on YUBIT* to enter your UID!`, { disable_web_page_preview: true });
      return;
    }

    if (text.includes('Already a member on WEEX') || text.includes('WEEX under Wise Advice')) {
      st.step = 8;
      st.data.exchangeChoice = 'WEEX';
      setState(id, st);
      await send(id, `🔑 *Enter your WEEX User ID (UID)*\n${S}\n💡 *Where to find:* WEEX App ➔ Profile\n📌 Must have *$100+ balance* to unlock VIP.\n${S}\n👇 *Send your WEEX UID below:*`);
      return;
    }

    if (text.includes('Already a member on YUBIT') || text.includes('YUBIT under Wise Advice') || text.includes('Already Member')) {
      st.step = 8;
      st.data.exchangeChoice = 'YUBIT';
      setState(id, st);
      await send(id, `🔑 *Enter your YUBIT User ID (UID)*\n${S}\n💡 *Where to find:* Yubit App ➔ Profile\n📌 Must have *$100+ balance* to unlock VIP.\n${S}\n👇 *Send your YUBIT UID below:*`);
      return;
    }

    if (st.step === 1) {
      st.data.q1 = text.replace(/[\u{1F1E0}-\u{1F1FF}]{2}\s*/gu, '').trim();
      st.step = 2; setState(id, st);
      await sendStep2(id, st.data.q1);
      return;
    }

    if (st.step === 2) {
      st.data.q2 = text.trim();
      st.step = 3; setState(id, st);
      await sendStep3(id, text);
      return;
    }

    if (st.step === 3) {
      st.data.q3 = text.trim();
      st.step = 4; setState(id, st);
      await sendStep4(id, text);
      return;
    }

    if (st.step === 4) {
      if (!vEmail(text)) { await send(id, pick(ERR.email)); return; }
      const v = text.trim();
      st.data.q4 = v; st.step = 5; setState(id, st);
      try { await send(id, `✅ *Step 4 Saved!*\n\n📧 ${escMd(v)}\n📊 ${progressBar(4)}\n${S}`); } catch (_) {}
      await sendStep5(id);

    } else if (st.step === 5) {
      if (!vTelegram(text)) { await send(id, pick(ERR.telegram)); return; }
      const v = text.trim();
      st.data.q5 = v; st.step = 6; setState(id, st);
      try { await send(id, `✅ *Step 5 Saved!*\n\n💬 ${escMd(v)}\n📊 ${progressBar(5)}\n${S}`); } catch (_) {}
      await sendStep6(id);

    } else if (st.step === 6) {
      if (!vMobile(text)) { await send(id, pick(ERR.mobile)); return; }
      const v = text.trim();
      st.data.q6 = v; st.step = 7; setState(id, st);
      await sendDecision(id, st.data, st.data.firstName || 'User');

    } else if (st.step === 8 || (st.step >= 7 && vUID(text))) {
      // ── UID VERIFICATION ────────────────────────────────────
      if (!vUID(text)) { await send(id, pick(ERR.uid)); return; }
      const uid = text.trim();
      st.data.yubitUID = uid;
      st.step = 8;
      setState(id, st);

      // 1. Local Whitelist Check (Admin Added / Approved UIDs)
      if (isApprovedUID(uid)) {
        console.log(`✅ UID ${uid} found in local approved list!`);
        await handleUIDResult(id, uid, st.data, true);
        return;
      }

      // 2. Dual Exchange Live API Check (WEEX & YUBIT Auto-Detection)
      const exch = (st.data.exchangeChoice || '').toUpperCase();
      let primaryExch = exch.includes('WEEX') ? 'WEEX' : 'YUBIT';

      let result = null;
      let usedExch = primaryExch;

      if (primaryExch === 'WEEX' && WEEX_API_KEY) {
        await send(id, `🔍 *Checking UID ${uid}...*\n${S}\n⏳ Verifying with WEEX server... Please wait.`);
        result = await verifyUIDViaWeexAPI(uid);
        // If not found on WEEX, fallback check YUBIT automatically
        if (!result.isReferral && YUBIT_API_KEY) {
          console.log(`🔍 WEEX not matched for ${uid}, checking YUBIT...`);
          const yRes = await verifyUIDViaYubitAPI(uid);
          if (yRes.isReferral || yRes.depositOk) {
            result = yRes;
            usedExch = 'YUBIT';
          }
        }
      } else if (YUBIT_API_KEY) {
        await send(id, `🔍 *Checking UID ${uid}...*\n${S}\n⏳ Verifying with YUBIT server... Please wait.`);
        result = await verifyUIDViaYubitAPI(uid);
        // If not found on YUBIT, fallback check WEEX automatically
        if (!result.isReferral && WEEX_API_KEY) {
          console.log(`🔍 YUBIT not matched for ${uid}, checking WEEX...`);
          const wRes = await verifyUIDViaWeexAPI(uid);
          if (wRes.isReferral || wRes.depositOk) {
            result = wRes;
            usedExch = 'WEEX';
          }
        }
      }

      if (result) {
        st.data.exchangeChoice = usedExch;
        if (result.error && result.fallback) {
          console.log(`⚠️ API failed for UID ${uid}, using local check. Error: ${result.error}`);
          const localOk = isApprovedUID(uid);
          await handleUIDResult(id, uid, st.data, localOk);
        } else if (result.isReferral && result.depositOk) {
          st.data.balance = result.deposit || result.balance || '100.00';
          addUID(uid); // Save to local DB for records
          await handleUIDResult(id, uid, st.data, true);
        } else if (result.isReferral && !result.depositOk) {
          st.step = 8;
          setState(id, st);
          await send(id,
            `⚠️ *Low Deposit Warning*\n${S}\n` +
            `✅ UID *${uid}* is registered under Wise Advice (${usedExch})!\n` +
            `❌ Current Balance: *$${result.deposit}* (Required: *$100+*)\n${S}\n` +
            `💰 *Please deposit at least $100* on ${usedExch}, then send your UID again below:`,
            { disable_web_page_preview: true }
          );
          sendLeadToLogGroup(st.data, uid, 'deposit_low', id, result.deposit || result.balance);
        } else {
          await handleUIDResult(id, uid, st.data, false);
        }
        return;
      }

      // 4. Fallback Standard Check (Local DB matching)
      await send(id, `🔍 *Checking UID ${uid}...*\n${S}\n⏳ Verifying Wise Advice registration...`);
      await new Promise(r => setTimeout(r, 1200));

      const isApproved = isApprovedUID(uid);
      await handleUIDResult(id, uid, st.data, isApproved);
      return;
    }
  } catch (e) { console.error('❌ Msg handler:', e.message); }
});

console.log('✅ Bot v6.0 started! WEEX & YUBIT Live API Verification active.');
console.log(`📂 Approved UIDs loaded: ${countUIDs()}`);
console.log(`🌐 WEEX API: ${WEEX_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
console.log(`🟡 YUBIT API: ${YUBIT_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
