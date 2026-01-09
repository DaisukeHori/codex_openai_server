import { spawn, ChildProcess } from 'child_process';
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

  constructor() {
    this.findClaudePath();
  }

  private findClaudePath(): void {
    const possiblePaths = [
      'claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/node22/bin/claude',
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'claude.cmd'),
      path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    ];

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
  }

  async isInstalled(): Promise<boolean> {
    try {
      await this.runRawCommand(['--version']);
      return true;
    } catch (e) {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const output = await this.runRawCommand(['--version']);
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output.trim();
    } catch (e) {
      return null;
    }
  }

  async checkAuth(): Promise<{ authenticated: boolean; method: 'api_key' | 'subscription' | null; message: string }> {
    try {
      // Determine auth method first
      let method: 'api_key' | 'subscription' | null = null;

      if (process.env.ANTHROPIC_API_KEY) {
        method = 'api_key';
      } else {
        const claudeDir = path.join(os.homedir(), '.claude');
        if (fs.existsSync(claudeDir)) {
          method = 'subscription';
        }
      }

      // Actually test if Claude CLI works by running a minimal command
      // Using --help is fast and doesn't require authentication
      // But to truly test auth, we need to try a simple prompt
      try {
        // First check if CLI is available
        await this.runRawCommand(['--version']);

        // If ANTHROPIC_API_KEY is set, assume it's valid (actual test would be slow)
        if (method === 'api_key') {
          return { authenticated: true, method: 'api_key', message: 'Authenticated via ANTHROPIC_API_KEY' };
        }

        // For subscription, check if credentials exist
        const claudeDir = path.join(os.homedir(), '.claude');
        const credentialsExist = fs.existsSync(claudeDir) &&
          (fs.existsSync(path.join(claudeDir, 'settings.json')) ||
           fs.existsSync(path.join(claudeDir, 'credentials.json')));

        if (credentialsExist) {
          return { authenticated: true, method: 'subscription', message: 'Authenticated via Claude subscription' };
        }

        // CLI works but no clear auth method - might still work
        return { authenticated: true, method: 'subscription', message: 'Claude CLI available' };
      } catch (cmdError) {
        // CLI command failed
        return { authenticated: false, method: null, message: 'Claude CLI not working' };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { authenticated: false, method: null, message: msg };
    }
  }

  async getStatus(): Promise<ClaudeStatus> {
    const installed = await this.isInstalled();
    if (!installed) {
      return {
        installed: false,
        version: null,
        authenticated: false,
        authMethod: null,
        message: 'Claude CLI is not installed. Install with: npm install -g @anthropic-ai/claude-code',
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

  // Run raw command (for version, etc.)
  private runRawCommand(args: string[], timeout: number = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
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
    // Claude CLI doesn't have native conversation support in -p mode,
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
}

export const claudeManager = new ClaudeManager();
export default claudeManager;
