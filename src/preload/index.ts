import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  generateMasterKey: () => ipcRenderer.invoke('config:generateMasterKey'),
  
  // Codex
  getCodexStatus: () => ipcRenderer.invoke('codex:status'),
  runCodexAuth: () => ipcRenderer.invoke('codex:auth'),

  // Claude
  getClaudeStatus: () => ipcRenderer.invoke('claude:status'),

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
});

// Type definitions for renderer
declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<any>;
      setConfig: (key: string, value: any) => Promise<void>;
      generateMasterKey: () => Promise<string>;
      getCodexStatus: () => Promise<any>;
      runCodexAuth: () => Promise<any>;
      getClaudeStatus: () => Promise<any>;
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
    };
  }
}
