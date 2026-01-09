import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import { configManager } from './config';
import { codexManager } from './codex';
import { claudeManager } from './claude';
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

// System check (npm availability)
async function checkCommand(cmd: string, args: string[]): Promise<{ available: boolean; version: string | null }> {
  // On macOS, GUI apps don't inherit shell PATH, so we need to use a login shell
  const platform = process.platform;
  let shellCmd: string;
  let shellArgs: string[];

  if (platform === 'darwin') {
    // Use login shell to get proper PATH on macOS
    const command = `${cmd} ${args.join(' ')}`;
    shellCmd = '/bin/zsh';
    shellArgs = ['-l', '-c', command];
  } else if (platform === 'win32') {
    shellCmd = cmd;
    shellArgs = args;
  } else {
    // Linux
    const command = `${cmd} ${args.join(' ')}`;
    shellCmd = '/bin/bash';
    shellArgs = ['-l', '-c', command];
  }

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(shellCmd, shellArgs, {
        shell: platform === 'win32',
        env: { ...process.env },
      });
      let output = '';
      proc.stdout?.on('data', (data) => { output += data.toString(); });
      proc.stderr?.on('data', (data) => { /* ignore stderr */ });
      proc.on('close', (code) => {
        if (code === 0) resolve(output.trim());
        else reject(new Error(`${cmd} not found`));
      });
      proc.on('error', reject);
    });
    return { available: true, version: result };
  } catch {
    return { available: false, version: null };
  }
}

ipcMain.handle('system:check', async () => {
  const platform = process.platform;
  const npm = await checkCommand('npm', ['--version']);
  const brew = platform === 'darwin' ? await checkCommand('brew', ['--version']) : { available: false, version: null };

  return {
    platform,
    npmAvailable: npm.available,
    npmVersion: npm.version,
    brewAvailable: brew.available,
  };
});

// Install Node.js/npm
ipcMain.handle('system:installNode', async (event) => {
  const platform = process.platform;
  const webContents = event.sender;

  if (platform === 'darwin') {
    // macOS: Try Homebrew first
    const brew = await checkCommand('brew', ['--version']);

    if (brew.available) {
      // Install Node.js via Homebrew
      return new Promise((resolve) => {
        webContents.send('install:progress', { provider: 'system', message: 'brew install node を実行中...' });

        const proc = spawn('brew', ['install', 'node'], { shell: true });

        proc.stdout?.on('data', (data) => {
          webContents.send('install:progress', { provider: 'system', message: data.toString() });
        });

        proc.stderr?.on('data', (data) => {
          webContents.send('install:progress', { provider: 'system', message: data.toString() });
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, message: 'Node.js のインストールが完了しました' });
          } else {
            resolve({ success: false, message: `インストールに失敗しました (exit code: ${code})` });
          }
        });

        proc.on('error', (err) => {
          resolve({ success: false, message: `エラー: ${err.message}` });
        });
      });
    } else {
      // Homebrew not available - open Terminal to install interactively
      return new Promise((resolve) => {
        webContents.send('install:progress', { provider: 'system', message: 'ターミナルで Homebrew をインストールします...' });

        // Use osascript to open Terminal and run the install command
        const installCmd = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && eval "$(/opt/homebrew/bin/brew shellenv)" && brew install node; echo ''; echo 'インストール完了。このウィンドウを閉じてアプリで再確認を押してください。'; read -p ''`;
        const appleScript = `tell application "Terminal"
          activate
          do script "${installCmd.replace(/"/g, '\\"')}"
        end tell`;

        const proc = spawn('osascript', ['-e', appleScript], {
          shell: false,
        });

        proc.on('close', () => {
          // Terminal opened, but we can't know when installation is done
          resolve({
            success: false,
            message: 'ターミナルが開きました。インストール完了後「再確認」を押してください。',
            needsManualInstall: true
          });
        });

        proc.on('error', (err) => {
          // Fallback: open the Homebrew website
          shell.openExternal('https://brew.sh/');
          resolve({ success: false, message: `ターミナルを開けませんでした。https://brew.sh/ から手動でインストールしてください`, needsManualInstall: true });
        });
      });
    }
  } else if (platform === 'win32') {
    // Windows: Open PowerShell with admin rights to install Node.js
    webContents.send('install:progress', { provider: 'system', message: 'PowerShell を管理者権限で開いています...' });

    // Check if winget is available first
    const winget = await checkCommand('winget', ['--version']);
    let installCmd: string;

    return new Promise((resolve) => {

      if (winget.available) {
        installCmd = 'winget install OpenJS.NodeJS --accept-package-agreements --accept-source-agreements';
      } else {
        // Fallback: download and run the Node.js installer
        installCmd = `
          $url = 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi'
          $output = "$env:TEMP\\node-installer.msi"
          Write-Host 'Downloading Node.js...'
          Invoke-WebRequest -Uri $url -OutFile $output
          Write-Host 'Installing Node.js...'
          Start-Process msiexec.exe -ArgumentList '/i', $output, '/quiet', '/norestart' -Wait
          Remove-Item $output
        `;
      }

      // Use PowerShell Start-Process with -Verb RunAs for UAC elevation
      const psScript = `
        ${installCmd}
        Write-Host ''
        Write-Host 'インストール完了。このウィンドウを閉じてアプリで再確認を押してください。'
        Read-Host 'Press Enter to close'
      `;

      const proc = spawn('powershell', [
        '-Command',
        `Start-Process powershell -Verb RunAs -ArgumentList '-NoExit', '-Command', '${psScript.replace(/'/g, "''").replace(/\n/g, '; ')}'`
      ], { shell: true });

      proc.on('close', () => {
        resolve({
          success: false,
          message: 'PowerShell が開きました。インストール完了後「再確認」を押してください。',
          needsManualInstall: true
        });
      });

      proc.on('error', () => {
        shell.openExternal('https://nodejs.org/ja/download/');
        resolve({ success: false, message: 'PowerShell を開けませんでした。nodejs.org からダウンロードしてください', needsManualInstall: true });
      });
    });

  } else {
    // Linux: Open terminal for interactive installation
    return new Promise((resolve) => {
      webContents.send('install:progress', { provider: 'system', message: 'ターミナルで Node.js をインストールします...' });

      // Try gnome-terminal first (Ubuntu default), then other terminals
      const installCmd = 'sudo apt-get update && sudo apt-get install -y nodejs npm; echo ""; echo "インストール完了。このウィンドウを閉じてアプリで再確認を押してください。"; read -p ""';

      // Try different terminal emulators
      const terminals = [
        { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', installCmd] },
        { cmd: 'konsole', args: ['-e', 'bash', '-c', installCmd] },
        { cmd: 'xfce4-terminal', args: ['-e', `bash -c '${installCmd}'`] },
        { cmd: 'x-terminal-emulator', args: ['-e', `bash -c '${installCmd}'`] },
      ];

      const tryTerminal = (index: number) => {
        if (index >= terminals.length) {
          shell.openExternal('https://nodejs.org/ja/download/');
          resolve({ success: false, message: 'ターミナルを開けませんでした。https://nodejs.org/ から手動でインストールしてください', needsManualInstall: true });
          return;
        }

        const term = terminals[index];
        const proc = spawn(term.cmd, term.args, { detached: true, stdio: 'ignore' });

        proc.on('error', () => {
          tryTerminal(index + 1);
        });

        proc.on('spawn', () => {
          proc.unref();
          resolve({
            success: false,
            message: 'ターミナルが開きました。インストール完了後「再確認」を押してください。',
            needsManualInstall: true
          });
        });
      };

      tryTerminal(0);
    });
  }
});

// Codex
ipcMain.handle('codex:status', async () => {
  return await codexManager.getStatus();
});
ipcMain.handle('codex:auth', async () => {
  // Open auth in terminal/browser
  return await codexManager.runAuth();
});

// Claude
ipcMain.handle('claude:status', async () => {
  return await claudeManager.getStatus();
});

// CLI Installation
ipcMain.handle('codex:install', async (event) => {
  const webContents = event.sender;
  return await codexManager.install((message) => {
    webContents.send('install:progress', { provider: 'codex', message });
  });
});

ipcMain.handle('claude:install', async (event) => {
  const webContents = event.sender;
  return await claudeManager.install((message) => {
    webContents.send('install:progress', { provider: 'claude', message });
  });
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
