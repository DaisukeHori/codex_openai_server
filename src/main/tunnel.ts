import { spawn, ChildProcess, execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { pipeline } from 'stream/promises';
import { configManager } from './config';

export interface TunnelStatus {
  active: boolean;
  url: string | null;
  startedAt: number | null;
  error: string | null;
}

class TunnelManager {
  private process: ChildProcess | null = null;
  private url: string | null = null;
  private startedAt: number | null = null;
  private error: string | null = null;
  private port: number = 8080;
  
  constructor() {}
  
  setPort(port: number): void {
    this.port = port;
  }
  
  getStatus(): TunnelStatus {
    return {
      active: this.process !== null && this.url !== null,
      url: this.url,
      startedAt: this.startedAt,
      error: this.error,
    };
  }
  
  private getCloudflaredPath(): string {
    // Check custom path first
    const customPath = configManager.get('customCloudflaredPath');
    if (customPath && fs.existsSync(customPath)) {
      return customPath;
    }

    const platform = process.platform;

    let binaryName = 'cloudflared';
    if (platform === 'win32') {
      binaryName = 'cloudflared.exe';
    }

    // Check userData/bin first (where we download to)
    const userBinPath = path.join(app.getPath('userData'), 'bin', binaryName);
    if (fs.existsSync(userBinPath)) {
      return userBinPath;
    }

    // Check bundled binary
    const resourcesPath = process.resourcesPath || app.getAppPath();
    const bundledPath = path.join(resourcesPath, 'bin', binaryName);
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }

    // Check in app directory
    const appBinPath = path.join(app.getAppPath(), 'bin', binaryName);
    if (fs.existsSync(appBinPath)) {
      return appBinPath;
    }

    // Fall back to system PATH
    return 'cloudflared';
  }
  
  async isCloudflaredInstalled(): Promise<boolean> {
    const cloudflaredPath = this.getCloudflaredPath();

    // If it's a full path, check if file exists first
    if (cloudflaredPath !== 'cloudflared' && !fs.existsSync(cloudflaredPath)) {
      return false;
    }

    return new Promise((resolve) => {
      try {
        const proc = spawn(cloudflaredPath, ['--version'], {
          shell: process.platform === 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Set timeout
        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }
  
  async downloadCloudflared(onProgress?: (message: string) => void): Promise<{ success: boolean; message: string }> {
    const platform = process.platform;
    const arch = process.arch;

    let downloadUrl: string;
    let fileName: string;
    let isTgz = false;

    if (platform === 'win32') {
      downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
      fileName = 'cloudflared.exe';
    } else if (platform === 'darwin') {
      downloadUrl = arch === 'arm64'
        ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
        : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
      fileName = 'cloudflared';
      isTgz = true;
    } else {
      downloadUrl = arch === 'arm64'
        ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64'
        : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
      fileName = 'cloudflared';
    }

    const binDir = path.join(app.getPath('userData'), 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const filePath = path.join(binDir, fileName);
    const downloadPath = isTgz ? path.join(binDir, 'cloudflared.tgz') : filePath;

    onProgress?.('ダウンロード中...');

    return new Promise((resolve) => {
      const downloadFile = (url: string) => {
        https.get(url, { headers: { 'User-Agent': 'Codex-API-Server' } }, (response) => {
          // Handle redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            if (response.headers.location) {
              downloadFile(response.headers.location);
            } else {
              resolve({ success: false, message: 'Redirect without location' });
            }
            return;
          }

          if (response.statusCode !== 200) {
            resolve({ success: false, message: `HTTP ${response.statusCode}` });
            return;
          }

          const file = fs.createWriteStream(downloadPath);
          response.pipe(file);

          file.on('finish', () => {
            file.close();

            if (isTgz) {
              // Extract .tgz file on macOS
              onProgress?.('解凍中...');
              try {
                execSync(`tar -xzf "${downloadPath}" -C "${binDir}"`, { encoding: 'utf-8' });
                // Remove the .tgz file
                fs.unlinkSync(downloadPath);
                // Make executable
                fs.chmodSync(filePath, '755');
                onProgress?.('インストール完了');
                resolve({ success: true, message: `Installed to ${filePath}` });
              } catch (err: any) {
                resolve({ success: false, message: `Extract failed: ${err.message}` });
              }
            } else {
              // Make executable on Unix
              if (platform !== 'win32') {
                fs.chmodSync(filePath, '755');
              }
              onProgress?.('インストール完了');
              resolve({ success: true, message: `Downloaded to ${filePath}` });
            }
          });

          file.on('error', (err) => {
            fs.unlink(downloadPath, () => {});
            resolve({ success: false, message: err.message });
          });
        }).on('error', (err) => {
          resolve({ success: false, message: err.message });
        });
      };

      downloadFile(downloadUrl);
    });
  }
  
  async start(): Promise<TunnelStatus> {
    if (this.process) {
      return this.getStatus();
    }

    this.error = null;
    this.url = null;

    // Check if cloudflared is available
    const installed = await this.isCloudflaredInstalled();
    if (!installed) {
      // Try to download
      const download = await this.downloadCloudflared();
      if (!download.success) {
        this.error = `cloudflared not found and download failed: ${download.message}`;
        return this.getStatus();
      }
    }

    return new Promise((resolve) => {
      const cloudflaredPath = this.getCloudflaredPath();
      const localUrl = `http://localhost:${this.port}`;

      // Check if a tunnel token is configured (for custom domains)
      const tunnelToken = configManager.get('tunnelToken');

      let args: string[];
      let useToken = false;

      if (tunnelToken && tunnelToken.trim()) {
        // Use token-based tunnel (custom domain from Cloudflare dashboard)
        args = ['tunnel', 'run', '--token', tunnelToken.trim()];
        useToken = true;
        console.log('[Tunnel] Starting with custom token (named tunnel)');
      } else {
        // Use quick tunnel (random trycloudflare.com URL)
        args = ['tunnel', '--url', localUrl];
        console.log('[Tunnel] Starting quick tunnel');
      }

      const proc = spawn(cloudflaredPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      
      let resolved = false;

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        console.log('[Tunnel] Output:', text.substring(0, 200));

        if (useToken) {
          // For token-based tunnels, look for "Connection registered" or similar
          // and use the custom URL from config
          if (text.includes('Registered tunnel connection') || text.includes('Connection') && text.includes('registered')) {
            const customUrl = configManager.get('tunnelCustomUrl');
            if (customUrl && customUrl.trim() && !this.url) {
              this.url = customUrl.trim();
              this.startedAt = Date.now();
              console.log(`[Tunnel] Token tunnel connected: ${this.url}`);
              if (!resolved) {
                resolved = true;
                resolve(this.getStatus());
              }
            }
          }
        } else {
          // For quick tunnels, look for the trycloudflare.com URL
          const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (urlMatch && !this.url) {
            this.url = urlMatch[0];
            this.startedAt = Date.now();
            console.log(`[Tunnel] Quick tunnel URL: ${this.url}`);
            if (!resolved) {
              resolved = true;
              resolve(this.getStatus());
            }
          }
        }
      };
      
      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);
      
      proc.on('error', (err) => {
        this.error = `Failed to start cloudflared: ${err.message}`;
        this.process = null;
        if (!resolved) {
          resolved = true;
          resolve(this.getStatus());
        }
      });
      
      proc.on('close', (code) => {
        this.process = null;
        this.url = null;
        this.startedAt = null;
        if (code !== 0 && !resolved) {
          this.error = `cloudflared exited with code ${code}`;
          resolved = true;
          resolve(this.getStatus());
        }
      });
      
      this.process = proc;
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (!this.url) {
            this.error = 'Tunnel start timeout (30s)';
            this.stop();
          }
          resolve(this.getStatus());
        }
      }, 30000);
    });
  }
  
  stop(): void {
    if (this.process) {
      const proc = this.process;
      const pid = proc.pid;
      console.log(`[Tunnel] Stopping cloudflared process (PID: ${pid})`);

      // First try SIGTERM
      proc.kill('SIGTERM');

      // Set a timeout to force kill if still running
      setTimeout(() => {
        try {
          // Check if process is still running
          if (pid) {
            process.kill(pid, 0); // This throws if process doesn't exist
            console.log(`[Tunnel] Process still running, sending SIGKILL`);
            proc.kill('SIGKILL');
          }
        } catch (e) {
          // Process already terminated
          console.log(`[Tunnel] Process terminated`);
        }
      }, 2000);

      this.process = null;
    }
    this.url = null;
    this.startedAt = null;
    this.error = null;
  }

  // Force kill all cloudflared processes (cleanup)
  forceKillAll(): void {
    console.log(`[Tunnel] Force killing all cloudflared processes`);
    try {
      if (process.platform === 'win32') {
        execSync('taskkill /F /IM cloudflared.exe 2>nul', { encoding: 'utf-8', stdio: 'pipe' });
      } else {
        execSync('pkill -9 cloudflared 2>/dev/null || true', { encoding: 'utf-8', stdio: 'pipe' });
      }
    } catch (e) {
      // Ignore errors (no processes to kill)
    }
    this.process = null;
    this.url = null;
    this.startedAt = null;
    this.error = null;
  }
  
  isActive(): boolean {
    return this.process !== null && this.url !== null;
  }
  
  getUrl(): string | null {
    return this.url;
  }
}

export const tunnelManager = new TunnelManager();
export default tunnelManager;
