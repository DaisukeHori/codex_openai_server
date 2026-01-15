import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface AppConfig {
  // Onboarding
  onboardingCompleted: boolean;

  // Server
  port: number;
  masterKey: string;
  defaultModel: string;
  autoStart: boolean;
  allowLocalWithoutAuth: boolean; // Allow localhost access without authentication

  // Codex
  codexAuthenticated: boolean;
  codexAuthMethod: 'chatgpt' | 'api_key' | null;

  // Claude
  claudeAuthenticated: boolean;
  claudeAuthMethod: 'api_key' | 'subscription' | null;

  // UI
  theme: 'light' | 'dark' | 'system';
  minimizeToTray: boolean;
  startMinimized: boolean;
  killOnClose: boolean;

  // Tunnel
  tunnelAutoStart: boolean;
  lastTunnelUrl: string | null;
  tunnelToken: string; // Cloudflare Tunnel token for custom domains
  tunnelCustomUrl: string; // Custom domain URL (e.g., https://api.example.com)

  // Auto Update
  updateEnabled: boolean;
  updateCheckOnStartup: boolean;
  updateNotifyOnStartup: boolean;
  updateAutoDownload: boolean;

  // Custom Paths (empty = use default)
  customNpmPath: string;
  customClaudePath: string;
  customCodexPath: string;
  customCloudflaredPath: string;
}

const defaults: AppConfig = {
  onboardingCompleted: false,
  port: 8080,
  masterKey: '',
  defaultModel: 'gpt-5.2-codex',
  autoStart: true,
  allowLocalWithoutAuth: true, // Default: allow localhost without auth
  codexAuthenticated: false,
  codexAuthMethod: null,
  claudeAuthenticated: false,
  claudeAuthMethod: null,
  theme: 'system',
  minimizeToTray: true,
  startMinimized: false,
  killOnClose: true,
  tunnelAutoStart: false,
  lastTunnelUrl: null,
  tunnelToken: '',
  tunnelCustomUrl: '',
  updateEnabled: true,
  updateCheckOnStartup: true,
  updateNotifyOnStartup: true,
  updateAutoDownload: false,
  customNpmPath: '',
  customClaudePath: '',
  customCodexPath: '',
  customCloudflaredPath: '',
};

class ConfigManager {
  private store: Store<AppConfig>;
  
  constructor() {
    this.store = new Store<AppConfig>({
      name: 'config',
      defaults,
    });
  }
  
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key);
  }
  
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }
  
  getAll(): AppConfig {
    return this.store.store;
  }
  
  reset(): void {
    this.store.clear();
  }
  
  // Helper methods
  isOnboardingComplete(): boolean {
    return this.get('onboardingCompleted');
  }
  
  completeOnboarding(): void {
    this.set('onboardingCompleted', true);
  }

  resetOnboarding(): void {
    this.set('onboardingCompleted', false);
  }

  getServerConfig() {
    return {
      port: this.get('port'),
      masterKey: this.get('masterKey'),
      defaultModel: this.get('defaultModel'),
      allowLocalWithoutAuth: this.get('allowLocalWithoutAuth'),
    };
  }
  
  // Generate a secure master key
  generateMasterKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'msk_';
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }
  
  // Get paths
  getDataPath(): string {
    return app.getPath('userData');
  }
  
  getDatabasePath(): string {
    return path.join(this.getDataPath(), 'data', 'codex-server.db');
  }
  
  ensureDataDir(): void {
    const dataDir = path.join(this.getDataPath(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }
}

export const configManager = new ConfigManager();
export default configManager;
