/**
 * RaksaTravel WhatsApp Bot - 24/7 Watchdog Supervisor
 * Ensures continuous 24/7 uptime, self-healing, automatic crash recovery,
 * and background health-check monitoring.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const BOT_DIR = __dirname;
const LOG_FILE = path.join(BOT_DIR, 'bot-watchdog.log');
const BOT_SCRIPT = path.join(BOT_DIR, 'bot.cjs');
const AUTH_SESSION_DIR = path.join(BOT_DIR, '.wwebjs_auth', 'session');
const PID_FILE = path.join(BOT_DIR, 'watchdog.pid');

function checkSingleInstance() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (existingPid && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          console.log(`[WATCHDOG] Another watchdog instance is already running (PID: ${existingPid}). Exiting.`);
          process.exit(99);
        } catch (e) {
          try { fs.unlinkSync(PID_FILE); } catch (err) {}
        }
      }
    } catch (e) {}
  }
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
  } catch (e) {}
}

function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (existingPid === process.pid) {
        fs.unlinkSync(PID_FILE);
      }
    }
  } catch (e) {}
}

function logWatchdog(msg) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' });
  const line = `[WATCHDOG ${time}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > 2 * 1024 * 1024) {
        fs.writeFileSync(LOG_FILE, `[WATCHDOG ${time}] --- Log dirotasi karena melebihi 2MB ---\n`, 'utf-8');
      }
    }
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {}
}

function killZombieBrowsers() {
  try {
    if (process.platform === 'win32') {
      const psScript = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'brave.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -like '*wwebjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      execSync(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, { stdio: 'ignore' });
    }
  } catch (e) {}
}

function clearChromeLocks() {
  killZombieBrowsers();
  if (!fs.existsSync(AUTH_SESSION_DIR)) return;
  const lockNames = [
    'lockfile', 'DevToolsActivePort', 'SingletonLock', 'SingletonCookie', 'SingletonSocket',
    'Default/LOCK', 'Default\\LOCK', 'Default/DevToolsActivePort', 'Default\\DevToolsActivePort'
  ];
  for (const name of lockNames) {
    const p = path.join(AUTH_SESSION_DIR, name);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        logWatchdog(`Membersihkan lockfile lama: ${name}`);
      } catch (e) {}
    }
  }
}

let child = null;
let consecutiveFailures = 0;
let isShuttingDown = false;

function startBot() {
  if (isShuttingDown) return;

  logWatchdog('🚀 Memulai RaksaTravel Bot Engine (bot.cjs)...');
  clearChromeLocks();

  child = spawn(process.execPath, [BOT_SCRIPT], {
    cwd: BOT_DIR,
    stdio: 'inherit',
    env: process.env,
    shell: false
  });

  logWatchdog(`Bot aktif dengan Process ID (PID): ${child.pid}`);

  child.on('error', (err) => {
    logWatchdog(`❌ Error proses bot: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    logWatchdog(`⚠️ Bot berhenti (Exit Code: ${code}, Signal: ${signal}).`);
    child = null;

    if (!isShuttingDown) {
      logWatchdog('🔄 Me-restart bot otomatis dalam 3 detik...');
      setTimeout(startBot, 3000);
    }
  });
}

// 24/7 Heartbeat & Health Check
// Tests if the internal Express server is alive and responding
function checkHealth() {
  if (!child || isShuttingDown) return;

  const req = http.get('http://localhost:7860/api/status', { timeout: 8000 }, (res) => {
    if (res.statusCode === 200) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      logWatchdog(`⚠️ Health-check status code ${res.statusCode} (Gagal ke-${consecutiveFailures})`);
    }
  });

  req.on('error', (err) => {
    consecutiveFailures++;
    // Only warn if fails multiple times in a row (bot might be initializing on startup)
    if (consecutiveFailures >= 3) {
      logWatchdog(`⚠️ Health-check koneksi gagal: ${err.message} (Gagal ke-${consecutiveFailures})`);
    }
  });

  req.on('timeout', () => {
    req.destroy();
    consecutiveFailures++;
    logWatchdog(`⚠️ Health-check timeout (Gagal ke-${consecutiveFailures})`);
  });

  // If unresponsive for 4 checks in a row (~2 minutes of freeze)
  if (consecutiveFailures >= 4) {
    logWatchdog('🚨 Bot tidak merespons selama 2 menit. Melakukan force-kill & restart...');
    consecutiveFailures = 0;
    if (child) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${child.pid} 2>nul || exit 0`, { shell: 'cmd.exe' });
        } else {
          child.kill('SIGKILL');
        }
      } catch (e) {}
    }
  }
}

// Ensure only 1 watchdog instance can ever run
checkSingleInstance();

// Start bot
startBot();

// Run health checks every 30 seconds
setInterval(checkHealth, 30000);

// Graceful shutdown handling
process.on('SIGINT', () => {
  logWatchdog('Menerima sinyal SIGINT. Menghentikan Watchdog & Bot...');
  isShuttingDown = true;
  removePidFile();
  if (child) child.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logWatchdog('Menerima sinyal SIGTERM. Menghentikan Watchdog & Bot...');
  isShuttingDown = true;
  removePidFile();
  if (child) child.kill();
  process.exit(0);
});

process.on('exit', () => {
  removePidFile();
});
