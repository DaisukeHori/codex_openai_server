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

    // Set up event handlers
    autoUpdater.on('checking-for-update', () => {
      this.status = {
        ...this.status,
        checking: true,
        error: null,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
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
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.status = {
        ...this.status,
        checking: false,
        available: false,
        updateInfo: info,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('error', (err: Error) => {
      this.status = {
        ...this.status,
        checking: false,
        downloading: false,
        error: err.message,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('download-progress', (progressObj: ProgressInfo) => {
      this.status = {
        ...this.status,
        downloading: true,
        progress: progressObj,
      };
      this.notifyRenderer();
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
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
      return this.status;
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : 'Update check failed';
    }
    return this.status;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.status.available) {
      throw new Error('No update available');
    }

    this.status.downloading = true;
    this.notifyRenderer();

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
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
    autoUpdater.quitAndInstall(false, true);
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  // Check for updates on startup if enabled
  async checkOnStartup(): Promise<void> {
    if (configManager.get('updateEnabled') && configManager.get('updateCheckOnStartup')) {
      // Wait a bit before checking to let the app fully initialize
      setTimeout(() => {
        this.checkForUpdates();
      }, 3000);
    }
  }
}

export const updateManager = new UpdateManager();
export default updateManager;
