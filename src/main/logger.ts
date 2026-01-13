// In-memory log manager for real-time logging

export interface LogEntry {
  id: number;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  category: 'api' | 'system' | 'auth' | 'cli';
  message: string;
  details?: Record<string, any>;
}

class LogManager {
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;
  private nextId: number = 1;
  private listeners: Set<(log: LogEntry) => void> = new Set();

  log(type: LogEntry['type'], category: LogEntry['category'], message: string, details?: Record<string, any>): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date(),
      type,
      category,
      message,
      details,
    };

    this.logs.push(entry);

    // Trim old logs if exceeding max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(entry);
      } catch (e) {
        // Ignore listener errors
      }
    });

    return entry;
  }

  info(category: LogEntry['category'], message: string, details?: Record<string, any>): LogEntry {
    return this.log('info', category, message, details);
  }

  success(category: LogEntry['category'], message: string, details?: Record<string, any>): LogEntry {
    return this.log('success', category, message, details);
  }

  warning(category: LogEntry['category'], message: string, details?: Record<string, any>): LogEntry {
    return this.log('warning', category, message, details);
  }

  error(category: LogEntry['category'], message: string, details?: Record<string, any>): LogEntry {
    return this.log('error', category, message, details);
  }

  // Get logs with optional filtering
  getLogs(options: {
    limit?: number;
    since?: number; // Log ID to get logs after
    type?: LogEntry['type'];
    category?: LogEntry['category'];
  } = {}): LogEntry[] {
    let filtered = this.logs;

    if (options.since) {
      filtered = filtered.filter(log => log.id > options.since!);
    }

    if (options.type) {
      filtered = filtered.filter(log => log.type === options.type);
    }

    if (options.category) {
      filtered = filtered.filter(log => log.category === options.category);
    }

    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  // Get latest log ID for polling
  getLatestId(): number {
    return this.logs.length > 0 ? this.logs[this.logs.length - 1].id : 0;
  }

  // Subscribe to new logs
  subscribe(listener: (log: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Clear all logs
  clear(): void {
    this.logs = [];
  }
}

export const logManager = new LogManager();
export default logManager;
