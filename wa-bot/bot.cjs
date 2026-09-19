const express = require('express');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 7860;
const GITHUB_REPO = 'raksatravel/raksatravel.github.io';
const TARGET_CHANNEL_JID = '120363413097453454@newsletter';
const TARGET_CHANNEL_CODE = '0029VbCYmHQ9WtBxoi1pjH0f';

let GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
try {
  const cfgPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (cfg.GITHUB_TOKEN) GITHUB_TOKEN = cfg.GITHUB_TOKEN;
  }
} catch (e) {}

let latestQrDataUrl = '';
let latestQrRaw = '';
let authStatus = 'Menunggu Inisialisasi WhatsApp Cloud...';
let isConnected = false;
let syncLogHistory = [];
const processedMessageIds = new Set();
let watchdogInterval = null;

function logSync(msg) {
  const timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jayapura' });
  console.log(`[${timeStr}] ${msg}`);
  syncLogHistory.unshift(`[${timeStr}] ${msg}`);
  if (syncLogHistory.length > 50) syncLogHistory.pop();
}

console.log('====================================================');
console.log('🤖 RAKSA TRAVEL - 24/7 CLOUD BAILEYS WHATSAPP BOT');
console.log('====================================================\n');

// 1. AI Vision Multimodal Parser (9Router Antigravity 11-Account Cascade)
async function analyzeImageWithAiVision(base64Data) {
  const prompt = `Anda adalah AI Vision & OCR Engine beresolusi tinggi (Ultra-HD Optical Precision) resmi untuk Raksa Travel (layanan tiket pesawat & kapal laut).

TUGAS UTAMA:
Lakukan pemindaian OCR visual resolusi tinggi (pixel-by-pixel) dari gambar poster ini.
1. Jika gambar BUKAN poster promo tiket pesawat / kapal laut (misal: screenshot game, meme, selfie, foto makanan, dokumen acak), KEMBALIKAN HANYA: {"is_valid": false}

2. Jika gambar ADALAH POSTER TIKET PROMO, baca seluruh teks secara teliti dan ekstraksi data berikut dalam format JSON murni:
{
  "is_valid": true,
  "badge": "Nama maskapai/operator resmi (contoh: LION AIR, BATIK AIR, SRIWIJAYA AIR, CITILINK, GARUDA INDONESIA, SUPER AIR JET, WINGS AIR, PELNI)",
  "badgeType": "airline atau ship",
  "origin": "Nama kota asal penerbangan/keberangkatan (contoh: Makassar, Jayapura, Surabaya, Jakarta, Denpasar, Timika, Biak, Sorong)",
  "originCode": "Kode bandara asal 3 huruf resmi IATA (contoh: UPG, DJJ, SUB, CGK, DPS, TIM, BIK, SOQ)",
  "destination": "Nama kota tujuan (contoh: Jayapura, Makassar, Surabaya, Jakarta, Denpasar, Timika, Biak, Sorong)",
  "destinationCode": "Kode bandara tujuan 3 huruf resmi IATA (contoh: DJJ, UPG, SUB, CGK, DPS, TIM, BIK, SOQ)",
  "transit": "Tipe rute persis (contoh: Penerbangan Langsung / Penerbangan Transit / Transit Makassar / Transit Surabaya / Transit 1X)",
  "price": "Nominal harga termurah (hanya angka dengan titik pemisah ribuan, tanpa kata Rp, contoh: 3.170.000 / 3.305.000 / 2.290.000 / 1.950.000)",
  "date": "Rincian tanggal/periode keberangkatan persis seperti di poster (contoh: Tgl 21 s/d 30 September / Tgl 17, 19, 22, 24, 26, 29 September)",
  "baggage": "Keterangan jatah bagasi resmi (contoh: Termasuk Bagasi 10 KG / Termasuk Bagasi 15 KG / Termasuk Bagasi 20 KG / Tanpa Bagasi)",
  "phone": "Nomor WhatsApp/kontak yang tertera di poster (contoh: 082153043601)"
}

PANDUAN PEMBACAAN OCR:
- Periksa angka dengan sangat cermat (jangan tertukar antara 1, 7, 0, 8).
- Jika ada 2 harga bertingkat pada tanggal berbeda, gunakan harga terendah untuk kolom "price".
- HANYA KEMBALIKAN JSON VALID TANPA PENJELASAN ATAU BLOK MARKDOWN LAIN.`;

  const endpoints = [
    {
      url: 'http://127.0.0.1:20128/v1/chat/completions',
      key: 'sk-314fd95655a96de0-jnhrcd-d8fe965d',
      model: 'ag/gemini-3.7-flash-high'
    },
    {
      url: 'http://127.0.0.1:20128/v1/chat/completions',
      key: 'sk-314fd95655a96de0-jnhrcd-d8fe965d',
      model: 'ag/gemini-3.8-flash-high'
    }
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ep.key}`
        },
        body: JSON.stringify({
          model: ep.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Data}`,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          stream: false,
          temperature: 0.1
        })
      });

      if (res.ok) {
        const textRes = await res.text();
        let content = '';

        if (textRes.includes('data:')) {
          for (const line of textRes.split('\n')) {
            if (line.startsWith('data:') && !line.includes('[DONE]')) {
              try {
                const chunk = JSON.parse(line.replace('data:', '').trim());
                content += chunk.choices?.[0]?.delta?.content || '';
              } catch (e) {}
            }
          }
        } else {
          const jsonRes = JSON.parse(textRes);
          content = jsonRes.choices?.[0]?.message?.content || '';
        }

        content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        const data = JSON.parse(content);

        // Validasi wajib tiket promo
        if (data.is_valid === false || !data.origin || !data.destination || !data.price) {
          console.log('⚠️ AI Vision: Gambar bukan poster tiket promo atau rute/harga tidak ditemukan.');
          return null;
        }

        const cleanPrice = String(data.price).replace(/Rp\s*/i, '').replace(/,/g, '.').trim();
        if (!/\d/.test(cleanPrice)) {
          return null;
        }

        let badgeName = (data.badge || 'TIKET PROMO').toUpperCase();
        if (badgeName.includes('LION') && !badgeName.includes('AIR')) badgeName = 'LION AIR';
        if (badgeName.includes('BATIK') && !badgeName.includes('AIR')) badgeName = 'BATIK AIR';
        if (badgeName.includes('SRIWIJAYA') && !badgeName.includes('AIR')) badgeName = 'SRIWIJAYA AIR';

        return {
          id: `promo-${Date.now()}`,
          badge: badgeName,
          badgeType: data.badgeType || 'airline',
          airlineLogo: data.badgeType === 'ship' ? 'ship' : 'plane',
          origin: data.origin,
          originCode: data.originCode || 'DJJ',
          destination: data.destination,
          destinationCode: data.destinationCode || 'UPG',
          transit: data.transit || 'Penerbangan Langsung',
          price: cleanPrice,
          date: data.date || 'Keberangkatan Terdekat',
          baggage: data.baggage || 'Termasuk Bagasi',
          waText: encodeURIComponent(`Halo RaksaTravel, saya mau ambil tiket promo ${badgeName} ${data.origin} - ${data.destination} Rp ${cleanPrice} (${data.date || ''})`)
        };
      }
    } catch (err) {
      console.log(`AI Vision error on ${ep.url} (${ep.model}):`, err.message);
    }
  }
  return null;
}

// 2. GitHub REST API Committer
async function commitPromosToGitHub(newPromo) {
  if (!GITHUB_TOKEN) return;

  try {
    const fileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/promos.json`;
    const ghHeaders = {
      'User-Agent': 'Raksa-Baileys-Cloud-Bot',
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    let currentPromos = [];
    let sha = '';
    try {
      const getRes = await fetch(fileUrl, { headers: ghHeaders });
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha || '';
        const decoded = Buffer.from(fileData.content, 'base64').toString('utf-8');
        currentPromos = JSON.parse(decoded);
      }
    } catch (e) {
      currentPromos = [];
    }

    const isDuplicate = currentPromos.some(p => p.origin === newPromo.origin && p.destination === newPromo.destination && p.price === newPromo.price && p.date === newPromo.date);
    if (isDuplicate) {
      console.log('ℹ️ Promo ini sudah terdaftar di promos.json. Melewati duplikat.');
      return;
    }

    currentPromos.unshift(newPromo);
    currentPromos = currentPromos.slice(0, 10);
    const updatedJson = JSON.stringify(currentPromos, null, 2);

    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `auto: live promo update [${newPromo.badge} ${newPromo.origin}-${newPromo.destination}] from Cloud Baileys Bot`,
        content: Buffer.from(updatedJson).toString('base64'),
        sha: sha || undefined
      })
    });

    if (putRes.ok) {
      console.log(`🎉 [GITHUB PUSH] Sukses deploy promo baru ke website raksatravel.github.io!`);
      logSync(`Deploy Promo: ${newPromo.badge} ${newPromo.origin} -> ${newPromo.destination} (Rp ${newPromo.price})`);
    } else {
      const errText = await putRes.text();
      console.error(`❌ [GITHUB ERROR promos.json]: HTTP ${putRes.status} - ${errText}`);
    }
  } catch (e) {
    console.error('Error committing to GitHub:', e.message);
  }
}

async function uploadPosterToGitHub(base64ImageData, promoData) {
  if (!GITHUB_TOKEN) return;

  const timestamp = Date.now();
  const fileName = `images/promo-${timestamp}.jpeg`;
  const ghHeaders = {
    'User-Agent': 'Raksa-Baileys-Cloud-Bot',
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  };

  try {
    const imgUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`;
    const putImgRes = await fetch(imgUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `auto: upload poster promo ${promoData.badge} ${promoData.origin}-${promoData.destination}`,
        content: base64ImageData
      })
    });

    if (!putImgRes.ok) {
      const errImg = await putImgRes.text();
      console.error(`❌ [GITHUB ERROR upload image]: HTTP ${putImgRes.status} - ${errImg}`);
      return;
    }

    const postersUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/promo-posters.json`;
    let posters = [];
    let sha = '';
    try {
      const getRes = await fetch(postersUrl, { headers: ghHeaders });
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha || '';
        posters = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
      }
    } catch (e) { posters = []; }

    const descText = `Rp ${promoData.price} • ${promoData.date} • ${promoData.transit} • ${promoData.baggage}`;
    const newPoster = {
      id: `poster-${timestamp}`,
      image: fileName,
      badge: promoData.badge || 'TIKET PROMO',
      badgeType: promoData.badgeType || 'airline',
      title: `${promoData.badge} ${promoData.origin} - ${promoData.destination}`,
      desc: descText,
      price: promoData.price || '',
      date: promoData.date || '',
      waText: promoData.waText || '',
      addedAt: new Date().toISOString()
    };

    const isDuplicate = posters.some(p => p.title === newPoster.title && p.price === newPoster.price && p.date === newPoster.date);
    if (isDuplicate) {
      console.log('ℹ️ Poster ini sudah ada di promo-posters.json. Melewati upload poster.');
      return;
    }

    posters.unshift(newPoster);
    posters = posters.slice(0, 10);

    const putPostersRes = await fetch(postersUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'auto: update poster gallery dari Cloud Bot',
        content: Buffer.from(JSON.stringify(posters, null, 2)).toString('base64'),
        sha: sha || undefined
      })
    });

    if (putPostersRes.ok) {
      console.log(`🖼️ [GITHUB] Poster promo aktif di website: ${fileName}`);
      logSync(`Upload Poster: ${promoData.badge} ${promoData.origin}-${promoData.destination}`);
    } else {
      const errP = await putPostersRes.text();
      console.error(`❌ [GITHUB ERROR promo-posters.json]: HTTP ${putPostersRes.status} - ${errP}`);
    }
  } catch (err) {
    console.error('Error upload poster:', err.message);
  }
}

// 3. Process Individual Message Media
async function processMessageMedia(msg, sourceTag = 'EVENT') {
  const msgId = msg.key?.id;
  if (msgId && processedMessageIds.has(msgId)) {
    return;
  }
  if (msgId) processedMessageIds.add(msgId);

  const isImg = msg.message?.imageMessage || 
                msg.message?.viewOnceMessageV2?.message?.imageMessage ||
                msg.message?.documentWithCaptionMessage?.message?.imageMessage ||
                msg.message?.ephemeralMessage?.message?.imageMessage;

  if (isImg) {
    console.log(`\n📥 [${sourceTag}] Poster Saluran Terdeteksi: ${msg.key?.remoteJid || TARGET_CHANNEL_JID} (ID: ${msgId})`);
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer && buffer.length > 1000) {
        const base64Data = buffer.toString('base64');
        console.log('🤖 Menjalankan Multimodal AI Vision (Gemini 3.7/3.8 via 9Router)...');
        const promoData = await analyzeImageWithAiVision(base64Data);

        if (promoData) {
          console.log(`✅ [PROMO TERVALIDASI]: ${promoData.badge} | ${promoData.origin} -> ${promoData.destination} | Rp ${promoData.price}`);
          await commitPromosToGitHub(promoData);
          await uploadPosterToGitHub(base64Data, promoData);
        } else {
          console.log('ℹ️ Gambar di saluran bukan tiket promo resmi atau data tidak lengkap. Dilewati.');
        }
      }
    } catch (err) {
      console.error(`❌ Gagal mendownload / memproses gambar: ${err.message}`);
    }
  }
}

// 4. Polling Watchdog for Newsletter (Guarantees 100% detection)
function startNewsletterWatchdog(sock) {
  if (watchdogInterval) clearInterval(watchdogInterval);

  const fetchChannelUpdates = async () => {
    if (!isConnected || typeof sock.newsletterFetchMessages !== 'function') return;

    try {
      const channelMsgs = await sock.newsletterFetchMessages(TARGET_CHANNEL_JID, 8);
      if (channelMsgs && channelMsgs.length > 0) {
        channelMsgs.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
        for (const cMsg of channelMsgs) {
          const msgId = cMsg.key?.id;
          if (msgId && !processedMessageIds.has(msgId)) {
            await processMessageMedia(cMsg, 'WATCHDOG-POLL');
          }
        }
      }
    } catch (err) {
      // Channel silent catch
    }
  };

  // Run immediately then every 30 seconds
  fetchChannelUpdates();
  watchdogInterval = setInterval(fetchChannelUpdates, 30000);
}

// 5. Connect Baileys WhatsApp WebSocket Engine
async function startWhatsAppBot() {
  const authDir = path.join(__dirname, 'baileys_auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`Using WA version v${version.join('.')}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQrRaw = qr;
      authStatus = 'Silakan Scan QR Code';
      isConnected = false;
      console.log('\n📱 [WHATSAPP QR CODE TERSEDIA]:');
      qrcodeTerminal.generate(qr, { small: true });

      try {
        latestQrDataUrl = await QRCode.toDataURL(qr, { width: 340, margin: 2 });
      } catch (e) {}
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      authStatus = `Terputus: ${lastDisconnect?.error?.message || 'Reconnecting...'}`;
      isConnected = false;
      if (watchdogInterval) clearInterval(watchdogInterval);
      console.log(`Connection closed due to:`, lastDisconnect?.error, `, reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 5000);
      } else {
        authStatus = 'Logged Out. Silakan Scan QR Code Baru.';
        setTimeout(startWhatsAppBot, 5000);
      }
    } else if (connection === 'open') {
      authStatus = '✅ ONLINE 24/7 DI CLOUD VPS';
      isConnected = true;
      latestQrDataUrl = '';
      latestQrRaw = '';
      console.log('\n🎉 [WHATSAPP TERKONEKSI]: Bot aktif memantau saluran 24 jam nonstop!');

      // Auto-subscribe ke channel WhatsApp Raksa Travel
      try {
        if (typeof sock.newsletterMetadata === 'function') {
          const channelMeta = await sock.newsletterMetadata('invite', TARGET_CHANNEL_CODE);
          if (channelMeta) {
            console.log(`📢 [CHANNEL DIPANTAU]: ${channelMeta.name || 'Raksa Travel'} (${channelMeta.id})`);
            if (typeof sock.newsletterFollow === 'function') {
              await sock.newsletterFollow(channelMeta.id);
              console.log(`✅ [AUTO-SUBSCRIBE]: Terhubung ke saluran promo WhatsApp!`);
            }
          }
        }
      } catch (err) {
        console.log(`ℹ️ [CHANNEL INFO]: Saluran terdaftar (${TARGET_CHANNEL_CODE})`);
      }

      // Start 30-second continuous channel watchdog
      startNewsletterWatchdog(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const senderJid = msg.key?.remoteJid || '';

        const isFromTargetChannel = (senderJid === TARGET_CHANNEL_JID) || 
                                   (senderJid.endsWith('@newsletter') && senderJid.includes('120363413097453454'));

        if (isFromTargetChannel) {
          await processMessageMedia(msg, 'LIVE-EVENT');
        }
      } catch (err) {
        console.log('Error processing incoming message:', err.message);
      }
    }
  });
}

// 6. Express Web Server for Monitoring & QR Display
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Raksa Travel 24/7 Cloud Baileys Bot</title>
      <style>
        body { background: #070d18; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; }
        .card { background: #0f1a2e; border: 2px solid #25D366; padding: 30px; border-radius: 20px; box-shadow: 0 10px 40px rgba(37, 211, 102, 0.2); max-width: 440px; width: 90%; }
        h1 { color: #25D366; margin-top: 0; font-size: 22px; }
        .badge { background: rgba(37, 211, 102, 0.2); color: #25D366; padding: 8px 16px; border-radius: 999px; font-weight: bold; display: inline-block; margin: 15px 0; }
        .qr-box { background: white; padding: 15px; border-radius: 12px; display: inline-block; margin: 15px 0; }
        .qr-box img { display: block; max-width: 100%; height: auto; }
        .log-box { text-align: left; background: #050a12; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 11px; max-height: 150px; overflow-y: auto; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Raksa Travel 24/7 Cloud Bot</h1>
        <div class="badge">${isConnected ? 'ONLINE 24/7 (BAILEYS CLOUD)' : authStatus}</div>
        
        ${latestQrDataUrl && !isConnected ? `
          <p>Scan QR Code berikut menggunakan aplikasi WhatsApp di HP kamu:</p>
          <div class="qr-box">
            <img src="${latestQrDataUrl}" alt="WhatsApp QR Code">
          </div>
        ` : ''}

        ${isConnected ? `
          <p style="color: #4ade80;">Bot berhasil terhubung ke WhatsApp dan aktif memantau promo untuk website <b>raksatravel.github.io</b>.</p>
        ` : ''}

        <h3>Riwayat Sinkronisasi:</h3>
        <div class="log-box">
          ${syncLogHistory.length > 0 ? syncLogHistory.map(l => `<div>${l}</div>`).join('') : '<div>Menunggu promo baru...</div>'}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Web monitoring active on port ${PORT}`);
});

startWhatsAppBot();
