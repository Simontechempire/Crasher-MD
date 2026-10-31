const fs = require("fs-extra");
const axios = require("axios");
const moment = require("moment-timezone");
const config = require("../config");

// ========== FANCY TEXT ==========
const fancyMap = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
  j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
  s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
  A: "ᴀ", B: "ʙ", C: "ᴄ", D: "ᴅ", E: "ᴇ", F: "ꜰ", G: "ɢ", H: "ʜ", I: "ɪ",
  J: "ᴊ", K: "ᴋ", L: "ʟ", M: "ᴍ", N: "ɴ", O: "ᴏ", P: "ᴘ", Q: "ǫ", R: "ʀ",
  S: "ꜱ", T: "ᴛ", U: "ᴜ", V: "ᴠ", W: "ᴡ", X: "x", Y: "ʏ", Z: "ᴢ",
  "0": "𝟶", "1": "𝟷", "2": "𝟸", "3": "𝟹", "4": "𝟺", "5": "𝟻", "6": "𝟼", "7": "𝟽", "8": "𝟾", "9": "𝟿"
};

function fancy(text) {
  return String(text).split("").map(c => fancyMap[c] || c).join("");
}

function fancyUpper(text) {
  return fancy(String(text).toUpperCase());
}

// ========== RUNTIME ==========
function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor(seconds % (3600 * 24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  return `${d}ᴅ ${h}ʜ ${m}ᴍ ${s}ꜱ`;
}

// ========== TIME ==========
function getTime() {
  return moment().tz(config.timezone).format("HH:mm:ss");
}

function getDate() {
  return moment().tz(config.timezone).format("DD/MM/YYYY");
}

// ========== IS OWNER ==========
function isOwner(jid) {
  if (!jid) return false;
  const num = jid.replace(/[^0-9]/g, "");
  return config.owners.some(o => num.includes(o) || o.includes(num));
}

// ========== SERIALIZE MESSAGE ==========
function smsg(sock, m) {
  if (!m) return m;
  if (m.key) {
    m.id = m.key.id;
    m.isBaileys = m.id?.startsWith("BAE5") && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat?.endsWith("@g.us");
    m.sender = sock.decodeJid(
      m.fromMe && sock.user?.id || m.participant || m.key.participant || m.chat || ""
    );
  }
  if (m.message) {
    m.mtype = Object.keys(m.message)[0];
    m.msg = m.message[m.mtype];
    if (m.mtype === "ephemeralMessage" && m.message.ephemeralMessage?.message) {
      m.mtype = Object.keys(m.message.ephemeralMessage.message)[0];
      m.msg = m.message.ephemeralMessage.message[m.mtype];
    }
    if (m.mtype === "viewOnceMessage" || m.mtype === "viewOnceMessageV2") {
      const inner = m.msg?.message || {};
      m.mtype = Object.keys(inner)[0] || m.mtype;
      m.msg = inner[m.mtype] || m.msg;
    }
    m.body =
      m.message.conversation ||
      m.msg?.text ||
      m.msg?.caption ||
      m.msg?.contentText ||
      m.msg?.selectedDisplayText ||
      "";
    m.quoted = m.msg?.contextInfo?.quotedMessage || null;
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
    if (m.quoted) {
      m.quoted.sender = m.msg.contextInfo.participant || "";
      m.quoted.key = {
        remoteJid: m.chat,
        fromMe: false,
        id: m.msg.contextInfo.stanzaId,
        participant: m.msg.contextInfo.participant
      };
    }
  }
  m.reply = async (text, options = {}) => {
    return sock.sendMessage(m.chat, { text: String(text), ...options }, { quoted: m });
  };
  m.react = async (emoji) => {
    try {
      return await sock.sendMessage(m.chat, {
        react: { text: emoji, key: m.key }
      });
    } catch {
      return null;
    }
  };
  return m;
}

// ========== DOWNLOAD MEDIA ==========
async function downloadMedia(msg, filename) {
  try {
    const buffer = await require("@whiskeysockets/baileys").downloadMediaMessage(msg, "buffer", {}, { logger: console, reuploadRequest: sock => sock.updateMediaMessage });
    if (filename) {
      await fs.writeFile(filename, buffer);
      return filename;
    }
    return buffer;
  } catch (e) {
    console.error("Download media error:", e);
    return null;
  }
}

// ========== GET BUFFER ==========
async function getBuffer(url) {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(res.data);
  } catch (e) {
    return null;
  }
}

// ========== SLEEP ==========
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== PICK RANDOM ==========
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ========== FORMAT NUMBER ==========
function formatNumber(num) {
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ========== PARSE MENTION ==========
function parseMention(text) {
  return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + "@s.whatsapp.net");
}

// ========== IS URL ==========
function isUrl(url) {
  return /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+\~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.\~#?&/=]*)/gi.test(url);
}

// ========== JSON DB HELPERS ==========
const dbPath = "./database.json";

function loadDB() {
  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeJsonSync(dbPath, {
        users: {},
        groups: {},
        settings: {},
        banned: [],
        warns: {},
        antifake: {},
        antilink: {},
        antispam: {},
        mute: {}
      });
    }
    return fs.readJsonSync(dbPath);
  } catch {
    return { users: {}, groups: {}, settings: {}, banned: [], warns: {}, antifake: {}, antilink: {}, antispam: {}, mute: {} };
  }
}

function saveDB(data) {
  try {
    fs.writeJsonSync(dbPath, data, { spaces: 2 });
  } catch (e) {
    console.error("Save DB error:", e);
  }
}

module.exports = {
  fancy,
  fancyUpper,
  runtime,
  getTime,
  getDate,
  isOwner,
  smsg,
  downloadMedia,
  getBuffer,
  sleep,
  pickRandom,
  formatNumber,
  parseMention,
  isUrl,
  loadDB,
  saveDB
};
