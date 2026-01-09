import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  generateMasterKey: () => ipcRenderer.invoke('config:generateMasterKey'),

  // System
  checkSystem: () => ipcRenderer.invoke('system:check'),
  installNode: () => ipcRenderer.invoke('system:installNode'),

  // Codex
  getCodexStatus: () => ipcRenderer.invoke('codex:status'),
  runCodexAuth: () => ipcRenderer.invoke('codex:auth'),
  installCodex: () => ipcRenderer.invoke('codex:install'),

  // Claude
  getClaudeStatus: () => ipcRenderer.invoke('claude:status'),
  installClaude: () => ipcRenderer.invoke('claude:install'),

  // Server
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  
  // Tunnel
  startTunnel: () => ipcRenderer.invoke('tunnel:start'),
  stopTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  getTunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
  
  // Onboarding
  completeOnboarding: () => ipcRenderer.invoke('onboarding:complete'),
  isOnboardingComplete: () => ipcRenderer.invoke('onboarding:isComplete'),
  
  // Window
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openExternal: (url: string) => ipcRenderer.invoke('window:openExternal', url),
  
  // Events
  onServerStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('server:statusUpdate', (_, status) => callback(status));
  },
  onTunnelStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('tunnel:statusUpdate', (_, status) => callback(status));
  },
  onInstallProgress: (callback: (data: { provider: string; message: string }) => void) => {
    ipcRenderer.on('install:progress', (_, data) => callback(data));
  },
});

// Type definitions for renderer
declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<any>;
      setConfig: (key: string, value: any) => Promise<void>;
      generateMasterKey: () => Promise<string>;
      checkSystem: () => Promise<{ platform: string; npmAvailable: boolean; npmVersion: string | null; brewAvailable: boolean }>;
      installNode: () => Promise<{ success: boolean; message: string; needsManualInstall?: boolean }>;
      getCodexStatus: () => Promise<any>;
      runCodexAuth: () => Promise<any>;
      installCodex: () => Promise<{ success: boolean; message: string }>;
      getClaudeStatus: () => Promise<any>;
      installClaude: () => Promise<{ success: boolean; message: string }>;
      startServer: () => Promise<any>;
      stopServer: () => Promise<void>;
      getServerStatus: () => Promise<any>;
      startTunnel: () => Promise<any>;
      stopTunnel: () => Promise<void>;
      getTunnelStatus: () => Promise<any>;
      completeOnboarding: () => Promise<void>;
      isOnboardingComplete: () => Promise<boolean>;
      minimizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onServerStatus: (callback: (status: any) => void) => void;
      onTunnelStatus: (callback: (status: any) => void) => void;
      onInstallProgress: (callback: (data: { provider: string; message: string }) => void) => void;
    };
  }
}
