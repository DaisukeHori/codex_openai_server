import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface CodexStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  authMethod: 'chatgpt' | 'api_key' | null;
  message: string;
}

export interface CodexProcess {
  process: ChildProcess;
  id: string;
  startTime: Date;
}

class CodexManager {
  private codexPath: string = 'codex';
  private activeProcesses: Map<string, CodexProcess> = new Map();
  
  constructor() {
    // Try to find codex in common locations
    this.findCodexPath();
  }
  
  private findCodexPath(): void {
    const possiblePaths = [
      'codex',
      path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'codex.cmd'),
      '/usr/local/bin/codex',
      '/usr/bin/codex',
    ];
    
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          this.codexPath = p;
          return;
        }
      } catch (e) {
        // Continue checking
      }
    }
  }
  
  async isInstalled(): Promise<boolean> {
    try {
      await this.runCommand(['--version']);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  async getVersion(): Promise<string | null> {
    try {
      const output = await this.runCommand(['--version']);
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output.trim();
    } catch (e) {
      return null;
    }
  }
  
  async checkAuth(): Promise<{ authenticated: boolean; method: 'chatgpt' | 'api_key' | null; message: string }> {
    try {
      // Try to run a simple command that requires auth
      const output = await this.runCommand(['--version']);
      
      // Check for auth indicators in output or config
      const configPath = path.join(
        process.env.APPDATA || process.env.HOME || '',
        '.codex',
        'config.json'
      );
      
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.api_key) {
            return { authenticated: true, method: 'api_key', message: 'Authenticated via API key' };
          }
          if (config.chatgpt_session || config.session) {
            return { authenticated: true, method: 'chatgpt', message: 'Authenticated via ChatGPT account' };
          }
        } catch (e) {
          // Config parse error
        }
      }
      
      // If codex runs without error, assume it's authenticated
      return { authenticated: true, method: 'chatgpt', message: 'Authenticated' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not authenticated') || msg.includes('login')) {
        return { authenticated: false, method: null, message: 'Not authenticated. Please run: codex auth' };
      }
      return { authenticated: false, method: null, message: msg };
    }
  }
  
  async getStatus(): Promise<CodexStatus> {
    const installed = await this.isInstalled();
    if (!installed) {
      return {
        installed: false,
        version: null,
        authenticated: false,
        authMethod: null,
        message: 'Codex CLI is not installed',
      };
    }
    
    const version = await this.getVersion();
    const auth = await this.checkAuth();
    
    return {
      installed: true,
      version,
      authenticated: auth.authenticated,
      authMethod: auth.method,
      message: auth.message,
    };
  }
  
  async runAuth(): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.codexPath, ['auth'], {
        stdio: 'inherit',
        shell: true,
      });
      
      proc.on('close', async (code) => {
        if (code === 0) {
          const auth = await this.checkAuth();
          resolve({ success: auth.authenticated, message: auth.message });
        } else {
          resolve({ success: false, message: `Auth process exited with code ${code}` });
        }
      });
      
      proc.on('error', (err) => {
        resolve({ success: false, message: err.message });
      });
    });
  }
  
  runCommand(args: string[], timeout: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      
      const proc = spawn(this.codexPath, args, {
        shell: true,
        env: { ...process.env },
      });
      
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('Command timeout'));
      }, timeout);
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(errorOutput || `Exit code: ${code}`));
        }
      });
      
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  
  spawnInteractive(
    prompt: string,
    model: string,
    onData: (data: string) => void,
    onEnd: (output: string) => void,
    onError: (error: Error) => void
  ): string {
    const id = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const args = ['-m', model, '-p', prompt, '--no-stream'];
    
    const proc = spawn(this.codexPath, args, {
      shell: true,
      env: { ...process.env },
    });
    
    this.activeProcesses.set(id, {
      process: proc,
      id,
      startTime: new Date(),
    });
    
    let output = '';
    
    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      onData(text);
    });
    
    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      output += text;
      onData(text);
    });
    
    proc.on('close', (code) => {
      this.activeProcesses.delete(id);
      if (code === 0) {
        onEnd(output);
      } else {
        onError(new Error(`Process exited with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      this.activeProcesses.delete(id);
      onError(err);
    });
    
    return id;
  }
  
  killProcess(id: string): boolean {
    const proc = this.activeProcesses.get(id);
    if (proc) {
      proc.process.kill('SIGTERM');
      this.activeProcesses.delete(id);
      return true;
    }
    return false;
  }
  
  killAllProcesses(): number {
    let killed = 0;
    for (const [id, proc] of this.activeProcesses) {
      proc.process.kill('SIGTERM');
      killed++;
    }
    this.activeProcesses.clear();
    return killed;
  }
  
  getActiveCount(): number {
    return this.activeProcesses.size;
  }

  // Install Codex CLI via npm
  async install(
    onProgress: (message: string) => void
  ): Promise<{ success: boolean; message: string; needsManualInstall?: boolean }> {
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS: Open Terminal to install with sudo if needed
      return new Promise((resolve) => {
        onProgress('ターミナルで Codex CLI をインストールします...');

        const installCmd = `npm install -g @openai/codex || sudo npm install -g @openai/codex; echo ''; echo 'インストール完了。このウィンドウを閉じてアプリで再確認を押してください。'; read -p ''`;
        const appleScript = `tell application "Terminal"
          activate
          do script "${installCmd.replace(/"/g, '\\"')}"
        end tell`;

        const proc = spawn('osascript', ['-e', appleScript], {
          shell: false,
        });

        proc.on('close', () => {
          this.findCodexPath();
          resolve({
            success: false,
            message: 'ターミナルが開きました。インストール完了後「再確認」を押してください。',
            needsManualInstall: true
          });
        });

        proc.on('error', (err) => {
          resolve({ success: false, message: `ターミナルを開けませんでした: ${err.message}` });
        });
      });
    } else if (platform === 'win32') {
      // Windows: Use PowerShell with admin rights
      return new Promise((resolve) => {
        onProgress('PowerShell で Codex CLI をインストールします...');

        const psScript = `
          npm install -g @openai/codex
          Write-Host ''
          Write-Host 'インストール完了。このウィンドウを閉じてアプリで再確認を押してください。'
          Read-Host 'Press Enter to close'
        `;

        const proc = spawn('powershell', [
          '-Command',
          `Start-Process powershell -Verb RunAs -ArgumentList '-NoExit', '-Command', '${psScript.replace(/'/g, "''").replace(/\n/g, '; ')}'`
        ], { shell: true });

        proc.on('close', () => {
          this.findCodexPath();
          resolve({
            success: false,
            message: 'PowerShell が開きました。インストール完了後「再確認」を押してください。',
            needsManualInstall: true
          });
        });

        proc.on('error', (err) => {
          resolve({ success: false, message: `PowerShell を開けませんでした: ${err.message}` });
        });
      });
    } else {
      // Linux: Open terminal for interactive installation
      return new Promise((resolve) => {
        onProgress('ターミナルで Codex CLI をインストールします...');

        const installCmd = 'sudo npm install -g @openai/codex; echo ""; echo "インストール完了。このウィンドウを閉じてアプリで再確認を押してください。"; read -p ""';

        const terminals = [
          { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', installCmd] },
          { cmd: 'konsole', args: ['-e', 'bash', '-c', installCmd] },
          { cmd: 'xfce4-terminal', args: ['-e', `bash -c '${installCmd}'`] },
          { cmd: 'x-terminal-emulator', args: ['-e', `bash -c '${installCmd}'`] },
        ];

        const tryTerminal = (index: number) => {
          if (index >= terminals.length) {
            resolve({ success: false, message: 'ターミナルを開けませんでした。手動でインストールしてください: sudo npm install -g @openai/codex' });
            return;
          }

          const term = terminals[index];
          const proc = spawn(term.cmd, term.args, { detached: true, stdio: 'ignore' });

          proc.on('error', () => {
            tryTerminal(index + 1);
          });

          proc.on('spawn', () => {
            proc.unref();
            this.findCodexPath();
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
  }
}

export const codexManager = new CodexManager();
export default codexManager;
