module.exports = {
  // Bot Identity
  botName: "ＣＲＡＳＨＥＲ ＭＤ",
  botNameFull: "Crasher ƠƬ MD",
  ownerName: "ＣＲＡＳＨＥＲ",
  prefix: ".",
  totalCmds: 150,

  // Owners (digits only, country code included)
  owners: [
    "2348071569915",
    "2348102350169"
  ],

  // Bot Profile Picture
  botPfp: "https://files.catbox.moe/hhafg3.jpg",

  // Session
  sessionName: "session",

  // Auto Features (default states)
  auto: {
    read: true,
    typing: false,
    online: true,
    recording: false,
    react: true,
    reply: false,
    sticker: false,
    view: true,
    bio: false,
    likeStatus: false
  },

  // Anti Features (default states - per group will override)
  anti: {
    link: false,
    bot: false,
    spam: true,
    flood: true,
    tag: false,
    delete: true,
    badword: false,
    sticker: false,
    fake: false,
    promote: false
  },

  // Mode
  public: true, // true = public, false = private (only owners)
  language: "en",

  // Render / Server
  port: process.env.PORT || 3000,
  timezone: "Africa/Lagos"
};
