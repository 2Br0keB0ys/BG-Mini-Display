const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { apiGet, clearSession } = require('./session');
const store = require('./logStore');

// Works around "GPU process isn't usable" fatal crashes seen on some Windows
// setups (restrictive AV/EDR, VMs, RDP sessions without a real GPU): Chromium's
// compositor still spawns a GPU-helper process even for software rendering, and
// on these setups that helper process fails to *launch* at all (sandboxed child
// process creation gets blocked), not just to use hardware acceleration.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl =
    process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:get', () => store.getConfig());

ipcMain.handle('config:set', (_event, partial) => {
  const current = store.getConfig();
  const next = store.setConfig(partial);
  if (next.workerUrl !== current.workerUrl || next.adminDevKey !== current.adminDevKey) {
    clearSession();
  }
  return next;
});

ipcMain.handle('logs:fetchLatest', async (_event, opts = {}) => {
  const { workerUrl, adminDevKey } = store.getConfig();
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.lvl) params.set('lvl', opts.lvl);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiGet(workerUrl, `/api/admin/logs/latest${qs ? `?${qs}` : ''}`, adminDevKey);
});

ipcMain.handle('logs:fetchAll', async (_event, opts = {}) => {
  const { workerUrl, adminDevKey } = store.getConfig();
  const params = new URLSearchParams({ download: '1', format: 'json' });
  if (opts.limit) params.set('limit', String(opts.limit));
  return apiGet(workerUrl, `/api/admin/logs/all?${params.toString()}`, adminDevKey);
});
