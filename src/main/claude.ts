import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface ClaudeStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  authMethod: 'api_key' | 'subscription' | null;
  message: string;
}

export interface ClaudeProcess {
  process: ChildProcess;
  id: string;
  startTime: Date;
}

export interface ClaudeResponse {
  result: string;
  cost_usd?: number;
  session_id?: string;
  is_error?: boolean;
}

// Claude model aliases mapping
export const CLAUDE_MODELS: Record<string, { cliModel: string; displayName: string }> = {
  'claude-opus-4': { cliModel: 'opus', displayName: 'Claude Opus 4' },
  'claude-opus-4-5': { cliModel: 'opus', displayName: 'Claude Opus 4.5' },
  'claude-opus-4.5': { cliModel: 'opus', displayName: 'Claude Opus 4.5' },
  'claude-sonnet-4': { cliModel: 'sonnet', displayName: 'Claude Sonnet 4' },
  'claude-sonnet-4-5': { cliModel: 'sonnet', displayName: 'Claude Sonnet 4.5' },
  'claude-sonnet-4.5': { cliModel: 'sonnet', displayName: 'Claude Sonnet 4.5' },
  'claude-haiku': { cliModel: 'haiku', displayName: 'Claude Haiku' },
  'claude-haiku-3-5': { cliModel: 'haiku', displayName: 'Claude Haiku 3.5' },
  // Direct aliases (user can also use these)
  'opus': { cliModel: 'opus', displayName: 'Claude Opus' },
  'sonnet': { cliModel: 'sonnet', displayName: 'Claude Sonnet' },
  'haiku': { cliModel: 'haiku', displayName: 'Claude Haiku' },
};

export class ClaudeManager {
  private claudePath: string = 'claude';
  private activeProcesses: Map<string, ClaudeProcess> = new Map();
  private cachedStatus: ClaudeStatus | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds cache

  constructor() {
    this.findClaudePath();
  }

  // Clear cached status
  clearCache(): void {
    this.cachedStatus = null;
    this.cacheTime = 0;
  }

  // Get possible NVM paths for various Node versions
  private getNvmPaths(): string[] {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const paths: string[] = [];
    try {
      if (fs.existsSync(nvmDir)) {
        const versions = fs.readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(path.join(nvmDir, version, 'bin', 'claude'));
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

  private findClaudePath(): void {
    const isWindows = process.platform === 'win32';
    const exe = isWindows ? 'claude.cmd' : 'claude';

    const possiblePaths = [
      // Common Unix paths
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/node22/bin/claude',
      // Windows paths
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.PROGRAMFILES || '', 'nodejs', 'claude.cmd'),
      // Cross-platform npm global paths
      path.join(os.homedir(), '.npm-global', 'bin', exe),
      path.join(os.homedir(), '.npm', 'bin', exe),
      // NVM specific path
      path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.0.0', 'bin', 'claude'),
      // macOS Homebrew
      '/opt/homebrew/bin/claude',
      // Linux specific paths
      '/snap/bin/claude',
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      '/usr/local/lib/node_modules/.bin/claude',
      // NVM paths for various Node versions
      ...this.getNvmPaths(),
    ];

    // First check hardcoded paths
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          this.claudePath = p;
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
        const claudeInNpm = path.join(npmBin, process.platform === 'win32' ? 'claude.cmd' : 'claude');
        if (fs.existsSync(claudeInNpm)) {
          this.claudePath = claudeInNpm;
          return;
        }
      }
    } catch (e) {
      // Continue
    }

    // If not found, try to find via 'which' command using login shell
    // This is done asynchronously after construction
    this.findClaudePathAsync();
  }

  private async findClaudePathAsync(): Promise<void> {
    const platform = process.platform;

    try {
      let whichPath: string | null = null;

      if (platform === 'darwin') {
        // Use login shell to get full PATH on macOS
        whichPath = await this.runWhichCommand('/bin/zsh', ['-l', '-c', 'which claude']);
      } else if (platform === 'win32') {
        whichPath = await this.runWhichCommand('where', ['claude']);
      } else {
        // Linux
        whichPath = await this.runWhichCommand('/bin/bash', ['-l', '-c', 'which claude']);
      }

      if (whichPath) {
        this.claudePath = whichPath.trim();
      }
    } catch (e) {
      // Could not find claude via which
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
          resolve(output.trim().split('\n')[0]); // Get first line
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 5000);
    });
  }

  async isInstalled(): Promise<boolean> {
    const platform = process.platform;
    const isWindows = platform === 'win32';
    const exe = isWindows ? 'claude.cmd' : 'claude';
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
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/homebrew/bin/claude',
      // User local paths (common for npm -g on Linux without sudo)
      path.join(home, '.local', 'bin', 'claude'),
      // npm global paths
      path.join(home, '.npm-global', 'bin', exe),
      path.join(home, '.npm', 'bin', exe),
      path.join(home, 'npm-global', 'bin', exe),
      // volta
      path.join(home, '.volta', 'bin', 'claude'),
      // yarn global
      path.join(home, '.yarn', 'bin', 'claude'),
      path.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin', 'claude'),
      // pnpm global
      path.join(home, '.local', 'share', 'pnpm', 'claude'),
      // snap
      '/snap/bin/claude',
      // Windows paths
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'claude.cmd'),
      // NVM paths
      ...this.getNvmPaths(),
    ];

    for (const p of possiblePaths) {
      try {
        if (p && fs.existsSync(p)) {
          this.claudePath = p;
          console.log(`[Claude] Found at: ${p}`);
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
        const claudeInNpm = path.join(npmBin, exe);
        if (fs.existsSync(claudeInNpm)) {
          this.claudePath = claudeInNpm;
          console.log(`[Claude] Found via npm bin: ${claudeInNpm}`);
          return true;
        }
      }
    } catch {
      // Continue
    }

    // Strategy 3: Try which/where command
    const whichCommands = isWindows
      ? ['where claude']
      : platform === 'darwin'
        ? ['/bin/zsh -l -c "which claude"']
        : [
            '/bin/bash -l -c "which claude"',
            '/usr/bin/bash -l -c "which claude"',
            'bash -l -c "which claude"',
            'which claude',
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
          this.claudePath = output.trim().split('\n')[0];
          console.log(`[Claude] Found via which: ${this.claudePath}`);
          return true;
        }
      } catch {
        // Try next command
      }
    }

    // Strategy 4: Try running claude --version directly
    const versionCommands = isWindows
      ? ['claude --version']
      : platform === 'darwin'
        ? ['/bin/zsh -l -c "claude --version"']
        : [
            'claude --version',
            '/bin/bash -l -c "claude --version"',
            '/bin/sh -c "claude --version"',
          ];

    for (const cmd of versionCommands) {
      try {
        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: expandedPath },
        });
        if (output && (output.includes('claude') || output.match(/\d+\.\d+/))) {
          this.claudePath = 'claude';
          console.log(`[Claude] Found via version command`);
          return true;
        }
      } catch {
        // Try next command
      }
    }

    console.log(`[Claude] Not found after all strategies`);
    return false;
  }

  async getVersion(): Promise<string | null> {
    try {
      const platform = process.platform;
      let output: string;

      if (platform === 'darwin') {
        output = execSync('/bin/zsh -l -c "claude --version"', {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (platform === 'win32') {
        output = execSync('claude --version', {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        output = execSync('/bin/bash -l -c "claude --version"', {
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

  async checkAuth(): Promise<{ authenticated: boolean; method: 'api_key' | 'subscription' | null; message: string }> {
    try {
      // First check if CLI is available and working
      console.log('[Claude] checkAuth: Running --version with path:', this.claudePath);
      try {
        const versionOutput = await this.runRawCommand(['--version']);
        console.log('[Claude] checkAuth: --version succeeded:', versionOutput.trim());
      } catch (cmdError) {
        // CLI command failed
        console.log('[Claude] checkAuth: --version failed:', cmdError instanceof Error ? cmdError.message : String(cmdError));
        return { authenticated: false, method: null, message: 'Claude Code not working' };
      }

      // CLI works! Now determine auth method
      // Priority: API key > subscription (via ~/.claude directory)
      if (process.env.ANTHROPIC_API_KEY) {
        return { authenticated: true, method: 'api_key', message: 'Authenticated via ANTHROPIC_API_KEY' };
      }

      // Check for ~/.claude directory - if it exists and CLI works, user is authenticated
      // Claude Code stores various auth files here, we don't need to check specific files
      const claudeDir = path.join(os.homedir(), '.claude');
      if (fs.existsSync(claudeDir)) {
        // Check for any auth-related files (credentials, auth, settings, etc.)
        try {
          const files = fs.readdirSync(claudeDir);
          if (files.length > 0) {
            return { authenticated: true, method: 'subscription', message: 'Authenticated via Claude subscription' };
          }
        } catch (e) {
          // Directory exists but can't read - still consider authenticated if CLI works
        }
        return { authenticated: true, method: 'subscription', message: 'Claude Code authenticated' };
      }

      // CLI works without ~/.claude directory - might be using API key in other way
      // Since CLI runs successfully, assume it's authenticated
      return { authenticated: true, method: null, message: 'Claude Code available' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { authenticated: false, method: null, message: msg };
    }
  }

  async getStatus(forceRefresh: boolean = false): Promise<ClaudeStatus> {
    // Return cached status if still valid
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && (now - this.cacheTime) < this.CACHE_TTL) {
      console.log('[Claude] Returning cached status');
      return this.cachedStatus;
    }

    console.log('[Claude] Checking status...');
    const installed = await this.isInstalled();
    console.log('[Claude] isInstalled:', installed, 'claudePath:', this.claudePath);
    if (!installed) {
      const status: ClaudeStatus = {
        installed: false,
        version: null,
        authenticated: false,
        authMethod: null,
        message: 'Claude Code is not installed. Install with: npm install -g @anthropic-ai/claude-code',
      };
      this.cachedStatus = status;
      this.cacheTime = now;
      return status;
    }

    const version = await this.getVersion();
    const auth = await this.checkAuth();

    const status: ClaudeStatus = {
      installed: true,
      version,
      authenticated: auth.authenticated,
      authMethod: auth.method,
      message: auth.message,
    };

    this.cachedStatus = status;
    this.cacheTime = now;
    console.log('[Claude] Status cached:', JSON.stringify(status));
    return status;
  }

  // Run raw command (for version, etc.)
  private runRawCommand(args: string[], timeout: number = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      // Use login shell on macOS/Linux to get proper PATH
      const platform = process.platform;
      let proc;

      if (platform === 'darwin') {
        const command = `${this.claudePath} ${args.join(' ')}`;
        proc = spawn('/bin/zsh', ['-l', '-c', command], {
          env: { ...process.env },
        });
      } else if (platform === 'win32') {
        proc = spawn(this.claudePath, args, {
          shell: true,
          env: { ...process.env },
        });
      } else {
        const command = `${this.claudePath} ${args.join(' ')}`;
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

  // Convert model name to CLI model
  getCliModel(model: string): string {
    const mapping = CLAUDE_MODELS[model];
    return mapping ? mapping.cliModel : 'sonnet'; // Default to sonnet
  }

  // Check if a model is a Claude model
  static isClaudeModel(model: string): boolean {
    return model.startsWith('claude') ||
           model === 'opus' ||
           model === 'sonnet' ||
           model === 'haiku';
  }

  // Run prompt with JSON output
  async runPrompt(prompt: string, model: string, timeout: number = 120000): Promise<ClaudeResponse> {
    return new Promise((resolve, reject) => {
      const cliModel = this.getCliModel(model);
      const args = ['-p', prompt, '--model', cliModel, '--output-format', 'json'];

      let output = '';
      let errorOutput = '';

      const proc = spawn(this.claudePath, args, {
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
          try {
            // Parse JSON output
            const parsed = JSON.parse(output);
            resolve({
              result: parsed.result || parsed.content || output,
              cost_usd: parsed.cost_usd,
              session_id: parsed.session_id,
              is_error: parsed.is_error || false,
            });
          } catch (e) {
            // If JSON parsing fails, return raw output
            resolve({
              result: output.trim(),
              is_error: false,
            });
          }
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

  // Run with conversation history (for Response API compatibility)
  async runWithHistory(
    history: Array<{ role: string; content: string }>,
    model: string,
    timeout: number = 120000
  ): Promise<ClaudeResponse> {
    // Convert history to a prompt format
    // Claude Code doesn't have native conversation support in -p mode,
    // so we format it as a structured prompt
    const formattedHistory = history.map(msg => {
      const roleLabel = msg.role === 'user' ? 'Human' : 'Assistant';
      return `${roleLabel}: ${msg.content}`;
    }).join('\n\n');

    const prompt = `Here is a conversation history. Please continue as the Assistant:\n\n${formattedHistory}\n\nAssistant:`;

    return this.runPrompt(prompt, model, timeout);
  }

  // Spawn interactive process (for streaming)
  spawnInteractive(
    prompt: string,
    model: string,
    onData: (data: string) => void,
    onEnd: (output: string) => void,
    onError: (error: Error) => void
  ): string {
    const id = `claude_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const cliModel = this.getCliModel(model);
    const args = ['-p', prompt, '--model', cliModel, '--output-format', 'stream-json'];

    const proc = spawn(this.claudePath, args, {
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

  // Get list of available Claude models
  static getAvailableModels(): Array<{ id: string; name: string }> {
    return Object.entries(CLAUDE_MODELS)
      .filter(([key]) => key.startsWith('claude-')) // Only return full model names
      .map(([id, info]) => ({
        id,
        name: info.displayName,
      }));
  }

  // Install Claude Code via npm
  async install(
    onProgress: (message: string) => void
  ): Promise<{ success: boolean; message: string; needsManualInstall?: boolean }> {
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS: Open Terminal to install with sudo if needed
      return new Promise((resolve) => {
        onProgress('ターミナルで Claude Code をインストールします...');

        // Use osascript to open Terminal and run the install command
        const installCmd = `npm install -g @anthropic-ai/claude-code || sudo npm install -g @anthropic-ai/claude-code; echo ''; echo 'インストール完了。このウィンドウを閉じてアプリで再確認を押してください。'; read -p ''`;
        const appleScript = `tell application "Terminal"
          activate
          do script "${installCmd.replace(/"/g, '\\"')}"
        end tell`;

        const proc = spawn('osascript', ['-e', appleScript], {
          shell: false,
        });

        proc.on('close', () => {
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
        onProgress('PowerShell で Claude Code をインストールします...');

        const psScript = `
          npm install -g @anthropic-ai/claude-code
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

        proc.on('error', (err) => {
          resolve({ success: false, message: `PowerShell を開けませんでした: ${err.message}` });
        });
      });
    } else {
      // Linux: Open terminal for interactive installation
      return new Promise((resolve) => {
        onProgress('ターミナルで Claude Code をインストールします...');

        const installCmd = 'sudo npm install -g @anthropic-ai/claude-code; echo ""; echo "インストール完了。このウィンドウを閉じてアプリで再確認を押してください。"; read -p ""';

        const terminals = [
          { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', installCmd] },
          { cmd: 'konsole', args: ['-e', 'bash', '-c', installCmd] },
          { cmd: 'xfce4-terminal', args: ['-e', `bash -c '${installCmd}'`] },
          { cmd: 'x-terminal-emulator', args: ['-e', `bash -c '${installCmd}'`] },
        ];

        const tryTerminal = (index: number) => {
          if (index >= terminals.length) {
            resolve({ success: false, message: 'ターミナルを開けませんでした。手動でインストールしてください: sudo npm install -g @anthropic-ai/claude-code' });
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
  }
}

export const claudeManager = new ClaudeManager();
export default claudeManager;
