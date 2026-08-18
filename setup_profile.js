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
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e){ resolve({raw: body}); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  // No horizontal lines at all — pure emoji-based layout
  // Every line is short enough to fit any mobile screen
  const desc =
`🔥  WISE ADVICE × YUBIT  🔥
⚡  OFFICIAL VIP PORTAL  ⚡

🏆  $1,000,000 CHALLENGE
💰  $250,000 ➔ $1,000,000

🎁  EXCLUSIVE VIP PERKS:
📡  95%+ Accuracy VIP Signals
💰  Instant Deposit Bonus
📈  Daily Volume Rewards

🚀  Click 👇 to Register & Join:
👉  /start – Begin Verification`;

  const short = '💎 WISEVIP × YUBIT — $1M Trading Challenge';

  console.log('📝 Setting bot description...');
  const r1 = await call('setMyDescription', { description: desc });
  console.log('  setMyDescription:', JSON.stringify(r1));

  console.log('📝 Setting short description...');
  const r2 = await call('setMyShortDescription', { short_description: short });
  console.log('  setMyShortDescription:', JSON.stringify(r2));

  console.log('\n🔫 Clearing old sessions...');
  await call('setWebhook', { url: 'https://example.com/kill-' + Date.now() });
  const r3 = await call('deleteWebhook', { drop_pending_updates: true });
  console.log('  deleteWebhook:', JSON.stringify(r3));

  console.log('\n🔘 Setting Chat Menu Button (OPEN ACCOUNT)...');
  const r4 = await call('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'OPEN ACCOUNT',
      web_app: { url: 'https://www.yubit.com/register?inviteCode=WISEVIP' }
    }
  });
  console.log('  setChatMenuButton:', JSON.stringify(r4));

  console.log('\n✅ Done! Restart the bot now.');
})().catch(e => console.error('ERR:', e));
