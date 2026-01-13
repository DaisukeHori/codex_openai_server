import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import { configManager } from './config';

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  error: string | null;
  updateInfo: UpdateInfo | null;
  progress: ProgressInfo | null;
  currentVersion: string;
}

class UpdateManager {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    updateInfo: null,
    progress: null,
    currentVersion: app.getVersion(),
  };

  constructor() {
    // Configure autoUpdater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    // Enable logging for debugging
    autoUpdater.logger = {
      info: (message: string) => console.log('[AutoUpdater]', message),
      warn: (message: string) => console.warn('[AutoUpdater]', message),
      error: (message: string) => console.error('[AutoUpdater]', message),
      debug: (message: string) => console.log('[AutoUpdater Debug]', message),
    };

    // Set GitHub provider explicitly
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'DaisukeHori',
      repo: 'codex_openai_server',
    });

    console.log('[AutoUpdater] Initialized with version:', app.getVersion());

    // Set up event handlers
    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for updates...');
      this.status = {
        ...this.status,
        checking: true,
        error: null,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      console.log('[AutoUpdater] Update available:', info.version);
      this.status = {
        ...this.status,
        checking: false,
        available: true,
        updateInfo: info,
      };
      this.notifyRenderer();

      // Show update notification if enabled
      if (configManager.get('updateNotifyOnStartup')) {
        this.mainWindow?.webContents.send('update:available', info);
      }

      // Auto download if enabled
      if (configManager.get('updateAutoDownload')) {
        console.log('[AutoUpdater] Auto-downloading update...');
        this.downloadUpdate().catch(err => {
          console.error('[AutoUpdater] Auto-download failed:', err);
        });
      }
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      console.log('[AutoUpdater] No update available. Current version:', info.version);
      this.status = {
        ...this.status,
        checking: false,
        available: false,
        updateInfo: info,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('error', (err: Error) => {
      console.error('[AutoUpdater] Error:', err.message);
      this.status = {
        ...this.status,
        checking: false,
        downloading: false,
        error: err.message,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('download-progress', (progressObj: ProgressInfo) => {
      console.log('[AutoUpdater] Download progress:', Math.round(progressObj.percent), '%');
      this.status = {
        ...this.status,
        downloading: true,
        progress: progressObj,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      console.log('[AutoUpdater] Update downloaded:', info.version);
      this.status = {
        ...this.status,
        downloading: false,
        downloaded: true,
        updateInfo: info,
      };
      this.notifyRenderer();

      // Notify renderer that update is ready to install
      this.mainWindow?.webContents.send('update:downloaded', info);
    });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private notifyRenderer(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update:status', this.status);
    }
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (!configManager.get('updateEnabled')) {
      console.log('[AutoUpdater] Updates disabled in config');
      return this.status;
    }

    console.log('[AutoUpdater] Starting update check...');
    try {
      const result = await autoUpdater.checkForUpdates();
      console.log('[AutoUpdater] Check result:', result?.updateInfo?.version);
    } catch (error) {
      console.error('[AutoUpdater] Check failed:', error);
      this.status.error = error instanceof Error ? error.message : 'Update check failed';
      this.status.checking = false;
      this.notifyRenderer();
    }
    return this.status;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.status.available) {
      throw new Error('No update available');
    }

    console.log('[AutoUpdater] Starting download...');
    this.status.downloading = true;
    this.notifyRenderer();

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('[AutoUpdater] Download failed:', error);
      this.status.downloading = false;
      this.status.error = error instanceof Error ? error.message : 'Download failed';
      this.notifyRenderer();
      throw error;
    }
  }

  installUpdate(): void {
    if (!this.status.downloaded) {
      throw new Error('No update downloaded');
    }
    console.log('[AutoUpdater] Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  // Check for updates on startup if enabled
  async checkOnStartup(): Promise<void> {
    if (configManager.get('updateEnabled') && configManager.get('updateCheckOnStartup')) {
      console.log('[AutoUpdater] Will check for updates in 3 seconds...');
      // Wait a bit before checking to let the app fully initialize
      setTimeout(() => {
        this.checkForUpdates();
      }, 3000);
    } else {
      console.log('[AutoUpdater] Startup check disabled');
    }
  }
}

export const updateManager = new UpdateManager();
export default updateManager;
