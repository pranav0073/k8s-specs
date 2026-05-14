const { app, BrowserWindow } = require('electron');
const path = require('path');
const net = require('net');

let mainWindow;
const PORT = 57321;

function waitForPort(port, maxWait = 6000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const s = net.createConnection(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        if (Date.now() - start > maxWait) reject(new Error('Backend failed to start'));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function startBackend() {
  // Store SQLite DB in the OS user-data folder (persists across updates)
  process.env.DB_PATH    = path.join(app.getPath('userData'), 'journal.db');
  process.env.PORT       = String(PORT);
  process.env.STATIC_DIR = path.join(__dirname, 'frontend', 'build');
  require('./backend/server');
  return waitForPort(PORT);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Trading Journal',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.setMenuBarVisibility(false);

  try {
    await startBackend();
    mainWindow.loadURL(`http://localhost:${PORT}`);
  } catch (err) {
    mainWindow.loadURL(
      `data:text/html,<body style="font-family:sans-serif;padding:2rem"><h2>Startup error</h2><pre>${err.message}</pre></body>`
    );
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
