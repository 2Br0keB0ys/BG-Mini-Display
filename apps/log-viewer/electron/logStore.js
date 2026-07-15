const Store = require('electron-store');

const DEFAULT_WORKER_URL = 'https://bgdisplay-worker.zanebaize.workers.dev';

const store = new Store({
  name: 'log-viewer-config',
  defaults: { workerUrl: DEFAULT_WORKER_URL, adminDevKey: '' },
});

function getConfig() {
  return {
    workerUrl: store.get('workerUrl', DEFAULT_WORKER_URL),
    adminDevKey: store.get('adminDevKey', ''),
  };
}

function setConfig(partial) {
  if (typeof partial.workerUrl === 'string' && partial.workerUrl.trim()) {
    store.set('workerUrl', partial.workerUrl.trim());
  }
  if (typeof partial.adminDevKey === 'string') {
    store.set('adminDevKey', partial.adminDevKey.trim());
  }
  return getConfig();
}

module.exports = { getConfig, setConfig, DEFAULT_WORKER_URL };
