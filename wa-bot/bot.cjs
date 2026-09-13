const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 7860;

const ROOT_DIR = path.resolve(__dirname, '..');
const PROMOS_JSON_PATH = path.join(ROOT_DIR, 'promos.json');
const POSTERS_JSON_PATH = path.join(ROOT_DIR, 'promo-posters.json');
const IMAGES_DIR = path.join(ROOT_DIR, 'images');
const GITHUB_REPO = 'raksatravel/raksatravel.github.io';
const RAKSA_CHANNEL_ID = '120363413097453454@newsletter';

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

let GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
try {
  const cfgPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (cfg.GITHUB_TOKEN) GITHUB_TOKEN = cfg.GITHUB_TOKEN;
  }
} catch (e) {}

let latestQrDataUrl = '';
let isBotReady = false;
let authStatus = 'Menunggu Inisialisasi';
let lastSyncTime = 'Belum pernah';
let syncLogHistory = [];

function logSync(msg) {
  const timeStr = new Date().toLocaleTimeString('id-ID');
  console.log(`[${timeStr}] ${msg}`);
  syncLogHistory.unshift(`[${timeStr}] ${msg}`);
  if (syncLogHistory.length > 50) syncLogHistory.pop();
}

console.log('====================================================');
console.log('🤖 RAKSA TRAVEL - ULTIMATE LIVE WHATSAPP CHANNEL BOT');
console.log('====================================================\n');

// Detect browser path
let browserExecutable = process.env.PUPPETEER_EXECUTABLE_PATH || '';
if (!browserExecutable) {
  const bravePath = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  const chromeLocal = 'C:\\Users\\Raihan\\.cache\\puppeteer\\chrome\\win64-146.0.7680.31\\chrome-win64\\chrome.exe';
  if (fs.existsSync(bravePath)) browserExecutable = bravePath;
  else if (fs.existsSync(chromeLocal)) browserExecutable = chromeLocal;
}

console.log(`🌐 Browser Engine: ${browserExecutable || 'Default Chromium'}\n`);

// Automatically clear stale Chromium lockfiles
try {
  const authSessionDir = path.join(__dirname, '.wwebjs_auth', 'session');
  if (fs.existsSync(authSessionDir)) {
    ['lockfile', 'DevToolsActivePort', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Default/LOCK', 'Default\\LOCK', 'Default/DevToolsActivePort', 'Default\\DevToolsActivePort'].forEach(f => {
      const p = path.join(authSessionDir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    });
  }
} catch (e) {}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    executablePath: browserExecutable || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  }
});

// QR Code Event
client.on('qr', async (qr) => {
  authStatus = 'Silakan Scan QR Code';
  isBotReady = false;
  console.log('\n📱 SILAKAN SCAN QR CODE WHATSAPP:');
  qrcode.generate(qr, { small: true });

  try {
    latestQrDataUrl = await QRCode.toDataURL(qr, { width: 340, margin: 2 });
  } catch (e) {}
});

client.on('authenticated', () => {
  authStatus = '✅ Autentikasi Berhasil! Sesi tersimpan.';
  latestQrDataUrl = '';
  logSync('🎉 Autentikasi WhatsApp Berhasil!');
});

client.on('disconnected', (reason) => {
  logSync(`⚠️ WhatsApp terputus: ${reason}. Watchdog akan me-restart bot dalam 5 detik...`);
  isBotReady = false;
  authStatus = `Terputus: ${reason}`;
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

client.on('auth_failure', (msg) => {
  logSync(`❌ Autentikasi WhatsApp gagal: ${msg}. Me-restart bot...`);
  isBotReady = false;
  authStatus = `Gagal Autentikasi: ${msg}`;
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

process.on('uncaughtException', (err) => {
  logSync(`⚠️ Uncaught Exception: ${err.message}`);
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason ? (reason.message || String(reason)) : 'unknown';
  logSync(`⚠️ Unhandled Rejection: ${msg.substring(0, 100)}`);
});

// AI Multimodal Vision via 9Router (Gemini 3.7 Flash)
async function analyzeImageWithAiVision(base64Data) {
  if (!base64Data || base64Data.length < 50) return null;
  try {
    const prompt = `Anda adalah AI parser promo tiket pesawat dan kapal laut untuk Raksa Travel.
Analisa gambar poster tiket promo ini dan ekstrak data berikut dalam format JSON murni:
{
  "badge": "nama maskapai atau kapal (contoh: SRIWIJAYA AIR / CITILINK / LION AIR / PELNI / GARUDA / BATIK AIR)",
  "badgeType": "airline atau ship",
  "origin": "Kota Asal (contoh: Jayapura / Makassar / Jakarta / Surabaya)",
  "originCode": "Kode bandara asal 3 huruf (contoh: DJJ / UPG / CGK / SUB)",
  "destination": "Kota Tujuan (contoh: Makassar / Surabaya / Jakarta / Jayapura)",
  "destinationCode": "Kode bandara tujuan 3 huruf (contoh: UPG / SUB / CGK / DJJ)",
  "transit": "Penerbangan Langsung / Transit Makassar / Transit Surabaya / Pelayaran Laut",
  "price": "Nominal harga saja dengan titik pemisah ribuan (contoh: 1.960.000 / 2.090.000 / 3.490.000)",
  "date": "Tanggal atau periode keberangkatan yang tertera di poster (contoh: Tgl 1, 3, 5 September / Keberangkatan Terdekat)",
  "baggage": "Keterangan bagasi jika ada (contoh: Termasuk Bagasi 20 KG / Termasuk Bagasi 10 KG)"
}
HANYA KEMBALIKAN JSON VALID TANPA MARKDOWN ATAU PENJELASAN LAIN.`;

    const requestBody = JSON.stringify({
      model: "ag/gemini-3.7-flash-high",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Data}`
              }
            }
          ]
        }
      ]
    });

    const res = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-314fd95655a96de0-jnhrcd-d8fe965d"
      },
      body: requestBody
    });

    const textRes = await res.text();
    let content = "";
    
    if (textRes.includes("data:")) {
      const lines = textRes.split("\n");
      for (const line of lines) {
        if (line.startsWith("data:") && !line.includes("[DONE]")) {
          try {
            const parsed = JSON.parse(line.replace("data:", "").trim());
            const delta = parsed.choices?.[0]?.delta?.content || "";
            content += delta;
          } catch (e) {}
        }
      }
    } else {
      const jsonRes = JSON.parse(textRes);
      content = jsonRes.choices?.[0]?.message?.content || "";
    }

function formatRupiahPrice(val) {
  if (!val) return '1.960.000';
  let str = String(val).replace(/[^0-9]/g, '');
  if (!str) return '1.960.000';
  return str.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

    content = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(content);
    
    if (!data.origin || !data.destination || !data.price) return null;

    const formattedPrice = formatRupiahPrice(data.price);

    return {
      id: `promo-${Date.now()}`,
      badge: data.badge || "TIKET PROMO",
      badgeType: data.badgeType || "airline",
      airlineLogo: data.badgeType === "ship" ? "ship" : "plane",
      origin: data.origin || "Jayapura",
      originCode: data.originCode || "DJJ",
      destination: data.destination || "Makassar",
      destinationCode: data.destinationCode || "UPG",
      transit: data.transit || "Penerbangan Langsung",
      price: formattedPrice,
      date: data.date || "Keberangkatan Terdekat",
      baggage: data.baggage || "Termasuk Bagasi",
      waText: encodeURIComponent(`Halo RaksaTravel, saya mau ambil tiket promo ${data.badge || ''} ${data.origin || ''} - ${data.destination || ''} Rp ${formattedPrice} (${data.date || ''})`)
    };
  } catch (err) {
    return null;
  }
}

// Robust text/caption parser for airline & Pelni ship promos
function parsePromoText(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toUpperCase().replace(/\r/g, '\n');

  // 1. Negative filter: disregard natural disasters, volcanic ash, weather, and general non-ticket news
  const nonTicketKeywords = ['BMKG', 'GEMPA', 'VULKANIK', 'KRAKATAU', 'ERUPSI', 'BANJIR', 'CUACA', 'TSUNAMI', 'KLUSTER'];
  if (nonTicketKeywords.some(kw => clean.includes(kw))) {
    return null;
  }

  // 2. Must contain at least one airline, passenger ship, or ticketing keyword
  const ticketKeywords = ['SRIWIJAYA', 'LION', 'CITILINK', 'GARUDA', 'BATIK', 'PELNI', 'TIKET', 'FLIGHT', 'PROMO', 'BAGASI', 'TRANSIT', 'LANGSUNG', 'SURABAYA', 'JAYAPURA', 'MAKASSAR', 'JAKARTA', 'TIMIKA', 'BIAK', 'SORONG', 'MERAUKE', 'KAPAL', 'DOBONSOLO', 'SINABUNG', 'LABOBAR', 'CIREMAI', 'GUNUNG DEMPO', 'KM ', 'SUPER AIR JET', 'WINGS'];
  const hasTicketKeyword = ticketKeywords.some(kw => clean.includes(kw));

  if (!hasTicketKeyword) {
    return null;
  }

  // 3. Price match: ignore if immediately followed by non-currency measurement units
  const priceMatch = clean.match(/(?:RP\.?\s*)?(\d{1,3}[.,]\d{3}[.,]\d{3}|\d{1,3}[.,]\d{3})(?!\s*(?:KAKI|FT|FEET|METER|M\b|KM\b|ORANG|JIWA|WARGA|HEKTAR|TON))/i);
  if (!priceMatch) {
    return null;
  }

  // Check that numeric price is at least Rp 100.000 (air/ship fare sanity check)
  const numericPrice = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10);
  if (isNaN(numericPrice) || numericPrice < 100000) {
    return null;
  }

  let badge = 'TIKET PROMO';
  let badgeType = 'airline';
  let transit = 'Penerbangan Langsung';
  
  if (clean.includes('PELNI') || clean.includes('KAPAL') || clean.includes('DOBONSOLO') || clean.includes('SINABUNG') || clean.includes('LABOBAR') || clean.includes('CIREMAI') || clean.includes('GUNUNG DEMPO')) {
    badge = 'KAPAL PELNI';
    badgeType = 'ship';
    transit = 'Pelayaran Laut';
  } else if (clean.includes('SRIWIJAYA')) {
    badge = clean.includes('TRANSIT') ? 'SRIWIJAYA TRANSIT' : 'SRIWIJAYA AIR';
    if (clean.includes('TRANSIT')) transit = 'Transit Makassar';
  } else if (clean.includes('LION') && clean.includes('BATIK')) {
    badge = 'LION + BATIK';
  } else if (clean.includes('LION')) {
    badge = clean.includes('LANGSUNG') ? 'LION AIR LANGSUNG' : 'LION AIR';
  } else if (clean.includes('CITILINK')) {
    badge = 'CITILINK';
  } else if (clean.includes('GARUDA')) {
    badge = 'GARUDA INDONESIA';
  } else if (clean.includes('BATIK')) {
    badge = 'BATIK AIR';
  }

  const cities = [
    { name: 'Jayapura', code: 'DJJ', aliases: ['JAYAPURA', 'SENTANI', 'DJJ'] },
    { name: 'Makassar', code: 'UPG', aliases: ['MAKASSAR', 'UJUNG PANDANG', 'UPG'] },
    { name: 'Surabaya', code: 'SUB', aliases: ['SURABAYA', 'SUB', 'PERAK', 'TANJUNG PERAK'] },
    { name: 'Jakarta', code: 'CGK', aliases: ['JAKARTA', 'CGK', 'HLP', 'TANJUNG PRIOK'] },
    { name: 'Bali', code: 'DPS', aliases: ['BALI', 'DENPASAR', 'DPS'] },
    { name: 'Sorong', code: 'SOQ', aliases: ['SORONG', 'SOQ'] },
    { name: 'Wamena', code: 'WMX', aliases: ['WAMENA', 'WMX'] },
    { name: 'Timika', code: 'TIM', aliases: ['TIMIKA', 'TIM'] },
    { name: 'Biak', code: 'BIK', aliases: ['BIAK', 'BIK'] },
    { name: 'Merauke', code: 'MKQ', aliases: ['MERAUKE', 'MKQ'] },
    { name: 'Ambon', code: 'AMQ', aliases: ['AMBON', 'AMQ'] },
    { name: 'Manado', code: 'MDC', aliases: ['MANADO', 'BITUNG', 'MDC'] }
  ];

  let origin = 'Jayapura';
  let originCode = 'DJJ';
  let destination = 'Makassar';
  let destinationCode = 'UPG';

  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  let foundCities = [];

  for (const line of lines) {
    for (const c of cities) {
      for (const alias of c.aliases) {
        if (line.includes(alias) && !foundCities.some(fc => fc.code === c.code)) {
          foundCities.push(c);
        }
      }
    }
  }

  if (foundCities.length >= 2) {
    origin = foundCities[0].name;
    originCode = foundCities[0].code;
    destination = foundCities[1].name;
    destinationCode = foundCities[1].code;
  }

  let price = priceMatch ? priceMatch[0].replace(/,/g, '.') : '1.960.000';

  const dateMatch = clean.match(/(TGL\s*[0-9,\sA-Z]+|[0-9]{1,2}(?:\s*[-–]\s*[0-9]{1,2})?\s+(?:JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER))/i);
  let date = dateMatch ? dateMatch[0].trim() : 'Keberangkatan Terdekat';

  const baggageMatch = clean.match(/BAGASI\s*\d+\s*KG/i);
  let baggage = baggageMatch ? ('Termasuk ' + baggageMatch[0].trim()) : (badgeType === 'ship' ? 'Termasuk Bagasi Kapal' : 'Termasuk Bagasi 10 KG');

  return {
    id: `promo-${Date.now()}`,
    badge,
    badgeType,
    airlineLogo: badgeType === 'ship' ? 'ship' : 'plane',
    origin,
    originCode,
    destination,
    destinationCode,
    transit,
    price,
    date,
    baggage,
    waText: encodeURIComponent(`Halo RaksaTravel, saya mau pesan tiket promo ${badge} ${origin} - ${destination} Rp ${price} (${date})`)
  };
}

// GitHub API Committer function for promos.json
async function commitToGitHubApi(contentJsonString) {
  if (!GITHUB_TOKEN) return;

  try {
    const getFileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/promos.json`;
    const options = {
      headers: {
        'User-Agent': 'Raksa-WA-Bot',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(getFileUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let sha = '';
        try {
          const fileData = JSON.parse(data);
          sha = fileData.sha || '';
        } catch (e) {}

        const putData = JSON.stringify({
          message: 'auto: live promo update from WhatsApp Channel',
          content: Buffer.from(contentJsonString).toString('base64'),
          sha: sha || undefined
        });

        const req = https.request(getFileUrl, {
          method: 'PUT',
          headers: {
            ...options.headers,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(putData)
          }
        }, (putRes) => {
          if (putRes.statusCode === 200 || putRes.statusCode === 201) {
            logSync('🎉 [GITHUB API] Sukses deploy promos.json ke GitHub!');
          }
        });

        req.write(putData);
        req.end();
      });
    });
  } catch (err) {
    console.error('Error GitHub API:', err.message);
  }
}

// Upload poster image to GitHub repo + update promo-posters.json
async function uploadPosterToGitHub(base64ImageData, promoData) {
  const timestamp = Date.now();
  const fileRelPath = `images/promo-${timestamp}.jpeg`;
  const fileAbsPath = path.join(ROOT_DIR, fileRelPath);

  try {
    // Save image file locally
    const buffer = Buffer.from(base64ImageData, 'base64');
    fs.writeFileSync(fileAbsPath, buffer);
    logSync(`💾 Poster disimpan lokal: ${fileRelPath}`);
  } catch (e) {
    console.error('Gagal simpan gambar lokal:', e.message);
  }

  // Update promo-posters.json locally
  let posters = [];
  try {
    if (fs.existsSync(POSTERS_JSON_PATH)) {
      posters = JSON.parse(fs.readFileSync(POSTERS_JSON_PATH, 'utf-8'));
    }
  } catch (e) { posters = []; }

  const newPoster = {
    id: `poster-${timestamp}`,
    image: fileRelPath,
    badge: promoData.badge || 'TIKET PROMO',
    badgeType: promoData.badgeType || 'airline',
    title: `${promoData.badge} ${promoData.origin} - ${promoData.destination}`,
    desc: `Rp ${promoData.price} • ${promoData.date} • ${promoData.transit} • ${promoData.baggage}`,
    price: promoData.price || '',
    date: promoData.date || '',
    waText: promoData.waText || '',
    addedAt: new Date().toISOString()
  };

  posters = posters.filter(p => !(p.title === newPoster.title && p.price === newPoster.price && p.date === newPoster.date));
  posters.unshift(newPoster);
  posters = posters.slice(0, 6);

  const postersJson = JSON.stringify(posters, null, 2);
  try {
    fs.writeFileSync(POSTERS_JSON_PATH, postersJson, 'utf-8');
  } catch (e) {}

  // Push to GitHub API if token available
  if (GITHUB_TOKEN) {
    const ghHeaders = {
      'User-Agent': 'Raksa-WA-Bot',
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    try {
      // 1. Upload image to GitHub repo
      const imgUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileRelPath}`;
      const imgPutData = JSON.stringify({
        message: `auto: upload poster promo ${promoData.badge} ${promoData.origin}-${promoData.destination}`,
        content: base64ImageData
      });

      await new Promise((resolve) => {
        const req = https.request(imgUrl, {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(imgPutData) }
        }, (res) => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            logSync(`🖼️ [GITHUB API] Poster berhasil diunggah: ${fileRelPath}`);
          }
          resolve();
        });
        req.on('error', () => resolve());
        req.write(imgPutData);
        req.end();
      });

      // 2. Update promo-posters.json on GitHub
      const postersUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/promo-posters.json`;
      const existingSha = await new Promise((resolve) => {
        https.get(postersUrl, { headers: ghHeaders }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data).sha || ''); } catch (e) { resolve(''); }
          });
        }).on('error', () => resolve(''));
      });

      const postersPutData = JSON.stringify({
        message: 'auto: update promo-posters.json dari WhatsApp Channel',
        content: Buffer.from(postersJson).toString('base64'),
        sha: existingSha || undefined
      });

      await new Promise((resolve) => {
        const req = https.request(postersUrl, {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postersPutData) }
        }, (res) => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            logSync('🎉 [GITHUB API] promo-posters.json berhasil diupdate!');
          }
          resolve();
        });
        req.on('error', () => resolve());
        req.write(postersPutData);
        req.end();
      });

    } catch (err) {
      console.error('Error upload poster GitHub API:', err.message);
    }
  }
}

let gitPushQueue = Promise.resolve();

function executeGitPush() {
  gitPushQueue = gitPushQueue.then(() => {
    return new Promise((resolve) => {
      const lockPath = path.join(ROOT_DIR, '.git', 'index.lock');
      if (fs.existsSync(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch (e) {}
      }
      logSync('🔄 Mengirim pembaruan langsung ke GitHub raksatravel.github.io...');
      exec('git add promos.json promo-posters.json index.html cek-tiket.html images/ && git commit -m "auto: live promo & poster update from WhatsApp Channel" && git push origin main', { cwd: ROOT_DIR }, (err, stdout) => {
        if (err) {
          if (!err.message.includes('nothing to commit')) {
            logSync(`ℹ️ Git CLI: ${err.message.substring(0, 120)}`);
          }
        } else {
          logSync('🚀 [GIT CLI PUSH SUKSES] Website raksatravel.github.io sudah ter-update secara online!');
        }
        resolve();
      });
    });
  }).catch(() => {});
  return gitPushQueue;
}

// Save promo & trigger Git CLI push
async function updatePromos(newPromo, imageBase64) {
  try {
    let promos = [];
    if (fs.existsSync(PROMOS_JSON_PATH)) {
      try {
        promos = JSON.parse(fs.readFileSync(PROMOS_JSON_PATH, 'utf-8'));
      } catch (e) {
        promos = [];
      }
    }

    const isDuplicate = promos.some(p => p.origin === newPromo.origin && p.destination === newPromo.destination && p.price === newPromo.price && p.date === newPromo.date);
    if (isDuplicate) {
      logSync(`ℹ️ Promo ${newPromo.origin} -> ${newPromo.destination} (Rp ${newPromo.price}) sudah ada di daftar.`);
      return;
    }

    promos.unshift(newPromo);
    promos = promos.slice(0, 6);
    const jsonStr = JSON.stringify(promos, null, 2);

    try {
      fs.writeFileSync(PROMOS_JSON_PATH, jsonStr, 'utf-8');
    } catch (e) {}

    logSync(`✅ [PROMO BARU TERVERIFIKASI]: ${newPromo.origin} -> ${newPromo.destination} (${newPromo.badge}) | Rp ${newPromo.price} | ${newPromo.date}`);

    // 1. Save poster image & update gallery locally & on GitHub API if image exists
    if (imageBase64) {
      await uploadPosterToGitHub(imageBase64, newPromo);
    }

    // 2. Git CLI Auto Push (now both promos.json, promo-posters.json, and images/ are ready on disk)
    await executeGitPush();

    // 4. Cloud Git API backup commit for promos.json
    await commitToGitHubApi(jsonStr);

  } catch (err) {
    console.error('Error updatePromos:', err.message);
  }
}

// Active Channel Scanner Function
const processedMsgIds = new Set();

async function scanChannelPromos() {
  if (!isBotReady || !client.pupPage || client.pupPage.isClosed()) return;

  try {
    const page = client.pupPage;

    const rawData = await page.evaluate(async (channelId) => {
      const collections = window.require('WAWebCollections');
      let newsletter = null;
      
      if (collections && collections.WAWebNewsletterCollection) {
        newsletter = collections.WAWebNewsletterCollection.get(channelId);
        if (!newsletter) {
          const allNewsletters = collections.WAWebNewsletterCollection.getModelsArray ? collections.WAWebNewsletterCollection.getModelsArray() : [];
          newsletter = allNewsletters.find(n => (n.name && n.name.toLowerCase().includes('raksa')) || (n.formattedTitle && n.formattedTitle.toLowerCase().includes('raksa')));
        }
      }

      if (!newsletter) return { notFound: true };

      // Load earlier msgs
      try {
        const loader = window.require('WAWebChatLoadMessages');
        if (loader && loader.loadEarlierMsgs) {
          await loader.loadEarlierMsgs({ chat: newsletter });
        }
      } catch (e) {}

      const mArray = newsletter.msgs ? (newsletter.msgs.getModelsArray ? newsletter.msgs.getModelsArray() : newsletter.msgs.models || []) : [];
      const recent = mArray.slice(-12);

      const messages = [];
      for (const m of recent) {
        let imageBase64 = null;
        if (m.type === 'image') {
          try {
            if (m.mediaData && m.mediaData.mediaStage !== 'RESOLVED') {
              if (typeof m.downloadMedia === 'function') {
                await m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
              }
            }

            const mockQpl = { addAnnotations: function() { return this; }, addPoint: function() { return this; } };
            const dm = window.require('WAWebDownloadManager');
            if (dm && dm.downloadManager) {
              const decrypted = await dm.downloadManager.downloadAndMaybeDecrypt({
                directPath: m.directPath,
                encFilehash: m.encFilehash,
                filehash: m.filehash,
                mediaKey: m.mediaKey,
                mediaKeyTimestamp: m.mediaKeyTimestamp,
                type: m.type,
                signal: new AbortController().signal,
                downloadQpl: mockQpl
              });
              imageBase64 = await window.WWebJS.arrayBufferToBase64Async(decrypted);
            }
          } catch (e) {}
        }

        const msgIdStr = m.id ? (m.id._serialized || (typeof m.id === 'object' ? m.id.id : m.id)) : String(m.t || Date.now());

        messages.push({
          id: msgIdStr,
          type: m.type,
          caption: m.caption || '',
          body: m.body || '',
          imageBase64,
          t: m.t
        });
      }

      return {
        channelName: newsletter.name || newsletter.formattedTitle,
        messages
      };
    }, RAKSA_CHANNEL_ID);

    if (rawData.notFound || !Array.isArray(rawData.messages)) return;

    lastSyncTime = new Date().toLocaleTimeString('id-ID');

    for (const msg of rawData.messages) {
      if (!msg.id || processedMsgIds.has(msg.id)) continue;
      processedMsgIds.add(msg.id);

      logSync(`📬 [SALURAN WA]: Postingan baru (Tipe: ${msg.type}) ID: ${msg.id}...`);

      let promoData = null;
      let finalImageBase64 = msg.imageBase64 || null;

      // 1. If message has caption
      if (msg.caption && msg.caption.length > 5) {
        promoData = parsePromoText(msg.caption);
      }

      // 2. If chat message
      if (!promoData && msg.type === 'chat' && msg.body && msg.body.length > 5) {
        promoData = parsePromoText(msg.body);
      }

      // 3. If image message with downloaded high-res base64
      if (msg.type === 'image' && finalImageBase64) {
        if (!promoData) {
          logSync('🤖 Menganalisa poster saluran via Multimodal AI Vision...');
          promoData = await analyzeImageWithAiVision(finalImageBase64);
        }

        if (!promoData) {
          logSync('ℹ️ Menjalankan Tesseract OCR Engine pada gambar poster saluran...');
          try {
            const buffer = Buffer.from(finalImageBase64, 'base64');
            const { data: { text } } = await Tesseract.recognize(buffer, 'ind+eng');
            logSync(`📄 Hasil OCR poster: ${text ? text.substring(0, 80).replace(/\n/g, ' ') : 'kosong'}`);
            promoData = parsePromoText(text);
          } catch (ocrErr) {
            console.error('OCR Error:', ocrErr.message);
          }
        }
      }

      if (promoData) {
        logSync(`✅ [PROMO SALURAN TERVERIFIKASI]: ${promoData.badge} | ${promoData.origin} -> ${promoData.destination} (Rp ${promoData.price})`);
        await updatePromos(promoData, finalImageBase64);
      } else {
        logSync('ℹ️ Postingan terdeteksi namun bukan promo tiket perjalanan.');
      }
    }

  } catch (err) {
    if (err.message && !err.message.includes('detached')) {
      console.error('Scan channel error:', err.message);
    }
  }
}

client.on('ready', async () => {
  isBotReady = true;
  authStatus = '🚀 BOT ONLINE & MEMANTAU SALURAN WHATSAPP';
  logSync('🚀 BOT RAKSA TRAVEL AKTIF & SIAP MEMANTAU SALURAN WHATSAPP REALTIME!');

  // Initial Scan
  setTimeout(scanChannelPromos, 3000);

  // Periodic active scan every 6 seconds
  setInterval(scanChannelPromos, 6000);
});

// Incoming message listener for direct chats / group messages / forwarded stories
client.on('message_create', async (msg) => {
  try {
    if (!msg) return;

    if (msg.hasMedia) {
      logSync(`📥 [MEDIA DITERIMA]: dari ${msg.from || 'unknown'} (tipe: ${msg.type})...`);
      try {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          logSync('🤖 Menganalisa gambar poster via Multimodal AI Vision...');
          let promoData = await analyzeImageWithAiVision(media.data);
          if (!promoData) {
            logSync('ℹ️ Mencoba Tesseract OCR Engine...');
            const buffer = Buffer.from(media.data, 'base64');
            const { data: { text } } = await Tesseract.recognize(buffer, 'ind+eng');
            logSync(`📄 Hasil OCR: ${text ? text.substring(0, 80).replace(/\n/g, ' ') : 'kosong'}`);
            promoData = parsePromoText(text);
          }

          if (promoData) {
            logSync(`✅ [PROMO MEDIA DITERIMA]: ${promoData.badge} | ${promoData.origin} -> ${promoData.destination}`);
            await updatePromos(promoData, media.data);
          } else {
            logSync('ℹ️ Media diterima bukan poster promo tiket.');
          }
        } else {
          logSync('⚠️ Media kosong / tidak dapat diunduh');
        }
      } catch (e) {
        logSync(`❌ Error download/analisa media: ${e.message}`);
      }
    }

    const bodyText = (msg.body || '').trim();
    if (bodyText.length > 5 && !msg.hasMedia) {
      const promoData = parsePromoText(bodyText);
      if (promoData) {
        logSync(`📩 [TEKS PROMO DITERIMA]: ${bodyText.substring(0, 60)}...`);
        await updatePromos(promoData, null);
      }
    }
  } catch (e) {
    logSync(`❌ Error message_create: ${e.message}`);
  }
});

// Express Web Dashboard & API
app.get('/api/status', (req, res) => {
  res.json({
    isBotReady,
    authStatus,
    lastSyncTime,
    logs: syncLogHistory.slice(0, 15)
  });
});

app.get('/api/sync-channel', async (req, res) => {
  try {
    if (!isBotReady) {
      return res.json({ success: false, message: 'Bot WhatsApp belum siap / belum login' });
    }
    logSync('🔄 [MANUAL TRIGGER] Memulai pemindaian instan Saluran WhatsApp...');
    await scanChannelPromos();
    res.json({ success: true, message: 'Sinkronisasi berhasil dijalankan!', lastSyncTime });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/diagnose', async (req, res) => {
  try {
    if (!isBotReady || !client.pupPage) {
      return res.json({ isBotReady, message: 'Bot not ready or no pupPage' });
    }

    const diag = await client.pupPage.evaluate(async (channelId) => {
      const collections = window.require('WAWebCollections');
      const allNewsletters = collections && collections.WAWebNewsletterCollection && collections.WAWebNewsletterCollection.getModelsArray ? 
        collections.WAWebNewsletterCollection.getModelsArray().map(n => ({
          id: n.id ? (n.id._serialized || n.id) : '',
          name: n.name || n.formattedTitle,
          msgsCount: n.msgs ? (n.msgs.length || (n.msgs.models ? n.msgs.models.length : 0)) : 0
        })) : [];

      let targetNewsletter = collections && collections.WAWebNewsletterCollection ? collections.WAWebNewsletterCollection.get(channelId) : null;
      if (!targetNewsletter && allNewsletters.length > 0) {
        targetNewsletter = collections.WAWebNewsletterCollection.get(allNewsletters[0].id);
      }

      let msgsInfo = [];
      let testDownload = null;
      if (targetNewsletter && targetNewsletter.msgs) {
        const mArray = targetNewsletter.msgs.getModelsArray ? targetNewsletter.msgs.getModelsArray() : (targetNewsletter.msgs.models || []);
        const lastMsg = mArray[mArray.length - 1];

        // Test downloading full media from lastMsg
        if (lastMsg) {
          try {
            if (lastMsg.mediaData && lastMsg.mediaData.mediaStage !== 'RESOLVED') {
              if (typeof lastMsg.downloadMedia === 'function') {
                await lastMsg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
              }
            }

            const mockQpl = { addAnnotations: function() { return this; }, addPoint: function() { return this; } };
            const dm = window.require('WAWebDownloadManager');
            if (dm && dm.downloadManager) {
              const decrypted = await dm.downloadManager.downloadAndMaybeDecrypt({
                directPath: lastMsg.directPath,
                encFilehash: lastMsg.encFilehash,
                filehash: lastMsg.filehash,
                mediaKey: lastMsg.mediaKey,
                mediaKeyTimestamp: lastMsg.mediaKeyTimestamp,
                type: lastMsg.type,
                signal: new AbortController().signal,
                downloadQpl: mockQpl
              });
              const b64 = await window.WWebJS.arrayBufferToBase64Async(decrypted);
              testDownload = {
                success: true,
                b64Len: b64.length,
                preview: b64.substring(0, 30)
              };
            }
          } catch (e) {
            testDownload = { error: e.message, stack: e.stack };
          }
        }

        msgsInfo = mArray.slice(-5).map(m => ({
          id: m.id ? (m.id._serialized || (typeof m.id === 'object' ? m.id.id : m.id)) : '',
          type: m.type,
          caption: m.caption,
          mediaStage: m.mediaData ? m.mediaData.mediaStage : null,
          hasDirectPath: m.mediaData ? !!m.mediaData.directPath : false,
          t: m.t
        }));
      }

      return {
        allNewsletters,
        targetNewsletter: targetNewsletter ? { id: targetNewsletter.id ? (targetNewsletter.id._serialized || targetNewsletter.id) : '', name: targetNewsletter.name } : null,
        testDownload,
        msgsInfo
      };
    }, RAKSA_CHANNEL_ID);

    res.json(diag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Raksa Travel Live Bot Dashboard</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #060b14; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .card { background: #0c1626; border: 1px solid rgba(37, 211, 102, 0.3); border-radius: 20px; padding: 32px; max-width: 540px; width: 100%; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); }
        .header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
        .header i { font-size: 2.2rem; color: #25D366; }
        .header h1 { font-size: 1.4rem; font-weight: 700; color: #ffffff; }
        .badge { background: rgba(37, 211, 102, 0.15); border: 1px solid #25D366; color: #25D366; padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; margin-bottom: 20px; }
        .status-box { background: #132238; border-radius: 12px; padding: 16px; margin-bottom: 20px; font-size: 0.9rem; }
        .status-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .status-row:last-child { border-bottom: none; }
        .status-row span:first-child { color: #94a3b8; }
        .btn-sync { background: #25D366; color: #000; border: none; padding: 12px 24px; border-radius: 10px; font-weight: 700; font-size: 0.95rem; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: transform 0.2s, background 0.2s; }
        .btn-sync:hover { background: #20ba5a; transform: translateY(-2px); }
        .logs-container { margin-top: 20px; background: #060b14; border-radius: 10px; padding: 12px; max-height: 180px; overflow-y: auto; font-family: monospace; font-size: 0.78rem; color: #94a3b8; line-height: 1.6; }
        .log-item { margin-bottom: 4px; }
        .qr-box { text-align: center; margin: 20px 0; }
        .qr-box img { max-width: 260px; border-radius: 12px; border: 4px solid #25D366; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <i class="fab fa-whatsapp"></i>
          <div>
            <h1>Raksa Travel Live Bot</h1>
            <p style="color: #94a3b8; font-size: 0.85rem;">Pemantau Saluran WhatsApp &amp; Auto-Push Website</p>
          </div>
        </div>

        <div class="badge">
          <i class="fas fa-circle" style="font-size: 0.6rem; animation: pulse 1.5s infinite;"></i>
          ${isBotReady ? 'ONLINE &amp; AUTO-SYNC SALURAN AKTIF' : authStatus}
        </div>

        ${latestQrDataUrl ? `
          <div class="qr-box">
            <p style="margin-bottom: 12px; color: #25D366; font-weight: bold;">Silakan Scan QR Code dengan WhatsApp Anda:</p>
            <img src="${latestQrDataUrl}" alt="Scan QR">
          </div>
        ` : ''}

        <div class="status-box">
          <div class="status-row">
            <span>Status Sistem:</span>
            <strong style="color: ${isBotReady ? '#25D366' : '#f59e0b'};">${authStatus}</strong>
          </div>
          <div class="status-row">
            <span>Saluran Terhubung:</span>
            <strong>RAKSA TRAVEL (ID: 120363413097453454)</strong>
          </div>
          <div class="status-row">
            <span>Sinkronisasi Terakhir:</span>
            <strong>${lastSyncTime}</strong>
          </div>
          <div class="status-row">
            <span>Target Auto-Push:</span>
            <strong>raksatravel.github.io</strong>
          </div>
        </div>

        <button class="btn-sync" onclick="syncNow()">
          <i class="fas fa-arrows-rotate"></i> Sinkronkan Saluran Sekarang
        </button>

        <div class="logs-container" id="logs">
          ${syncLogHistory.map(l => `<div class="log-item">${l}</div>`).join('')}
        </div>
      </div>

      <script>
        function syncNow() {
          fetch('/api/sync-channel')
            .then(r => r.json())
            .then(d => {
              alert(d.message || 'Sinkronisasi berhasil dipicu!');
              location.reload();
            })
            .catch(e => alert('Gagal sinkronisasi: ' + e.message));
        }
        setInterval(() => {
          fetch('/api/status')
            .then(r => r.json())
            .then(d => {
              const logs = document.getElementById('logs');
              if (logs && d.logs) {
                logs.innerHTML = d.logs.map(l => '<div class="log-item">' + l + '</div>').join('');
              }
            });
        }, 5000);
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  logSync(`🌐 Server Bot & Dashboard berjalan di http://localhost:${PORT}`);
});

console.log('⏳ Menginisialisasi WhatsApp Web Client...');
client.initialize();
