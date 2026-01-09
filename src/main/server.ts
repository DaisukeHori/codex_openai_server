import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { app as electronApp } from 'electron';
import Database from 'better-sqlite3';
import { configManager } from './config';
import { codexManager } from './codex';
import { tunnelManager } from './tunnel';

let server: any = null;
let db: Database.Database | null = null;

export interface ServerStatus {
  running: boolean;
  port: number;
  url: string;
}

// Simple storage using better-sqlite3
function initDatabase(dbPath: string) {
  db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      model TEXT,
      status TEXT DEFAULT 'completed',
      input TEXT,
      output TEXT,
      output_text TEXT,
      usage TEXT,
      created_at INTEGER,
      metadata TEXT
    );
    
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT DEFAULT '["responses","chat"]',
      is_active INTEGER DEFAULT 1,
      rate_limit INTEGER,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      metadata TEXT
    );
    
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT,
      endpoint TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
    );
  `);
  
  return db;
}

export function startServer(port: number, masterKey: string): Promise<ServerStatus> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve({ running: true, port, url: `http://localhost:${port}` });
      return;
    }
    
    // Initialize database
    configManager.ensureDataDir();
    const dbPath = configManager.getDatabasePath();
    initDatabase(dbPath);
    
    const app = express();
    
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    
    // Request ID
    app.use((req, res, next) => {
      res.setHeader('X-Request-Id', uuidv4());
      next();
    });
    
    // Auth middleware
    const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
      if (!masterKey) {
        next();
        return;
      }
      
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: { message: 'Missing Authorization header' } });
        return;
      }
      
      const token = authHeader.replace('Bearer ', '');
      if (token !== masterKey) {
        // Check API keys in database
        const stmt = db!.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1');
        const apiKey = stmt.get(hashKey(token));
        if (!apiKey) {
          res.status(401).json({ error: { message: 'Invalid API key' } });
          return;
        }
      }
      
      next();
    };
    
    // Simple hash function for API keys
    function hashKey(key: string): string {
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        const char = key.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return 'h_' + Math.abs(hash).toString(36);
    }
    
    // ========================================
    // Health & Status
    // ========================================
    
    app.get('/health', async (req, res) => {
      const codexStatus = await codexManager.getStatus();
      const tunnelStatus = tunnelManager.getStatus();
      
      res.json({
        status: 'ok',
        codex: {
          installed: codexStatus.installed,
          version: codexStatus.version,
          authenticated: codexStatus.authenticated,
          authMethod: codexStatus.authMethod,
        },
        tunnel: tunnelStatus,
        config: {
          defaultModel: configManager.get('defaultModel'),
          port: configManager.get('port'),
        },
        storage: {
          totalResponses: db!.prepare('SELECT COUNT(*) as count FROM responses').get() as any,
        },
      });
    });
    
    // ========================================
    // Models
    // ========================================
    
    const MODELS = [
      'gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5',
      'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
      'o3', 'o3-mini', 'o4-mini', 'o1', 'o1-mini',
    ];
    
    app.get('/v1/models', (req, res) => {
      res.json({
        object: 'list',
        data: MODELS.map(id => ({
          id,
          object: 'model',
          created: 1704067200,
          owned_by: 'openai',
        })),
      });
    });
    
    // ========================================
    // Responses API
    // ========================================
    
    app.post('/v1/responses', authMiddleware, async (req, res) => {
      const { model = configManager.get('defaultModel'), input, instructions, stream } = req.body;
      
      if (!input) {
        res.status(400).json({ error: { message: 'input is required' } });
        return;
      }
      
      const responseId = `resp_${uuidv4().replace(/-/g, '')}`;
      const createdAt = Math.floor(Date.now() / 1000);
      
      // Convert input to prompt
      let prompt = '';
      if (typeof input === 'string') {
        prompt = input;
      } else if (Array.isArray(input)) {
        prompt = input.map((m: any) => `${m.role}: ${m.content}`).join('\n');
      }
      
      if (instructions) {
        prompt = `${instructions}\n\n${prompt}`;
      }
      
      try {
        // Run codex
        const output = await codexManager.runCommand(['-m', model, '-p', prompt]);
        
        const response = {
          id: responseId,
          object: 'response',
          created_at: createdAt,
          model,
          status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: output }] }],
          output_text: output,
          usage: {
            input_tokens: Math.ceil(prompt.length / 4),
            output_tokens: Math.ceil(output.length / 4),
            total_tokens: Math.ceil((prompt.length + output.length) / 4),
          },
        };
        
        // Save to database
        db!.prepare(`
          INSERT INTO responses (id, model, status, input, output, output_text, usage, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          responseId, model, 'completed',
          JSON.stringify(input), JSON.stringify(response.output),
          output, JSON.stringify(response.usage), createdAt
        );
        
        res.json(response);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
          id: responseId,
          object: 'response',
          created_at: createdAt,
          model,
          status: 'failed',
          error: { message: errMsg },
        });
      }
    });
    
    app.get('/v1/responses', authMiddleware, (req, res) => {
      const limit = parseInt(req.query.limit as string) || 20;
      const rows = db!.prepare('SELECT * FROM responses ORDER BY created_at DESC LIMIT ?').all(limit);
      
      res.json({
        object: 'list',
        data: rows.map((r: any) => ({
          id: r.id,
          object: 'response',
          model: r.model,
          status: r.status,
          output_text: r.output_text,
          usage: JSON.parse(r.usage || '{}'),
          created_at: r.created_at,
        })),
      });
    });
    
    app.get('/v1/responses/:id', authMiddleware, (req, res) => {
      const row = db!.prepare('SELECT * FROM responses WHERE id = ?').get(req.params.id) as any;
      if (!row) {
        res.status(404).json({ error: { message: 'Response not found' } });
        return;
      }
      
      res.json({
        id: row.id,
        object: 'response',
        model: row.model,
        status: row.status,
        output: JSON.parse(row.output || '[]'),
        output_text: row.output_text,
        usage: JSON.parse(row.usage || '{}'),
        created_at: row.created_at,
      });
    });
    
    app.delete('/v1/responses/:id', authMiddleware, (req, res) => {
      const result = db!.prepare('DELETE FROM responses WHERE id = ?').run(req.params.id);
      if (result.changes === 0) {
        res.status(404).json({ error: { message: 'Response not found' } });
        return;
      }
      res.json({ id: req.params.id, deleted: true });
    });
    
    // ========================================
    // Chat Completions API
    // ========================================
    
    app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
      const { model = configManager.get('defaultModel'), messages } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: { message: 'messages array is required' } });
        return;
      }
      
      const prompt = messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');
      
      try {
        const output = await codexManager.runCommand(['-m', model, '-p', prompt]);
        
        res.json({
          id: `chatcmpl-${uuidv4().replace(/-/g, '')}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: output },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: Math.ceil(prompt.length / 4),
            completion_tokens: Math.ceil(output.length / 4),
            total_tokens: Math.ceil((prompt.length + output.length) / 4),
          },
        });
      } catch (error) {
        res.status(500).json({
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        });
      }
    });
    
    // ========================================
    // API Keys Management
    // ========================================
    
    app.post('/v1/api-keys', authMiddleware, (req, res) => {
      const { name, scopes = ['responses', 'chat'], expires_in_days, rate_limit } = req.body;
      
      if (!name) {
        res.status(400).json({ error: { message: 'name is required' } });
        return;
      }
      
      const id = `key_${uuidv4().replace(/-/g, '')}`;
      const plainKey = `cdx_${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 8)}`;
      const keyHash = hashKey(plainKey);
      const keyPrefix = plainKey.slice(0, 8);
      const createdAt = Math.floor(Date.now() / 1000);
      const expiresAt = expires_in_days ? createdAt + (expires_in_days * 86400) : null;
      
      db!.prepare(`
        INSERT INTO api_keys (id, name, key_hash, key_prefix, scopes, rate_limit, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, keyHash, keyPrefix, JSON.stringify(scopes), rate_limit || null, expiresAt, createdAt);
      
      res.json({
        object: 'api_key',
        id,
        name,
        key: plainKey,
        key_prefix: keyPrefix,
        scopes,
        is_active: true,
        rate_limit: rate_limit || null,
        expires_at: expiresAt,
        created_at: createdAt,
        warning: 'Save this key securely. It will not be shown again.',
      });
    });
    
    app.get('/v1/api-keys', authMiddleware, (req, res) => {
      const includeInactive = req.query.include_inactive === 'true';
      const query = includeInactive
        ? 'SELECT * FROM api_keys ORDER BY created_at DESC'
        : 'SELECT * FROM api_keys WHERE is_active = 1 ORDER BY created_at DESC';
      
      const rows = db!.prepare(query).all();
      
      res.json({
        object: 'list',
        data: rows.map((r: any) => ({
          object: 'api_key',
          id: r.id,
          name: r.name,
          key: `${r.key_prefix}...`,
          scopes: JSON.parse(r.scopes),
          is_active: r.is_active === 1,
          rate_limit: r.rate_limit,
          expires_at: r.expires_at,
          created_at: r.created_at,
          last_used_at: r.last_used_at,
        })),
      });
    });
    
    app.get('/v1/api-keys/:id', authMiddleware, (req, res) => {
      const row = db!.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id) as any;
      if (!row) {
        res.status(404).json({ error: { message: 'API key not found' } });
        return;
      }
      
      res.json({
        object: 'api_key',
        id: row.id,
        name: row.name,
        key: `${row.key_prefix}...`,
        scopes: JSON.parse(row.scopes),
        is_active: row.is_active === 1,
        rate_limit: row.rate_limit,
        expires_at: row.expires_at,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
      });
    });
    
    app.post('/v1/api-keys/:id/revoke', authMiddleware, (req, res) => {
      const result = db!.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(req.params.id);
      if (result.changes === 0) {
        res.status(404).json({ error: { message: 'API key not found' } });
        return;
      }
      res.json({ id: req.params.id, is_active: false, message: 'Key revoked' });
    });
    
    app.delete('/v1/api-keys/:id', authMiddleware, (req, res) => {
      const result = db!.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
      if (result.changes === 0) {
        res.status(404).json({ error: { message: 'API key not found' } });
        return;
      }
      res.json({ id: req.params.id, deleted: true });
    });
    
    app.get('/v1/api-keys-stats', authMiddleware, (req, res) => {
      const total = db!.prepare('SELECT COUNT(*) as count FROM api_keys').get() as any;
      const active = db!.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1').get() as any;
      
      res.json({
        total_keys: total.count,
        active_keys: active.count,
        total_requests_today: 0,
      });
    });
    
    // ========================================
    // Tunnel API
    // ========================================
    
    app.get('/admin/tunnel/status', authMiddleware, (req, res) => {
      res.json(tunnelManager.getStatus());
    });
    
    app.post('/admin/tunnel/start', authMiddleware, async (req, res) => {
      try {
        tunnelManager.setPort(port);
        const status = await tunnelManager.start();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: { message: error instanceof Error ? error.message : 'Failed to start tunnel' } });
      }
    });
    
    app.post('/admin/tunnel/stop', authMiddleware, (req, res) => {
      tunnelManager.stop();
      res.json({ success: true });
    });
    
    // ========================================
    // Config API
    // ========================================
    
    app.get('/admin/config', authMiddleware, (req, res) => {
      res.json({
        port: configManager.get('port'),
        defaultModel: configManager.get('defaultModel'),
        tunnel: tunnelManager.getStatus(),
      });
    });
    
    // ========================================
    // Serve Admin UI
    // ========================================
    
    app.get('/admin', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
    });
    
    // ========================================
    // Start Server
    // ========================================
    
    server = app.listen(port, '0.0.0.0', () => {
      console.log(`Server running at http://localhost:${port}`);
      resolve({ running: true, port, url: `http://localhost:${port}` });
    });
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

export function stopServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  tunnelManager.stop();
  codexManager.killAllProcesses();
}

export function getServerStatus(): ServerStatus {
  const port = configManager.get('port');
  return {
    running: server !== null,
    port,
    url: `http://localhost:${port}`,
  };
}
