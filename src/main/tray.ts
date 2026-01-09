import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import path from 'path';
import { configManager } from './config';
import { getServerStatus } from './server';
import { tunnelManager } from './tunnel';

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow, onQuit: () => void): Tray {
  // Create tray icon
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  let icon: Electron.NativeImage;
  
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Create a simple icon if file not found
      icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAKCSURBVFiF7ZdNaBNBFMd/s5tNNk2TJlZbP1qrRVGxIl7Ei+LNgwcvHjyIBy8eFLx48OBFEDwoHgQRDx5E8eBBvCh4UPGg4kER/KgfVWurtWqbpmm+dnbGQ5ImNdlka1s8+L8wO7Pz3v/N7M7sG+h1rWu5Lb8V0YGeoWMIOIGW0qkEcG8Vbf4DIDtQLi/TA+wH9gM+IAQcAM4BTwCrWgf1BKCqeVjXDxE4DfiBIPAnUFstA3VvgU3cC+ABYGQ8fhqoB5yk+kfUCWgAuA2kAc9fA/D7oSLlGnr/EngKxKoZXi7AF4KUBzgBrKYgLlVTTKYWMKXyDJiqBmwDKnYsD1B6z/nMWi2wDriDBSC7XArKA1BTBngBKPmNtgGAJ3AL+AIsBw4DD0vVLAfgEdAP9ABjWGE4CzwGBgCR+94GfJ8NoBzgPnAFuExhKe4EngOnsMqvBUaAO8BAqb5zHcJKoB24gLXhgArGpU5nO3Wg0DYBaCAMvAKagGHgAFBHYejKAJQJXA8cJl+yNqCA08A94ARWaMaB68B9YCuwt1x/pQB8QD/wC3gI7ABOA3HAW1RvBQJFbfYA94C3wGngDNYBtaKcl5oHkKrqTqy8v4h1Gj4B6oDf06pdD8BKrHW/DdgMfAbasfLeBXwotOlOgJvAcqw0bANOYm2/4WL7TmA3VjYTwH6gHXiGlfenwNYyAB6w3hHyuwjrwNmJNfBKYE9RuxhW6FcAl7DunNPAu0J7pwB2YOV2EugA3mOlYxOwplT/TieCW8ViWHhuwtrYTwI/sDK1GngDbCnTd1nHSsCsXoEVpD7AvOdirNSuA6T8hQPQBbzDysEyrIsqBtwHPpbqv5T9AKwu9eN/YlY0AAAAAElFTkSuQmCC'
      );
    }
  } catch (e) {
    // Create a simple icon
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAKCSURBVFiF7ZdNaBNBFMd/s5tNNk2TJlZbP1qrRVGxIl7Ei+LNgwcvHjyIBy8eFLx48OBFEDwoHgQRDx5E8eBBvCh4UPGg4kER/KgfVWurtWqbpmm+dnbGQ5ImNdlka1s8+L8wO7Pz3v/N7M7sG+h1rWu5Lb8V0YGeoWMIOIGW0qkEcG8Vbf4DIDtQLi/TA+wH9gM+IAQcAM4BTwCrWgf1BKCqeVjXDxE4DfiBIPAnUFstA3VvgU3cC+ABYGQ8fhqoB5yk+kfUCWgAuA2kAc9fA/D7oSLlGnr/EngKxKoZXi7AF4KUBzgBrKYgLlVTTKYWMKXyDJiqBmwDKnYsD1B6z/nMWi2wDriDBSC7XArKA1BTBngBKPmNtgGAJ3AL+AIsBw4DD0vVLAfgEdAP9ABjWGE4CzwGBgCR+94GfJ8NoBzgPnAFuExhKe4EngOnsMqvBUaAO8BAqb5zHcJKoB24gLXhgArGpU5nO3Wg0DYBaCAMvAKagGHgAFBHYejKAJQJXA8cJl+yNqCA08A94ARWaMaB68B9YCuwt1x/pQB8QD/wC3gI7ABOA3HAW1RvBQJFbfYA94C3wGngDNYBtaKcl5oHkKrqTqy8v4h1Gj4B6oDf06pdD8BKrHW/DdgMfAbasfLeBXwotOlOgJvAcqw0bANOYm2/4WL7TmA3VjYTwH6gHXiGlfenwNYyAB6w3hHyuwjrwNmJNfBKYE9RuxhW6FcAl7DunNPAu0J7pwB2YOV2EugA3mOlYxOwplT/TieCW8ViWHhuwtrYTwI/sDK1GngDbCnTd1nHSsCsXoEVpD7AvOdirNSuA6T8hQPQBbzDysEyrIsqBtwHPpbqv5T9AKwu9eN/YlY0AAAAAElFTkSuQmCC'
    );
  }
  
  // Resize for tray (16x16 on Windows, 22x22 on macOS)
  const size = process.platform === 'darwin' ? 22 : 16;
  icon = icon.resize({ width: size, height: size });
  
  tray = new Tray(icon);
  tray.setToolTip('Codex API Server');
  
  // Update context menu
  const updateMenu = () => {
    const serverStatus = getServerStatus();
    const tunnelStatus = tunnelManager.getStatus();
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Codex API Server',
        enabled: false,
        icon: icon.resize({ width: 16, height: 16 }),
      },
      { type: 'separator' },
      {
        label: serverStatus.running ? `● サーバー稼働中 (Port ${serverStatus.port})` : '○ サーバー停止中',
        enabled: false,
      },
      {
        label: tunnelStatus.active ? `● トンネル接続中` : '○ トンネル未接続',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '管理画面を開く',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: 'ブラウザで開く',
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(`http://localhost:${serverStatus.port}/admin`);
        },
      },
      { type: 'separator' },
      {
        label: tunnelStatus.url ? `URL: ${tunnelStatus.url.replace('https://', '')}` : 'トンネルURL: なし',
        enabled: !!tunnelStatus.url,
        click: () => {
          if (tunnelStatus.url) {
            const { clipboard } = require('electron');
            clipboard.writeText(tunnelStatus.url);
          }
        },
      },
      { type: 'separator' },
      {
        label: '終了',
        click: onQuit,
      },
    ]);
    
    tray!.setContextMenu(contextMenu);
  };
  
  // Initial menu
  updateMenu();
  
  // Update menu periodically
  setInterval(updateMenu, 5000);
  
  // Double click to show window
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
