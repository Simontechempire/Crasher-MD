const fs = require("fs-extra");
const axios = require("axios");
const moment = require("moment-timezone");

let config = {};
try { config = require("../config"); } catch { config = require("./config"); }

const fancyMap = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
  j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
  s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
  A: "ᴀ", B: "ʙ", C: "ᴄ", D: "ᴅ", E: "ᴇ", F: "ꜰ", G: "ɢ", H: "ʜ", I: "ɪ",
  J: "ᴊ", K: "ᴋ", L: "ʟ", M: "ᴍ", N: "ɴ", O: "ᴏ", P: "ᴘ", Q: "ǫ", R: "ʀ",
  S: "ꜱ", T: "ᴛ", U: "ᴜ", V: "ᴠ", W: "ᴡ", X: "x", Y: "ʏ", Z: "ᴢ"
};

function fancy(text) { return String(text).split("").map(c => fancyMap[c] || c).join(""); }
function fancyUpper(text) { return fancy(String(text).toUpperCase()); }
function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400)/3600);
  const m = Math.floor((seconds % 3600)/60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}
function getTime() { return moment().tz(config.timezone || "Africa/Lagos").format("HH:mm:ss"); }
function getDate() { return moment().tz(config.timezone || "Africa/Lagos").format("DD/MM/YYYY"); }
function isOwner(jid) {
  if (!jid) return false;
  const num = jid.replace(/[^0-9]/g, "");
  const owners = config.owners || config.OWNERS || [];
  return owners.some(o => num.includes(String(o).replace(/\D/g,'')));
}
function smsg(sock, m) {
  if (!m) return m;
  if (m.key) {
    m.id = m.key.id;
    m.isBaileys = m.id?.startsWith("BAE5") && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat?.endsWith("@g.us");
    m.sender = sock.decodeJid(m.fromMe && sock.user?.id || m.participant || m.key.participant || m.chat || "");
  }
  if (m.message) {
    m.mtype = Object.keys(m.message)[0];
    m.msg = m.message[m.mtype];
    if (m.mtype === "ephemeralMessage") {
      m.mtype = Object.keys(m.message.ephemeralMessage.message)[0];
      m.msg = m.message.ephemeralMessage.message[m.mtype];
    }
    m.body = m.message.conversation || m.msg?.text || m.msg?.caption || m.msg?.contentText || "";
    m.quoted = m.msg?.contextInfo?.quotedMessage || null;
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
    if (m.quoted && m.msg?.contextInfo) {
      m.quoted.sender = m.msg.contextInfo.participant || "";
      m.quoted.key = { remoteJid: m.chat, fromMe: false, id: m.msg.contextInfo.stanzaId, participant: m.msg.contextInfo.participant };
    }
  }
  m.reply = (text) => sock.sendMessage(m.chat, { text: String(text) }, { quoted: m });
  m.react = async (emoji) => { try{ await sock.sendMessage(m.chat,{react:{text:emoji,key:m.key}})}catch{} };
  return m;
}
async function getBuffer(url) {
  try { const res = await axios.get(url, { responseType: "arraybuffer" }); return Buffer.from(res.data); } catch { return null; }
}
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function pickRandom(arr){return arr[Math.floor(Math.random()*arr.length)]}
function parseMention(text){return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v=>v[1]+"@s.whatsapp.net")}
function isUrl(url){return /https?:\/\//.test(url)}
const dbPath = "./database.json";
function loadDB(){
  try{
    if(!fs.existsSync(dbPath)) fs.writeJsonSync(dbPath,{users:{},groups:{},settings:{},banned:[],warns:{},antilink:{},mute:{},antibot:{},antispam:{}} );
    return fs.readJsonSync(dbPath);
  }catch{ return {banned:[],antilink:{},mute:{},antibot:{}} }
}
function saveDB(data){ try{ fs.writeJsonSync(dbPath,data,{spaces:2})}catch{} }
module.exports = { fancy, fancyUpper, runtime, getTime, getDate, isOwner, smsg, getBuffer, sleep, pickRandom, parseMention, isUrl, loadDB, saveDB };
