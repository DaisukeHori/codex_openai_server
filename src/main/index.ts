import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { configManager } from './config';
import { codexManager } from './codex';
import { tunnelManager } from './tunnel';
import { startServer, stopServer, getServerStatus } from './server';
import { createTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  const isOnboardingComplete = configManager.isOnboardingComplete();
  
  mainWindow = new BrowserWindow({
    width: isOnboardingComplete ? 1200 : 800,
    height: isOnboardingComplete ? 800 : 600,
    minWidth: 600,
    minHeight: 400,
    show: false,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  });
  
  // Load appropriate page
  if (isOnboardingComplete) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'onboarding.html'));
  }
  
  // Show when ready
  mainWindow.once('ready-to-show', () => {
    if (!configManager.get('startMinimized') || !isOnboardingComplete) {
      mainWindow?.show();
    }
  });
  
  // Handle close
  mainWindow.on('close', (event) => {
    if (!isQuitting && configManager.get('minimizeToTray') && configManager.isOnboardingComplete()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Create tray after window
  if (isOnboardingComplete) {
    createTray(mainWindow, quitApp);
  }
  
  return mainWindow;
}

function quitApp() {
  isQuitting = true;
  stopServer();
  destroyTray();
  app.quit();
}

// ============================================
// IPC Handlers
// ============================================

// Config
ipcMain.handle('config:get', () => configManager.getAll());
ipcMain.handle('config:set', (_, key: string, value: any) => {
  configManager.set(key as any, value);
});
ipcMain.handle('config:generateMasterKey', () => configManager.generateMasterKey());

// Codex
ipcMain.handle('codex:status', async () => {
  return await codexManager.getStatus();
});
ipcMain.handle('codex:auth', async () => {
  // Open auth in terminal/browser
  return await codexManager.runAuth();
});

// Server
ipcMain.handle('server:start', async () => {
  const config = configManager.getServerConfig();
  try {
    return await startServer(config.port, config.masterKey);
  } catch (error) {
    return { running: false, error: error instanceof Error ? error.message : 'Failed to start' };
  }
});
ipcMain.handle('server:stop', () => {
  stopServer();
});
ipcMain.handle('server:status', () => getServerStatus());

// Tunnel
ipcMain.handle('tunnel:start', async () => {
  tunnelManager.setPort(configManager.get('port'));
  return await tunnelManager.start();
});
ipcMain.handle('tunnel:stop', () => {
  tunnelManager.stop();
});
ipcMain.handle('tunnel:status', () => tunnelManager.getStatus());

// Onboarding
ipcMain.handle('onboarding:complete', () => {
  configManager.completeOnboarding();
  
  // Restart app to load main UI
  if (mainWindow) {
    mainWindow.setSize(1200, 800);
    mainWindow.center();
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
    createTray(mainWindow, quitApp);
  }
});
ipcMain.handle('onboarding:isComplete', () => configManager.isOnboardingComplete());

// Window
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});
ipcMain.handle('window:close', () => {
  if (configManager.get('minimizeToTray') && configManager.isOnboardingComplete()) {
    mainWindow?.hide();
  } else {
    quitApp();
  }
});
ipcMain.handle('window:openExternal', (_, url: string) => {
  shell.openExternal(url);
});

// ============================================
// App Events
// ============================================

app.whenReady().then(async () => {
  // Create window
  createWindow();
  
  // Auto-start server if onboarding is complete
  if (configManager.isOnboardingComplete() && configManager.get('autoStart')) {
    const config = configManager.getServerConfig();
    try {
      await startServer(config.port, config.masterKey);
      console.log('Server auto-started');
      
      // Auto-start tunnel if configured
      if (configManager.get('tunnelAutoStart')) {
        tunnelManager.setPort(config.port);
        await tunnelManager.start();
        console.log('Tunnel auto-started');
      }
    } catch (error) {
      console.error('Failed to auto-start server:', error);
    }
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitApp();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
