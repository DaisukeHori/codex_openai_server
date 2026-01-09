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

  // Tunnel
  tunnelAutoStart: boolean;
  lastTunnelUrl: string | null;
}

const defaults: AppConfig = {
  onboardingCompleted: false,
  port: 8080,
  masterKey: '',
  defaultModel: 'gpt-5.2-codex',
  autoStart: true,
  codexAuthenticated: false,
  codexAuthMethod: null,
  claudeAuthenticated: false,
  claudeAuthMethod: null,
  theme: 'system',
  minimizeToTray: true,
  startMinimized: false,
  tunnelAutoStart: false,
  lastTunnelUrl: null,
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
  
  getServerConfig() {
    return {
      port: this.get('port'),
      masterKey: this.get('masterKey'),
      defaultModel: this.get('defaultModel'),
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
