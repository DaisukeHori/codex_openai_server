import { spawn, ChildProcess, SpawnOptions, execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { configManager } from './config';

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

  // Clear cache (no-op for codex as it doesn't use caching)
  clearCache(): void {
    // CodexManager doesn't use caching, but this method is provided
    // for API consistency with ClaudeManager
  }

  // Get possible NVM paths for various Node versions
  private getNvmPaths(): string[] {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const paths: string[] = [];
    try {
      if (fs.existsSync(nvmDir)) {
        const versions = fs.readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(path.join(nvmDir, version, 'bin', 'codex'));
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return paths;
  }

  // Get npm global bin directory using npm command
  private getNpmGlobalBin(): string | null {
    try {
      const platform = process.platform;
      let output: string;

      if (platform === 'darwin') {
        output = execSync('/bin/zsh -l -c "npm bin -g 2>/dev/null || npm config get prefix 2>/dev/null"', {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (platform === 'win32') {
        // On Windows, npm bin -g returns the full path directly
        output = execSync('npm bin -g 2>nul || npm config get prefix 2>nul', {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: 'cmd.exe',
        });
      } else {
        // Linux: try bash with fallback
        try {
          output = execSync('/bin/bash -l -c "npm bin -g 2>/dev/null || npm config get prefix 2>/dev/null"', {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Fallback to /usr/bin/bash or sh
          output = execSync('bash -l -c "npm bin -g 2>/dev/null || npm config get prefix 2>/dev/null" || sh -c "npm bin -g 2>/dev/null || npm config get prefix 2>/dev/null"', {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        }
      }

      if (output && output.trim()) {
        const binPath = output.trim().split('\n')[0];

        if (platform === 'win32') {
          // Windows: npm bin -g returns full path, npm config get prefix needs no suffix
          // Check if it's a prefix (doesn't contain node_modules)
          if (!binPath.includes('node_modules')) {
            return binPath; // On Windows, executables are in the prefix directly
          }
          return binPath;
        } else {
          // macOS/Linux: If it's a prefix, append /bin
          if (!binPath.endsWith('/bin') && !binPath.endsWith('\\bin')) {
            return path.join(binPath, 'bin');
          }
          return binPath;
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return null;
  }
  
  private findCodexPath(): void {
    // Check custom path first
    const customPath = configManager.get('customCodexPath');
    if (customPath && fs.existsSync(customPath)) {
      this.codexPath = customPath;
      return;
    }

    const isWindows = process.platform === 'win32';
    const exe = isWindows ? 'codex.cmd' : 'codex';

    const possiblePaths = [
      // Common Unix paths
      '/usr/local/bin/codex',
      '/usr/bin/codex',
      '/opt/node22/bin/codex',
      // Windows paths
      path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'codex.cmd'),
      path.join(process.env.PROGRAMFILES || '', 'nodejs', 'codex.cmd'),
      // Cross-platform npm global paths
      path.join(os.homedir(), '.npm-global', 'bin', exe),
      path.join(os.homedir(), '.npm', 'bin', exe),
      // NVM specific path
      path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.0.0', 'bin', 'codex'),
      // macOS Homebrew
      '/opt/homebrew/bin/codex',
      // Linux specific paths
      '/snap/bin/codex',
      path.join(os.homedir(), '.local', 'bin', 'codex'),
      '/usr/local/lib/node_modules/.bin/codex',
      // NVM paths for various Node versions
      ...this.getNvmPaths(),
    ];

    // First check hardcoded paths
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

    // Try npm global bin directory
    try {
      const npmBin = this.getNpmGlobalBin();
      if (npmBin) {
        const codexInNpm = path.join(npmBin, process.platform === 'win32' ? 'codex.cmd' : 'codex');
        if (fs.existsSync(codexInNpm)) {
          this.codexPath = codexInNpm;
          return;
        }
      }
    } catch (e) {
      // Continue
    }

    // If not found, try to find via 'which' command using login shell
    this.findCodexPathAsync();
  }

  private async findCodexPathAsync(): Promise<void> {
    const platform = process.platform;

    try {
      let whichPath: string | null = null;

      if (platform === 'darwin') {
        whichPath = await this.runWhichCommand('/bin/zsh', ['-l', '-c', 'which codex']);
      } else if (platform === 'win32') {
        whichPath = await this.runWhichCommand('where', ['codex']);
      } else {
        whichPath = await this.runWhichCommand('/bin/bash', ['-l', '-c', 'which codex']);
      }

      if (whichPath) {
        this.codexPath = whichPath.trim();
      }
    } catch (e) {
      // Could not find codex via which
    }
  }

  private runWhichCommand(cmd: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { env: { ...process.env } });
      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          resolve(output.trim().split('\n')[0]);
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });

      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 5000);
    });
  }

  async isInstalled(): Promise<boolean> {
    // Check custom path first
    const customPath = configManager.get('customCodexPath');
    if (customPath && fs.existsSync(customPath)) {
      this.codexPath = customPath;
      console.log(`[Codex] Using custom path: ${customPath}`);
      return true;
    }

    const platform = process.platform;
    const isWindows = platform === 'win32';
    const exe = isWindows ? 'codex.cmd' : 'codex';
    const home = os.homedir();

    // Build expanded PATH for searching
    const extraPaths = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.npm', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.yarn', 'bin'),
      '/usr/local/bin',
      '/usr/bin',
      '/opt/homebrew/bin',
    ];
    const expandedPath = [...extraPaths, process.env.PATH].filter(Boolean).join(path.delimiter);

    // Strategy 1: Check hardcoded paths first (fastest, no subprocess)
    const possiblePaths = [
      // Common Unix paths
      '/usr/local/bin/codex',
      '/usr/bin/codex',
      '/opt/homebrew/bin/codex',
      // User local paths (common for npm -g on Linux without sudo)
      path.join(home, '.local', 'bin', 'codex'),
      // npm global paths
      path.join(home, '.npm-global', 'bin', exe),
      path.join(home, '.npm', 'bin', exe),
      path.join(home, 'npm-global', 'bin', exe),
      // volta
      path.join(home, '.volta', 'bin', 'codex'),
      // yarn global
      path.join(home, '.yarn', 'bin', 'codex'),
      path.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin', 'codex'),
      // pnpm global
      path.join(home, '.local', 'share', 'pnpm', 'codex'),
      // snap
      '/snap/bin/codex',
      // Windows paths
      path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'codex.cmd'),
      // NVM paths
      ...this.getNvmPaths(),
    ];

    for (const p of possiblePaths) {
      try {
        if (p && fs.existsSync(p)) {
          this.codexPath = p;
          console.log(`[Codex] Found at: ${p}`);
          return true;
        }
      } catch {
        // Continue
      }
    }

    // Strategy 2: Check npm global bin directory
    try {
      const npmBin = this.getNpmGlobalBin();
      if (npmBin) {
        const codexInNpm = path.join(npmBin, exe);
        if (fs.existsSync(codexInNpm)) {
          this.codexPath = codexInNpm;
          console.log(`[Codex] Found via npm bin: ${codexInNpm}`);
          return true;
        }
      }
    } catch {
      // Continue
    }

    // Strategy 3: Try which/where command
    const whichCommands = isWindows
      ? ['where codex']
      : platform === 'darwin'
        ? ['/bin/zsh -l -c "which codex"']
        : [
            '/bin/bash -l -c "which codex"',
            '/usr/bin/bash -l -c "which codex"',
            'bash -l -c "which codex"',
            'which codex',
          ];

    for (const cmd of whichCommands) {
      try {
        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: expandedPath },
        });
        if (output && output.trim()) {
          this.codexPath = output.trim().split('\n')[0];
          console.log(`[Codex] Found via which: ${this.codexPath}`);
          return true;
        }
      } catch {
        // Try next command
      }
    }

    // Strategy 4: Try running codex --version directly
    const versionCommands = isWindows
      ? ['codex --version']
      : platform === 'darwin'
        ? ['/bin/zsh -l -c "codex --version"']
        : [
            'codex --version',
            '/bin/bash -l -c "codex --version"',
            '/bin/sh -c "codex --version"',
          ];

    for (const cmd of versionCommands) {
      try {
        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: expandedPath },
        });
        if (output && (output.includes('codex') || output.match(/\d+\.\d+/))) {
          this.codexPath = 'codex';
          console.log(`[Codex] Found via version command`);
          return true;
        }
      } catch {
        // Try next command
      }
    }

    console.log(`[Codex] Not found after all strategies`);
    return false;
  }

  async getVersion(): Promise<string | null> {
    try {
      const platform = process.platform;
      let output: string;

      if (platform === 'darwin') {
        output = execSync('/bin/zsh -l -c "codex --version"', {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (platform === 'win32') {
        output = execSync('codex --version', {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        output = execSync('/bin/bash -l -c "codex --version"', {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

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

      // Use login shell on macOS/Linux to get proper PATH
      const platform = process.platform;
      let proc;

      // Escape argument for shell - handle special characters
      const escapeArg = (str: string): string => {
        // Use single quotes for the argument and escape single quotes inside
        return "'" + str.replace(/'/g, "'\"'\"'") + "'";
      };

      // Build command with properly escaped arguments
      const buildCommand = (): string => {
        const escapedArgs = args.map((arg, i) => {
          // -p (prompt) argument needs escaping
          if (args[i - 1] === '-p') {
            return escapeArg(arg);
          }
          return arg;
        });
        return `"${this.codexPath}" ${escapedArgs.join(' ')}`;
      };

      if (platform === 'darwin') {
        const command = buildCommand();
        proc = spawn('/bin/zsh', ['-l', '-c', command], {
          env: { ...process.env },
        });
      } else if (platform === 'win32') {
        proc = spawn(this.codexPath, args, {
          shell: true,
          env: { ...process.env },
        });
      } else {
        const command = buildCommand();
        proc = spawn('/bin/bash', ['-l', '-c', command], {
          env: { ...process.env },
        });
      }

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

    // Pre-check: if codexPath is just 'codex', CLI wasn't found
    console.log(`[Codex] spawnInteractive: codexPath=${this.codexPath}, model=${model}`);
    if (this.codexPath === 'codex' && !fs.existsSync('/usr/local/bin/codex') && !fs.existsSync('/usr/bin/codex')) {
      // CLI not found - return error immediately
      setTimeout(() => {
        onError(new Error('Codex CLI is not installed. Install with: npm install -g @openai/codex'));
      }, 0);
      return id;
    }

    // Use login shell to get proper PATH (like runCommand)
    const platform = process.platform;
    let proc;

    // Escape prompt for shell - handle special characters
    const escapeForShell = (str: string): string => {
      // Use single quotes for the prompt and escape single quotes inside
      return str.replace(/'/g, "'\"'\"'");
    };

    if (platform === 'darwin') {
      const escapedPrompt = escapeForShell(prompt);
      const command = `"${this.codexPath}" -m ${model} -p '${escapedPrompt}' --no-stream`;
      console.log(`[Codex] Running: /bin/zsh -l -c ${command}`);
      proc = spawn('/bin/zsh', ['-l', '-c', command], {
        env: { ...process.env },
      });
    } else if (platform === 'win32') {
      const args = ['-m', model, '-p', prompt, '--no-stream'];
      proc = spawn(this.codexPath, args, {
        shell: true,
        env: { ...process.env },
      });
    } else {
      // Linux: use login shell with single-quoted prompt
      const escapedPrompt = escapeForShell(prompt);
      const command = `"${this.codexPath}" -m ${model} -p '${escapedPrompt}' --no-stream`;
      console.log(`[Codex] Running: /bin/bash -l -c ${command}`);
      proc = spawn('/bin/bash', ['-l', '-c', command], {
        env: { ...process.env },
      });
    }

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
