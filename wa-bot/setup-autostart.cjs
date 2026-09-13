const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appData = process.env.APPDATA;
const startupDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbsPath = path.join(__dirname, 'start-bot-silent.vbs');
const shortcutTarget = path.join(startupDir, 'RaksaTravel-Bot.vbs');

// 1. Remove duplicate from Windows Registry if exists (ensures only 1 instance runs)
try {
  execSync('powershell -NoProfile -Command "Remove-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\' -Name \'RaksaTravelBot\' -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
} catch (e) {}

// 2. Copy vbs to Startup folder
try {
  fs.copyFileSync(vbsPath, shortcutTarget);
  console.log('✅ Auto-Start Windows Berhasil Dipasang!');
  console.log('Bot akan otomatis berjalan di background setiap kali laptop Anda dinyalakan (tanpa dobel proses).');
} catch (err) {
  console.error('Gagal memasang auto-start:', err.message);
}
