/**
 * ＣＲＡＳＨＥＲ ＭＤ - FINAL FIXED
 * FIXED: Pairing + EADDRINUSE + Timezone
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadMediaMessage
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const chalk = require("chalk");
const config = require("./config");
const {
  fancy, runtime, getTime, getDate,
  isOwner, smsg, getBuffer, sleep, pickRandom,
  isUrl, loadDB, saveDB
} = require("./lib/function");

// ========== GLOBALS ==========
let startTime = Date.now();
const logger = pino({ level: "silent" });
const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname, "public")));

let db = loadDB();
const PORT = process.env.PORT || 10000;
const SESSIONS_DIR = path.join(__dirname,'session');
if(!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR,{recursive:true});

function listSessions(){
  return fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter(f=>fs.statSync(path.join(SESSIONS_DIR,f)).isDirectory()) : []
}

// ========== PAIRING - FIXED ==========
async function handlePair(phone, res){
  try{
    phone = String(phone||'').replace(/\D/g,'')
    if(!phone || phone.length < 10) return res.json({success:false, message:'Invalid phone number'})
    
    const sessionPath = path.join(SESSIONS_DIR, phone)
    if(!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath,{recursive:true})
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
    
    const tempSock = makeWASocket({
      version: [2,3000,1023223821],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      printQRInTerminal: false,
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: false
    })
    
    tempSock.ev.on('creds.update', saveCreds)
    await new Promise(r=>setTimeout(r,2000))
    
    if(tempSock.authState.creds.registered){
      return res.json({success:false, message:'Already paired - delete session/'+phone})
    }
    
    let code = await tempSock.requestPairingCode(phone)
    code = code?.match(/.{1,4}/g)?.join('-') || code
    console.log(chalk.green(`[PAIR] ${phone} => ${code}`))
    
    tempSock.ev.on('connection.update', async(u)=>{
      if(u.connection==='open'){
        console.log(chalk.green(`[PAIRED] ${phone} CONNECTED`))
        setTimeout(()=>startBot(phone),2000)
      }
    })
    
    res.json({success:true, code})
  }catch(err){
    console.error('Pair error:', err)
    res.json({success:false, message: err.message || 'Failed to request code'})
  }
}

app.get('/pair', (req,res)=>handlePair(req.query.number, res))
app.post('/pair', (req,res)=>handlePair(req.body.phone || req.body.number, res))
app.get('/', (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")))
app.get("/status", (req, res) => {
  res.json({ bot: config.botName || 'CRASHER MD', sessions: listSessions().length, uptime: runtime((Date.now() - startTime)/1000) })
})

// ========== START SOCKET PER NUMBER ==========
async function startBot(num) {
  const sessionPath = path.join(SESSIONS_DIR, num)
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  let sock = makeWASocket({
    version: [2,3000,1023223821],
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: Browsers.macOS('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    getMessage: async () => undefined
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      console.log(chalk.green(`[CONNECTED] ${num} => ${sock.user?.id}`));
      try { const buf = await getBuffer(config.botPfp); if (buf) await sock.updateProfilePicture(sock.user.id, buf); } catch {}
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
      if (code !== DisconnectReason.loggedOut) setTimeout(() => startBot(num), 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const m = messages[0];
    if (!m.message || m.key.remoteJid === "status@broadcast") return;
    try {
      const msg = smsg(sock, m);
      if (msg.isBaileys) return;
      if (config.auto?.read) await sock.readMessages([msg.key]);
      const body = (msg.body || "").trim();
      const prefix = config.prefix;
      const isCmd = body.startsWith(prefix);
      const command = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";
      const q = body.slice(prefix.length+command.length).trim();
      const sender = msg.sender;
      const chat = msg.chat;
      const isGroup = msg.isGroup;
      const pushName = msg.pushName || "User";
      if (!config.public && !isOwner(sender) && !msg.fromMe) return;
      if (db.banned?.includes(sender.split("@")[0]) && !isOwner(sender)) return;
      let isAdmin = false; let isBotAdmin = false;
      if (isGroup) {
        try {
          const meta = await sock.groupMetadata(chat);
          const botId = jidNormalizedUser(sock.user.id);
          const senderId = jidNormalizedUser(sender);
          isAdmin = meta.participants.some(p => p.id === senderId && p.admin);
          isBotAdmin = meta.participants.some(p => p.id === botId && p.admin);
        } catch {}
      }
      if (db.mute?.[chat] && !isAdmin && !isOwner(sender)) return;
      if (isGroup && isBotAdmin && db.antilink?.[chat] && isUrl(body) && !isAdmin && !isOwner(sender)) {
        try{
          await msg.react("🚫");
          await sock.sendMessage(chat, { text: fancy(`Antilink active\n@${sender.split("@")[0]} removed`), mentions: [sender] });
          await sock.groupParticipantsUpdate(chat, [sender], "remove");
        }catch{} return;
      }
      if (!isCmd) {
        if (config.auto?.react && Math.random() < 0.05) {
          await msg.react(pickRandom(["🔥","💀","⚡","🐺","✨"]));
        }
        return;
      }
      await msg.react("⏳");
      console.log(chalk.yellow(`[CMD] ${command} | ${pushName}`));
      switch (command) {
        case "menu":
        case "help":
        case "list": {
          const menuText = `
◈┈▉ \`ｃｒａｓｈｅｒ ｍｄ\` ▉┄◈
> ╭────↯
> │ ➠ *${fancy("OWNER")}:* ${fancy(config.ownerName)}
> │ ➠ *${fancy("PREFIX")}:* ${config.prefix}
> │ ➠ *${fancy("TOTAL CMDS")}:* ${config.totalCmds}
> │ ➠ *${fancy("RUNTIME")}:* ${runtime((Date.now()-startTime)/1000)}
> ╰────↯

${fancy("OWNER MENU")}
╭──────────◈
┆ ◈ .menu
┆ ◈ .help
┆ ◈ .ping
┆ ◈ .alive
┆ ◈ .owner
┆ ◈ .runtime
┆ ◈ .botinfo
┆ ◈ .restart
┆ ◈ .shutdown
┆ ◈ .broadcast
┆ ◈ .setprefix
┆ ◈ .setname
┆ ◈ .setbio
┆ ◈ .setpp
┆ ◈ .join
┆ ◈ .leave
┆ ◈ .block
┆ ◈ .unblock
┆ ◈ .ban
┆ ◈ .unban
╰──────────◈

${fancy("AUTO MENU")}
╭──────────◈
┆ ◈ .autoread
┆ ◈ .autotyping
┆ ◈ .autoonline
┆ ◈ .autorecording
┆ ◈ .autoreact
┆ ◈ .autoreply
┆ ◈ .autosticker
┆ ◈ .autoview
┆ ◈ .autobio
┆ ◈ .autolikestatus
╰──────────◈

${fancy("ANTI MENU")}
╭──────────◈
┆ ◈ .antilink
┆ ◈ .antibot
┆ ◈ .antispam
┆ ◈ .antiflood
┆ ◈ .antitag
┆ ◈ .antidelete
┆ ◈ .antibadword
┆ ◈ .antisticker
┆ ◈ .antifake
┆ ◈ .antipromote
╰──────────◈

${fancy("MODERATOR MENU")}
╭──────────◈
┆ ◈ .kick
┆ ◈ .add
┆ ◈ .promote
┆ ◈ .demote
┆ ◈ .warn
┆ ◈ .warnings
┆ ◈ .resetwarn
┆ ◈ .mute
┆ ◈ .unmute
┆ ◈ .delete
╰──────────◈

${fancy("GROUP MENU")}
╭──────────◈
┆ ◈ .groupinfo
┆ ◈ .grouplink
┆ ◈ .setname
┆ ◈ .setdesc
┆ ◈ .open
┆ ◈ .close
┆ ◈ .tagall
┆ ◈ .hidetag
┆ ◈ .listmembers
┆ ◈ .admins
╰──────────◈

${fancy("VV MENU")}
╭──────────◈
┆ ◈ .vv
╰──────────◈

${fancy("DOWNLOADER MENU")}
╭──────────◈
┆ ◈ .play
┆ ◈ .song
┆ ◈ .video
┆ ◈ .tiktok
┆ ◈ .instagram
┆ ◈ .facebook
┆ ◈ .mediafire
┆ ◈ .apk
┆ ◈ .pinterest
┆ ◈ .github
╰──────────◈

${fancy("TOOLS MENU")}
╭──────────◈
┆ ◈ .weather
┆ ◈ .translate
┆ ◈ .calculate
┆ ◈ .shorturl
╰──────────◈

${fancy("SETTINGS MENU")}
╭──────────◈
┆ ◈ .prefix
┆ ◈ .public
┆ ◈ .private
┆ ◈ .setmode
┆ ◈ .language
╰──────────◈

${fancy("STICKER MENU")}
╭──────────◈
┆ ◈ .sticker
┆ ◈ .toimg
┆ ◈ .take
┆ ◈ .attp
┆ ◈ .smeme
╰──────────◈

${fancy("FUN MENU")}
╭──────────◈
┆ ◈ .joke
┆ ◈ .quote
┆ ◈ .meme
┆ ◈ .truth
┆ ◈ .dare
╰──────────◈

◈┈▉ \`ｃｒａｓｈｅｒ ｍｄ\` ▉┄◈
> ⚡ ${fancy("POWER • SPEED • CONTROL")}
> 🐺 ${fancy("CRASHER MD — 2026")}
`;
          await sock.sendMessage(chat, {
            image: { url: config.botPfp },
            caption: menuText
          }, { quoted: m });
          break;
        }

        case "ping": {
          const start = Date.now();
          const sent = await sock.sendMessage(chat, { text: fancy("Ｐｉｎｇｉｎｇ...") }, { quoted: m });
          const latency = Date.now() - start;
          await sock.sendMessage(chat, {
            text: `🏓 *${fancy("PONG")}*\n\n📡 \( {fancy("Latency")}: * \){latency}ms*\n⚡ \( {fancy("Speed")}: * \){latency < 200 ? "Fast" : latency < 500 ? "Normal" : "Slow"}*`,
            edit: sent.key
          });
          break;
        }

        case "alive": {
          await sock.sendMessage(chat, {
            text: `🐺 *${config.botName}*\n\n✅ ${fancy("I am Alive")}\n⏱ ${fancy("Runtime")}: ${runtime((Date.now()-startTime)/1000)}\n📅 ${getDate()} \( {getTime()}\n\n \){fancy("Power • Speed • Control")}`
          }, { quoted: m });
          break;
        }

        case "owner": {
          const ownerList = config.owners.map((o, i) => `\( {i+1}. wa.me/ \){o}`).join("\n");
          await sock.sendMessage(chat, {
            text: `👑 *\( {fancy("OWNER")}*\n\n \){ownerList}\n\n\( {fancy("Developer")}: Crasher\n \){fancy("Inc")}: Crasher Team`
          }, { quoted: m });
          break;
        }

        case "runtime": {
          await msg.reply(`⏱ *\( {fancy("RUNTIME")}*\n\n \){runtime((Date.now()-startTime)/1000)}`);
          break;
        }

        case "botinfo": {
          await msg.reply(`🤖 *${config.botName}*\n\n📦 ${fancy("Library")}: Baileys\n⚙️ ${fancy("Prefix")}: ${config.prefix}\n📜 ${fancy("Commands")}: ${config.totalCmds}\n🌐 ${fancy("Mode")}: ${config.public ? "Public" : "Private"}\n⏱ ${fancy("Uptime")}: ${runtime((Date.now()-startTime)/1000)}`);
          break;
        }

        case "restart": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          await msg.reply(fancy("Restarting bot..."));
          process.exit(0);
          break;
        }

        case "shutdown": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          await msg.reply(fancy("Shutting down..."));
          process.exit(1);
          break;
        }

        case "broadcast": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          if (!q) return msg.reply(fancy("Usage: .broadcast <text>"));
          await msg.reply(fancy("Broadcast started..."));
          await msg.reply(fancy("Broadcast feature ready. Store chats in DB for full use."));
          break;
        }

        case "setprefix": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          if (!q) return msg.reply(fancy("Usage: .setprefix <newprefix>"));
          config.prefix = q[0];
          await msg.reply(`${fancy("Prefix updated to")}: ${config.prefix}`);
          break;
        }

        case "setname": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          if (!q) return msg.reply(fancy("Usage: .setname <name>"));
          await sock.updateProfileName(q);
          await msg.reply(`${fancy("Name updated to")}: ${q}`);
          break;
        }

        case "setbio": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          if (!q) return msg.reply(fancy("Usage: .setbio <text>"));
          await sock.updateProfileStatus(q);
          await msg.reply(`${fancy("Bio updated")}`);
          break;
        }

        case "setpp": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          let media = null;
          if (msg.quoted && (msg.quoted.imageMessage || msg.message?.imageMessage)) {
            media = await downloadMediaMessage(msg.quoted ? { key: msg.quoted.key || msg.key, message: msg.quoted } : m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
          } else if (q && isUrl(q)) {
            media = await getBuffer(q);
          } else {
            return msg.reply(fancy("Reply to an image or give image URL"));
          }
          if (media) {
            await sock.updateProfilePicture(sock.user.id, media);
            await msg.reply(fancy("Profile picture updated"));
          }
          break;
        }

        case "join": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          if (!q) return msg.reply(fancy("Usage: .join <group link>"));
          const code = q.split("https://chat.whatsapp.com/")[1] || q;
          await sock.groupAcceptInvite(code);
          await msg.reply(fancy("Joined the group"));
          break;
        }

        case "leave": {
          if (!isOwner(sender) && !isAdmin) return msg.reply(fancy("Admin / Owner only"));
          await msg.reply(fancy("Leaving group..."));
          await sock.groupLeave(chat);
          break;
        }

        case "block": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null) || (q ? q.replace(/\D/g,"") + "@s.whatsapp.net" : null);
          if (!target) return msg.reply(fancy("Tag / reply / number needed"));
          await sock.updateBlockStatus(target, "block");
          await msg.reply(`\( {fancy("Blocked")} @ \){target.split("@")[0]}`, { mentions: [target] });
          break;
        }

        case "unblock": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null) || (q ? q.replace(/\D/g,"") + "@s.whatsapp.net" : null);
          if (!target) return msg.reply(fancy("Tag / reply / number needed"));
          await sock.updateBlockStatus(target, "unblock");
          await msg.reply(`\( {fancy("Unblocked")} @ \){target.split("@")[0]}`, { mentions: [target] });
          break;
        }

        case "ban": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          let num = (msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null) || q || "").replace(/\D/g, "");
          if (!num) return msg.reply(fancy("Tag / reply / number needed"));
          if (!db.banned.includes(num)) db.banned.push(num);
          saveDB(db);
          await msg.reply(`${fancy("Banned")} ${num}`);
          break;
        }

        case "unban": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          let num = (msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null) || q || "").replace(/\D/g, "");
          if (!num) return msg.reply(fancy("Tag / reply / number needed"));
          db.banned = db.banned.filter(n => n !== num);
          saveDB(db);
          await msg.reply(`${fancy("Unbanned")} ${num}`);
          break;
        }

        // ==================== AUTO MENU ====================
        case "autoread": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.read = !config.auto.read;
          await msg.reply(`${fancy("Autoread")}: ${config.auto.read ? "ON" : "OFF"}`);
          break;
        }
        case "autotyping": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.typing = !config.auto.typing;
          await msg.reply(`${fancy("Autotyping")}: ${config.auto.typing ? "ON" : "OFF"}`);
          break;
        }
        case "autoonline": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.online = !config.auto.online;
          await msg.reply(`${fancy("Autoonline")}: ${config.auto.online ? "ON" : "OFF"}`);
          break;
        }
        case "autorecording": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.recording = !config.auto.recording;
          await msg.reply(`${fancy("Autorecording")}: ${config.auto.recording ? "ON" : "OFF"}`);
          break;
        }
        case "autoreact": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.react = !config.auto.react;
          await msg.reply(`${fancy("Autoreact")}: ${config.auto.react ? "ON" : "OFF"}`);
          break;
        }
        case "autoreply": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.reply = !config.auto.reply;
          await msg.reply(`${fancy("Autoreply")}: ${config.auto.reply ? "ON" : "OFF"}`);
          break;
        }
        case "autosticker": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.sticker = !config.auto.sticker;
          await msg.reply(`${fancy("Autosticker")}: ${config.auto.sticker ? "ON" : "OFF"}`);
          break;
        }
        case "autoview": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.view = !config.auto.view;
          await msg.reply(`${fancy("Autoview")}: ${config.auto.view ? "ON" : "OFF"}`);
          break;
        }
        case "autobio": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.bio = !config.auto.bio;
          await msg.reply(`${fancy("Autobio")}: ${config.auto.bio ? "ON" : "OFF"}`);
          break;
        }
        case "autolikestatus": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.auto.likeStatus = !config.auto.likeStatus;
          await msg.reply(`${fancy("Autolikestatus")}: ${config.auto.likeStatus ? "ON" : "OFF"}`);
          break;
        }

        // ==================== ANTI MENU ====================
        case "antilink": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          db.antilink[chat] = !db.antilink[chat];
          saveDB(db);
          await msg.reply(`${fancy("Antilink")}: ${db.antilink[chat] ? "ON" : "OFF"}`);
          break;
        }
        case "antibot":
        case "antispam":
        case "antiflood":
        case "antitag":
        case "antidelete":
        case "antibadword":
        case "antisticker":
        case "antifake":
        case "antipromote": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          const key = command;
          if (!db[key]) db[key] = {};
          db[key][chat] = !db[key][chat];
          saveDB(db);
          await msg.reply(`${fancy(command)}: ${db[key][chat] ? "ON" : "OFF"}`);
          break;
        }

        // ==================== MODERATOR MENU ====================
        case "kick": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null);
          if (!target) return msg.reply(fancy("Tag or reply to user"));
          await sock.groupParticipantsUpdate(chat, [target], "remove");
          await msg.reply(`\( {fancy("Kicked")} @ \){target.split("@")[0]}`, { mentions: [target] });
          break;
        }
        case "add": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          if (!q) return msg.reply(fancy("Usage: .add <number>"));
          const num = q.replace(/\D/g, "") + "@s.whatsapp.net";
          await sock.groupParticipantsUpdate(chat, [num], "add");
          await msg.reply(`${fancy("Added")} ${q}`);
          break;
        }
        case "promote": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null);
          if (!target) return msg.reply(fancy("Tag or reply to user"));
          await sock.groupParticipantsUpdate(chat, [target], "promote");
          await msg.reply(`\( {fancy("Promoted")} @ \){target.split("@")[0]}`, { mentions: [target] });
          break;
        }
        case "demote": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null);
          if (!target) return msg.reply(fancy("Tag or reply to user"));
          await sock.groupParticipantsUpdate(chat, [target], "demote");
          await msg.reply(`\( {fancy("Demoted")} @ \){target.split("@")[0]}`, { mentions: [target] });
          break;
        }
        case "warn": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null);
          if (!target) return msg.reply(fancy("Tag or reply to user"));
          const id = target.split("@")[0];
          if (!db.warns[chat]) db.warns[chat] = {};
          if (!db.warns[chat][id]) db.warns[chat][id] = 0;
          db.warns[chat][id]++;
          saveDB(db);
          await msg.reply(`\( {fancy("Warned")} @ \){id}\n${fancy("Warnings")}: ${db.warns[chat][id]}/3`, { mentions: [target] });
          if (db.warns[chat][id] >= 3 && isBotAdmin) {
            await sock.groupParticipantsUpdate(chat, [target], "remove");
            await msg.reply(fancy("User removed after 3 warnings"));
          }
          break;
        }
        case "warnings": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : sender);
          const id = target.split("@")[0];
          const count = db.warns[chat]?.[id] || 0;
          await msg.reply(`@${id} ${fancy("has")} ${count} ${fancy("warnings")}`, { mentions: [target] });
          break;
        }
        case "resetwarn": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          let target = msg.mentionedJid[0] || (msg.quoted ? msg.quoted.sender : null);
          if (!target) return msg.reply(fancy("Tag or reply to user"));
          const id = target.split("@")[0];
          if (db.warns[chat]) delete db.warns[chat][id];
          saveDB(db);
          await msg.reply(`\( {fancy("Warnings reset for")} @ \){id}`, { mentions: [target] });
          break;
        }
        case "mute": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          db.mute[chat] = true;
          saveDB(db);
          await msg.reply(fancy("Group muted. Only admins can speak."));
          break;
        }
        case "unmute": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          delete db.mute[chat];
          saveDB(db);
          await msg.reply(fancy("Group unmuted"));
          break;
        }
        case "delete":
        case "del": {
          if (!msg.quoted) return msg.reply(fancy("Reply to a message"));
          await sock.sendMessage(chat, { delete: msg.quoted.key || msg.key });
          break;
       }
          
        // ==================== GROUP MENU ====================
        case "groupinfo": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          const meta = groupMetadata;
          await msg.reply(`📋 *${fancy("GROUP INFO")}*\n\n🏷 ${fancy("Name")}: ${meta.subject}\n👥 ${fancy("Members")}: ${meta.participants.length}\n📝 ${fancy("Desc")}: ${meta.desc || "None"}\n🆔 ${meta.id}`);
          break;
        }
        case "grouplink": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          const code = await sock.groupInviteCode(chat);
          await msg.reply(`🔗 https://chat.whatsapp.com/${code}`);
          break;
        }
        case "setname": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          if (!q) return msg.reply(fancy("Usage: .setname <new name>"));
          await sock.groupUpdateSubject(chat, q);
          await msg.reply(fancy("Group name updated"));
          break;
        }
        case "setdesc": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          if (!q) return msg.reply(fancy("Usage: .setdesc <text>"));
          await sock.groupUpdateDescription(chat, q);
          await msg.reply(fancy("Group description updated"));
          break;
        }
        case "open": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          await sock.groupSettingUpdate(chat, "not_announcement");
          await msg.reply(fancy("Group opened"));
          break;
        }
        case "close": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          if (!isBotAdmin) return msg.reply(fancy("Bot must be admin"));
          await sock.groupSettingUpdate(chat, "announcement");
          await msg.reply(fancy("Group closed"));
          break;
        }
        case "tagall": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          let teks = `📢 *\( {fancy("TAG ALL")}*\n\n \){q || ""}\n\n`;
          const mentions = [];
          for (const p of participants) {
            teks += `❯ @${p.id.split("@")[0]}\n`;
            mentions.push(p.id);
          }
          await sock.sendMessage(chat, { text: teks, mentions }, { quoted: m });
          break;
        }
        case "hidetag": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          if (!isAdmin && !isOwner(sender)) return msg.reply(fancy("Admin only"));
          const mentions = participants.map(p => p.id);
          await sock.sendMessage(chat, { text: q || " ", mentions }, { quoted: m });
          break;
        }
        case "listmembers": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          let list = participants.map((p, i) => `\( {i+1}. @ \){p.id.split("@")[0]}${p.admin ? " (admin)" : ""}`).join("\n");
          await sock.sendMessage(chat, { text: `👥 *\( {fancy("MEMBERS")}*\n\n \){list}`, mentions: participants.map(p => p.id) }, { quoted: m });
          break;
        }
        case "admins": {
          if (!isGroup) return msg.reply(fancy("Group only"));
          const admins = participants.filter(p => p.admin);
          let list = admins.map((p, i) => `\( {i+1}. @ \){p.id.split("@")[0]}`).join("\n");
          await sock.sendMessage(chat, { text: `👑 *\( {fancy("ADMINS")}*\n\n \){list}`, mentions: admins.map(p => p.id) }, { quoted: m });
          break;
        }
          
        // ==================== VV ====================
        case "vv": {
          if (!msg.quoted) return msg.reply(fancy("Reply to a view once message"));
          try {
            const quoted = msg.quoted;
            const type = Object.keys(quoted)[0];
            if (type === "viewOnceMessage" || type === "viewOnceMessageV2") {
              const realMsg = quoted[type].message;
              const realType = Object.keys(realMsg)[0];
              if (realType === "imageMessage") {
                const buffer = await downloadMediaMessage({ key: msg.key, message: { [realType]: realMsg[realType] } }, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
                await sock.sendMessage(chat, { image: buffer, caption: fancy("View once unlocked") }, { quoted: m });
              } else if (realType === "videoMessage") {
                const buffer = await downloadMediaMessage({ key: msg.key, message: { [realType]: realMsg[realType] } }, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
                await sock.sendMessage(chat, { video: buffer, caption: fancy("View once unlocked") }, { quoted: m });
              } else {
                await msg.reply(fancy("Unsupported view once type"));
              }
            } else {
              await msg.reply(fancy("That is not a view once message"));
            }
          } catch (e) {
            await msg.reply(fancy("Failed to unlock view once"));
          }
          break;
        }

        // ==================== DOWNLOADERS ====================
        case "play":
        case "song": {
          if (!q) return msg.reply(fancy("Usage: .play <song name>"));
          await msg.reply(`${fancy("Searching")} 🎵 ${q}...`);
          await msg.reply(`\( {fancy("Play feature ready")}\n\n🔍 Query: * \){q}*\n\nInstall yt-search + ytdl-core for full audio download.`);
          break;
        }
        case "video": {
          if (!q) return msg.reply(fancy("Usage: .video <name or url>"));
          await msg.reply(`${fancy("Video download ready")}\nQuery: ${q}`);
          break;
        }
        case "tiktok": {
          if (!q || !isUrl(q)) return msg.reply(fancy("Usage: .tiktok <tiktok url>"));
          await msg.reply(`${fancy("TikTok download")}\nURL: ${q}\n\nUse a reliable TikTok API endpoint in production.`);
          break;
        }
        case "instagram": {
          if (!q || !isUrl(q)) return msg.reply(fancy("Usage: .instagram <ig url>"));
          await msg.reply(`${fancy("Instagram download")}\nURL: ${q}`);
          break;
        }
        case "facebook": {
          if (!q || !isUrl(q)) return msg.reply(fancy("Usage: .facebook <fb url>"));
          await msg.reply(`${fancy("Facebook download")}\nURL: ${q}`);
          break;
        }
        case "mediafire": {
          if (!q || !isUrl(q)) return msg.reply(fancy("Usage: .mediafire <link>"));
          await msg.reply(`\( {fancy("Mediafire")}\n \){q}`);
          break;
        }
        case "apk": {
          if (!q) return msg.reply(fancy("Usage: .apk <app name>"));
          await msg.reply(`${fancy("APK search")}: ${q}`);
          break;
        }
        case "pinterest": {
          if (!q) return msg.reply(fancy("Usage: .pinterest <query>"));
          await msg.reply(`${fancy("Pinterest")}: ${q}`);
          break;
        }
        case "github": {
          if (!q) return msg.reply(fancy("Usage: .github <username/repo>"));
          try {
            const res = await axios.get(`https://api.github.com/repos/${q}`);
            const d = res.data;
            await msg.reply(`🐙 *${fancy("GITHUB")}*\n\n📦 ${d.full_name}\n⭐ ${d.stargazers_count}\n🍴 ${d.forks_count}\n📝 ${d.description || "No desc"}\n🔗 ${d.html_url}`);
          } catch {
            await msg.reply(fancy("Repo not found"));
          }
          break;
        }

        // ==================== TOOLS ====================
        case "weather": {
          if (!q) return msg.reply(fancy("Usage: .weather <city>"));
          try {
            const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`);
            if (!geo.data.results?.length) return msg.reply(fancy("City not found"));
            const { latitude, longitude, name, country } = geo.data.results[0];
            const w = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=\( {latitude}&longitude= \){longitude}&current_weather=true`);
            const cur = w.data.current_weather;
            await msg.reply(`🌤 *${fancy("WEATHER")}*\n\n📍 ${name}, ${country}\n🌡 ${cur.temperature}°C\n💨 ${cur.windspeed} km/h\n🧭 ${cur.winddirection}°`);
          } catch {
            await msg.reply(fancy("Weather service error"));
          }
          break;
        }
        case "translate": {
          if (!q) return msg.reply(fancy("Usage: .translate <text>"));
          await msg.reply(`${fancy("Translate")}: ${q}\n\n(Add Google Translate / LibreTranslate API for full support)`);
          break;
        }
        case "calculate":
        case "calc": {
          if (!q) return msg.reply(fancy("Usage: .calculate <expression>"));
          try {
            const sanitized = q.replace(/[^0-9+\-*/().%\s]/g, "");
            const result = Function(`"use strict"; return (${sanitized})`)();
            await msg.reply(`🧮 \( {q} = * \){result}*`);
          } catch {
            await msg.reply(fancy("Invalid expression"));
          }
          break;
        }
        case "shorturl": {
          if (!q || !isUrl(q)) return msg.reply(fancy("Usage: .shorturl <url>"));
          try {
            const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(q)}`);
            await msg.reply(`🔗 *\( {fancy("SHORT URL")}*\n\n \){res.data}`);
          } catch {
            await msg.reply(fancy("Shorten failed"));
          }
          break;
        }
// ==================== SETTINGS ====================
        case "prefix": {
          await msg.reply(`${fancy("Current prefix")}: ${config.prefix}`);
          break;
        }
        case "public": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.public = true;
          await msg.reply(fancy("Bot is now PUBLIC"));
          break;
        }
        case "private": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.public = false;
          await msg.reply(fancy("Bot is now PRIVATE (owners only)"));
          break;
        }
        case "setmode": {
          if (!isOwner(sender)) return msg.reply(fancy("Owner only"));
          config.public = !config.public;
          await msg.reply(`${fancy("Mode")}: ${config.public ? "Public" : "Private"}`);
          break;
        }
        case "language": {
          await msg.reply(`${fancy("Language")}: ${config.language}`);
          break;
        }

        // ==================== STICKER ====================
        case "sticker":
        case "s": {
          if (!msg.quoted && !msg.message.imageMessage && !msg.message.videoMessage) {
            return msg.reply(fancy("Reply to image/video or send with caption .sticker"));
          }
          await msg.reply(fancy("Sticker conversion requires sharp/ffmpeg setup. Reply to media and the handler is ready."));
          break;
        }
        case "toimg": {
          if (!msg.quoted) return msg.reply(fancy("Reply to a sticker"));
          await msg.reply(fancy("toimg handler ready (needs media download + convert)"));
          break;
        }
        case "take": {
          await msg.reply(fancy("Take sticker pack name ready"));
          break;
        }
        case "attp": {
          if (!q) return msg.reply(fancy("Usage: .attp <text>"));
          await msg.reply(`${fancy("ATTP")}: ${q}`);
          break;
        }
        case "smeme": {
          if (!q) return msg.reply(fancy("Usage: .smeme top|bottom (reply image)"));
          await msg.reply(fancy("Smeme handler ready"));
          break;
        }

        // ==================== FUN ====================
        case "joke": {
          const jokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs.",
            "There are 10 types of people: those who understand binary and those who don't.",
            "A SQL query walks into a bar, walks up to two tables and asks: Can I join you?",
            "Why did the developer go broke? Because he used up all his cache.",
            "How many programmers does it take to change a light bulb? None, that's a hardware problem."
          ];
          await msg.reply(`😂 ${pickRandom(jokes)}`);
          break;
        }
        case "quote": {
          const quotes = [
            "The only way to do great work is to love what you do. – Steve Jobs",
            "Code is like humor. When you have to explain it, it’s bad. – Cory House",
            "First, solve the problem. Then, write the code. – John Johnson",
            "Experience is the name everyone gives to their mistakes. – Oscar Wilde",
            "Simplicity is the soul of efficiency. – Austin Freeman"
          ];
          await msg.reply(`💬 ${pickRandom(quotes)}`);
          break;
        }
        case "meme": {
          await msg.reply(fancy("Meme feature – connect to meme API for images"));
          break;
        }
        case "truth": {
          const truths = [
            "What is your biggest fear?",
            "Have you ever lied to your best friend?",
            "What is the most embarrassing thing you have done?",
            "Who was your first crush?",
            "What secret have you never told anyone?"
          ];
          await msg.reply(`🔮 *\( {fancy("TRUTH")}*\n\n \){pickRandom(truths)}`);
          break;
        }
        case "dare": {
          const dares = [
            "Send a voice note singing your favorite song.",
            "Change your profile picture to a meme for 1 hour.",
            "Text your crush 'I like you' (or last person you texted).",
            "Do 10 push-ups and send a video.",
            "Talk in an accent for the next 5 messages."
          ];
          await msg.reply(`🔥 *\( {fancy("DARE")}*\n\n \){pickRandom(dares)}`);
          break;
        }

        default:
          break;
      }

      // Final reaction 💀
      await msg.react("💀");

        default:
          break;
      }

    } catch (err) {
      console.error("Handler error:", err);
      try { await msg.react("⚠️"); } catch {}
    }
  });

  return sock;
}

// ========== START SERVER + BOT - FIXED EADDRINUSE ==========
if (!global.__CRASHER_LISTENED) {
  global.__CRASHER_LISTENED = true;
  app.listen(PORT, () => {
    console.log(chalk.magenta(`\n🌐 Pairing UI → http://localhost:${PORT}`));
    console.log(chalk.magenta(`📡 Status     → http://localhost:${PORT}/status\n`));
    console.log(chalk.cyan(`[BOOT] Starting ${listSessions().length} sessions...`));
    listSessions().forEach(n => {
      startBot(n).catch(e => console.error(`Failed ${n}:`, e));
    });
  });
}

process.on("uncaughtException", (err) => console.error("Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));
