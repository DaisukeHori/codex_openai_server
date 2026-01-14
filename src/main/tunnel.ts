import { spawn, ChildProcess, execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { pipeline } from 'stream/promises';

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
    return new Promise((resolve) => {
      const cloudflaredPath = this.getCloudflaredPath();
      const proc = spawn(cloudflaredPath, ['--version'], {
        shell: process.platform === 'win32',
      });
      
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      
      proc.on('error', () => {
        resolve(false);
      });
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
      
      const proc = spawn(cloudflaredPath, ['tunnel', '--url', localUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      
      let resolved = false;
      
      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        
        // Look for the tunnel URL
        const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (urlMatch && !this.url) {
          this.url = urlMatch[0];
          this.startedAt = Date.now();
          if (!resolved) {
            resolved = true;
            resolve(this.getStatus());
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
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.url = null;
    this.startedAt = null;
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
