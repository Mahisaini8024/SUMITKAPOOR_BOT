require('dotenv').config();
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const BASE = `https://api.telegram.org/bot${token}`;
const PHOTO_PATH = path.join(__dirname, 'photo_2026-08-07_13-35-02.jpg');
const PHOTO_BUFF = fs.readFileSync(PHOTO_PATH);
const DATA_FILE = path.join(__dirname, 'users.json');
const GROUP_INVITE = 'https://t.me/+e96q3W5dAEAzNGM1';

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
function loadUsers() { try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch(e){ return {}; } }
function saveUsers(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8'); }
let users = loadUsers();
const userState = {};
const getState = (id) => userState[id] || (userState[id] = { step:0, data:{startedAt:new Date().toISOString()} });
const setState = (id,s) => userState[id]=s;
const resetState = (id) => { userState[id]={step:0,data:{startedAt:new Date().toISOString()}}; };
function saveFinal(id, d) { users[id]={...d, completedAt:new Date().toISOString(), chatId:id}; saveUsers(users); delete userState[id]; }

const OPT = {
  q1: ['India','Pakistan','Europe','UK','USA','China','Korea','Japan','Others'],
  q2: ['Below $100','$100 to $1000','$1000 to $10000','$10000 to $25000','$25000 to $100000','$100000 and above'],
  q3: ['Binance','Bybit','Weex','Blofin','Bingx','Bitunix','Yubit','OKX','Other']
};
function kb(arr) {
  const k=[]; for(let i=0;i<arr.length;i+=2) {
    if(i+1<arr.length) k.push([{text:arr[i],callback_data:arr[i]},{text:arr[i+1],callback_data:arr[i+1]}]);
    else k.push([{text:arr[i],callback_data:arr[i]}]);
  } return {inline_keyboard:k};
}
const vEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const vMobile = v => /^\+?[1-9]\d{7,14}$/.test(v.replace(/\s|-/g,''));
const vTg = v => { const t=v.trim(); return t.startsWith('@')&&t.length>=5; };

async function step1(cid, fn) { await bot.sendMessage(cid,`👋 Welcome *${fn}*!\n\nTo unlock the $1M Challenge group, answer these 6 mandatory questions.\n\n📌 *Q1. Where are you from?*`,{parse_mode:'Markdown',reply_markup:kb(OPT.q1)}); }
async function step2(cid) { await bot.sendMessage(cid,`📍 *Got it!*\n\n📌 *Q2. How much is your trading Capital?*`,{parse_mode:'Markdown',reply_markup:kb(OPT.q2)}); }
async function step3(cid) { await bot.sendMessage(cid,`💰 *Noted!*\n\n📌 *Q3. Which exchange you are currently trading at?*`,{parse_mode:'Markdown',reply_markup:kb(OPT.q3)}); }
async function step4(cid) { await bot.sendMessage(cid,`📊 *Thanks!*\n\n📌 *Q4. What is your Email Id?*\nExample: yourname@example.com`,{parse_mode:'Markdown'}); }
async function step5(cid) { await bot.sendMessage(cid,`📧 *Saved!*\n\n📌 *Q5. What is your Telegram id?*\nExample: @yourusername`,{parse_mode:'Markdown'}); }
async function step6(cid) { await bot.sendMessage(cid,`💬 *Got it!*\n\n📌 *Q6. What is your Mobile Number with country code?*\nExample: +919876543210`,{parse_mode:'Markdown'}); }
async function finalMsg(cid, d, fn) {
  await bot.sendMessage(cid, `✅ *Thank you ${fn}!* Sab jawab save ho gaye.\n\n📋 *Your Details:*\n🌍 Country: ${d.q1}\n💰 Capital: ${d.q2}\n📊 Exchange: ${d.q3}\n📧 Email: ${d.q4}\n💬 Telegram: ${d.q5}\n📱 Mobile: ${d.q6}\n\n👇 Group join karein:`, {parse_mode:'Markdown'});
  await bot.sendMessage(cid, `🔗 *Join Group:*\n${GROUP_INVITE}`, {parse_mode:'Markdown',disable_web_page_preview:true});
}
async function welcomePhoto(cid, fn) {
  try {
    await bot.sendPhoto(cid, PHOTO_BUFF, {
      caption: `🎮 *YUBIT x WISEVIP*\n💎 *$1 MILLION TRADING CHALLENGE*\n\n⚔️ Capital: $250,000 → $1,000,000\n🏆 1 Account • 1 Goal • Zero Compromises\n\n👋 Welcome aboard, *${fn}*!\n\n━━━━━━━━━━━━━━━━━\n🔗 *Don't have a Yubit account?*\n   Register now & claim bonus:\n   https://www.yubit.com/en-US/register?inviteCode=WISEVIP\n━━━━━━━━━━━━━━━━━`,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    return true;
  } catch(e) { process.stdout.write(`❌ Photo: ${e.message.substring(0,80)}\n`); return false; }
}

let bot = null;
let total409 = 0;
let served = 0;
let won = false;

async function kill() {
  try {
    await call('setWebhook', {url:'https://example.com/kill-'+Math.random()});
    await call('deleteWebhook', {drop_pending_updates:true});
    return true;
  } catch(e) { return false; }
}

function wireBot() {
  if (bot) { try { bot.stopPolling(); } catch(e){} bot=null; }
  bot = new TelegramBot(token, {polling:{interval:150,autoStart:true,params:{timeout:1}}});

  bot.on('polling_error', (err) => {
    const m = (err.message||'');
    if (m.includes('409') || m.includes('Conflict')) {
      total409++;
      if (total409 === 1) process.stdout.write(`🔴 409 race — other bot detected. Fighting...\n`);
      if (total409 % 10 === 0) process.stdout.write(`   (409 x${total409} — still fighting, served ${served})\n`);
    } else {
      process.stdout.write(`❌ Polling: ${m.substring(0,80)}\n`);
    }
  });
  bot.on('error', e => process.stdout.write(`❌ Bot: ${(e.message||'').substring(0,80)}\n`));

  bot.onText(/\/start/, async (msg) => {
    const cid = msg.chat.id; const fn = msg.from.first_name||'User'; served++; won = true;
    resetState(cid);
    await welcomePhoto(cid, fn);
    const st = getState(cid); st.step=1; st.data.firstName=fn; setState(cid,st);
    await step1(cid, fn);
    process.stdout.write(`✅ /start served: ${fn} (#${served})\n`);
  });
  bot.onText(/\/help/, m => bot.sendMessage(m.chat.id,`📋 *Help*\n\n/start - Registration\n/reset - Form reset`,{parse_mode:'Markdown'}));
  bot.onText(/\/info/, m => bot.sendMessage(m.chat.id,`ℹ️ *Sumit Kapoor Bot*\nv1.0.0 • $1M Challenge Onboarding`,{parse_mode:'Markdown'}));
  bot.onText(/\/reset/, m => { resetState(m.chat.id); bot.sendMessage(m.chat.id,`🔄 Reset! /start karein.`); });

  bot.on('callback_query', async (cb) => {
    const cid = cb.message.chat.id; const val = cb.data;
    await bot.answerCallbackQuery(cb.id);
    const st = getState(cid);
    try {
      if (st.step===1) { st.data.q1=val; st.step=2; setState(cid,st); await step2(cid); }
      else if (st.step===2) { st.data.q2=val; st.step=3; setState(cid,st); await step3(cid); }
      else if (st.step===3) { st.data.q3=val; st.step=4; setState(cid,st); await step4(cid); }
      else bot.sendMessage(cid, `/start karein.`);
    } catch(e){ process.stdout.write(`❌ CB: ${(e.message||'').substring(0,60)}\n`); }
  });

  bot.on('message', async (msg) => {
    const cid = msg.chat.id; const t = msg.text;
    if (!t || t.startsWith('/')) return;
    const st = getState(cid);
    try {
      if (st.step===4) {
        if (!vEmail(t)) return bot.sendMessage(cid,`❌ *Invalid email.* (name@example.com):`,{parse_mode:'Markdown'});
        st.data.q4=t.trim(); st.step=5; setState(cid,st); await step5(cid);
      } else if (st.step===5) {
        if (!vTg(t)) return bot.sendMessage(cid,`❌ *Invalid Telegram ID.* (@myusername):`,{parse_mode:'Markdown'});
        st.data.q5=t.trim(); st.step=6; setState(cid,st); await step6(cid);
      } else if (st.step===6) {
        if (!vMobile(t)) return bot.sendMessage(cid,`❌ *Invalid Mobile.* (+919876543210):`,{parse_mode:'Markdown'});
        st.data.q6=t.trim(); saveFinal(cid, st.data); await finalMsg(cid, st.data, st.data.firstName||'User');
      }
    } catch(e){ process.stdout.write(`❌ Msg: ${(e.message||'').substring(0,60)}\n`); }
  });
}

(async () => {
  process.stdout.write(`\n🚀 ULTRA TAKEOVER MODE — FIGHTING FOR TOKEN CONTROL\n\n`);
  process.stdout.write(`Photo: ${PHOTO_BUFF.length} bytes preloaded in RAM (fast send)\n`);
  process.stdout.write(`Strategy: Kill → Start → Check every 3s.\n\n`);

  let round = 0;
  async function tick() {
    round++;
    if (!won) { await kill(); wireBot(); }
    if (round % 5 === 0) {
      process.stdout.write(`⏱️  Round ${round} | 409=${total409} | Served=${served} | Won=${won?'✅':'⏳'}\n`);
    }
  }
  await tick();
  setInterval(tick, 3000);
})();
