# Codex API Server

**OpenAI API互換サーバー** - Codex CLI と Claude Code をラップしたデスクトップアプリケーション

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](#動作要件)

---

## 概要

Codex API Server は、OpenAI の Codex CLI および Anthropic の Claude Code CLI をラップし、OpenAI API 互換のエンドポイントとして提供するデスクトップアプリケーションです。

既存の OpenAI API クライアントやツールをそのまま使用して、Codex や Claude を利用できます。

### 主な特徴

- **OpenAI API 互換**: `/v1/responses`, `/v1/chat/completions` エンドポイントを提供
- **マルチプロバイダー**: OpenAI Codex と Anthropic Claude の両方をサポート
- **自動モデルルーティング**: モデル名に基づいて適切な CLI に自動ルーティング
- **Cloudflare Tunnel**: ワンクリックで安全な外部公開
- **認証システム**: APIキー管理と外部アクセス認証
- **管理コンソール**: Web UI で設定、ログ、API テストを管理
- **クロスプラットフォーム**: Windows, macOS, Linux 対応

---

## 目次

1. [動作要件](#動作要件)
2. [インストール](#インストール)
3. [初回セットアップ](#初回セットアップ)
4. [使い方](#使い方)
5. [API リファレンス](#api-リファレンス)
6. [モデル一覧](#モデル一覧)
7. [認証](#認証)
8. [Cloudflare Tunnel](#cloudflare-tunnel)
9. [設定](#設定)
10. [開発者向け](#開発者向け)
11. [トラブルシューティング](#トラブルシューティング)
12. [ライセンス](#ライセンス)

---

## 動作要件

### システム要件

| OS | バージョン |
|---|---|
| Windows | 10/11 (64-bit) |
| macOS | 10.15 (Catalina) 以上 |
| Linux | Ubuntu 20.04+ / Debian 11+ |

### 必須依存関係

以下の CLI ツールを事前にインストールしてください：

#### OpenAI Codex CLI

```bash
npm install -g @openai/codex
codex auth  # ChatGPT アカウントで認証
```

#### Claude Code CLI（オプション）

```bash
npm install -g @anthropic-ai/claude-code
claude  # 初回起動で認証
```

---

## インストール

### Windows

**インストーラー版**
1. [Releases](https://github.com/DaisukeHori/codex_openai_server/releases) から `CodexAPIServer-Setup.exe` をダウンロード
2. インストーラーを実行
3. デスクトップショートカットから起動

**ポータブル版**
1. `CodexAPIServer-Portable.exe` をダウンロード
2. 任意の場所に配置して実行（インストール不要）

### macOS

1. `CodexAPIServer.dmg` をダウンロード
2. アプリケーションフォルダにドラッグ
3. 初回起動前にターミナルで権限付与：
   ```bash
   xattr -cr "/Applications/Codex API Server.app"
   ```
4. Launchpad から起動

### Linux

```bash
# AppImage をダウンロード後
chmod +x CodexAPIServer.AppImage
./CodexAPIServer.AppImage
```

または `.deb` パッケージを使用：
```bash
sudo dpkg -i codex-api-server_*.deb
```

---

## 初回セットアップ

アプリ起動時にセットアップウィザードが表示されます：

1. **Welcome**: 概要説明
2. **CLI 確認**: Codex CLI / Claude Code のインストール状況確認
3. **認証確認**: 各 CLI の認証状態確認
4. **マスターキー設定**: 外部アクセス用のマスターキーを設定
5. **ポート設定**: API サーバーのポート番号を指定（デフォルト: 8080）
6. **完了**: サーバー起動

---

## 使い方

### 基本操作

| 操作 | 方法 |
|---|---|
| 起動 | アプリアイコンをダブルクリック |
| 管理画面 | 自動表示、またはトレイアイコンから |
| 最小化 | ウィンドウを閉じるとトレイに格納 |
| 終了 | トレイアイコン右クリック → 終了 |

### 管理コンソール

ブラウザで `http://localhost:8080/admin` にアクセス、または管理画面から：

- **ダッシュボード**: サーバー状態、統計情報
- **Playground**: API テスト用インターフェース
- **API Keys**: APIキーの作成・管理
- **履歴**: リクエスト履歴の確認
- **ログ**: リアルタイムログ表示
- **設定**: サーバー設定、トンネル設定

---

## API リファレンス

### ベース URL

```
http://localhost:8080
```

Cloudflare Tunnel 使用時は発行された URL を使用。

### エンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---|---|---|---|
| GET | `/health` | ヘルスチェック | 不要 |
| GET | `/v1/models` | モデル一覧取得 | 不要 |
| POST | `/v1/responses` | レスポンス生成 | 外部アクセス時必須 |
| GET | `/v1/responses` | レスポンス履歴取得 | 外部アクセス時必須 |
| GET | `/v1/responses/:id` | レスポンス詳細取得 | 外部アクセス時必須 |
| POST | `/v1/chat/completions` | チャット補完 | 外部アクセス時必須 |
| POST | `/v1/api-keys` | APIキー作成 | 外部アクセス時必須 |
| GET | `/v1/api-keys` | APIキー一覧 | 外部アクセス時必須 |
| GET | `/docs` | Swagger UI | 不要 |
| GET | `/openapi.json` | OpenAPI 仕様 | 不要 |

### Responses API

OpenAI の Responses API 互換エンドポイント。

**リクエスト**
```bash
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-5.2-codex",
    "input": "Hello, how are you?",
    "stream": false
  }'
```

**レスポンス**
```json
{
  "id": "resp_abc123...",
  "object": "response",
  "created_at": 1704067200,
  "model": "gpt-5.2-codex",
  "provider": "codex",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "I'm doing well, thank you for asking!"
        }
      ]
    }
  ],
  "output_text": "I'm doing well, thank you for asking!",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 15,
    "total_tokens": 25
  }
}
```

**パラメータ**

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| model | string | No | 使用するモデル（デフォルト: 設定のデフォルトモデル） |
| input | string/array | Yes | 入力テキストまたはメッセージ配列 |
| instructions | string | No | システムインストラクション |
| previous_response_id | string | No | 会話継続用の前回レスポンスID |
| stream | boolean | No | ストリーミングモード |

### Chat Completions API

OpenAI の Chat Completions API 互換エンドポイント。

**リクエスト**
```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is 2+2?"}
    ]
  }'
```

**レスポンス**
```json
{
  "id": "chatcmpl-abc123...",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "claude-sonnet-4",
  "provider": "claude",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "2 + 2 = 4"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  }
}
```

### ストリーミング

`stream: true` を指定すると Server-Sent Events 形式でレスポンスを受信できます。

```bash
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"input": "Tell me a story", "stream": true}'
```

**イベント形式**
```
data: {"id":"resp_xxx","object":"response.output_text.delta","delta":"Once upon a time"}

data: {"id":"resp_xxx","object":"response.output_text.delta","delta":" there was"}

data: {"id":"resp_xxx","object":"response.completed","output_text":"Once upon a time..."}

data: [DONE]
```

---

## モデル一覧

### OpenAI Codex モデル

| モデルID | 説明 |
|---|---|
| `gpt-5.2-codex` | GPT-5.2 Codex（推奨） |
| `gpt-5.1-codex` | GPT-5.1 Codex |
| `gpt-5.2` | GPT-5.2 |
| `gpt-5.1` | GPT-5.1 |
| `gpt-5` | GPT-5 |
| `gpt-4.1` | GPT-4.1 |
| `gpt-4.1-mini` | GPT-4.1 Mini |
| `gpt-4o` | GPT-4o |
| `gpt-4o-mini` | GPT-4o Mini |
| `o3` | O3 |
| `o3-mini` | O3 Mini |
| `o4-mini` | O4 Mini |
| `o1` | O1 |
| `o1-mini` | O1 Mini |

### Claude モデル

| モデルID | エイリアス | 説明 |
|---|---|---|
| `claude-opus-4` | `opus` | Claude Opus 4 |
| `claude-opus-4-5` | - | Claude Opus 4.5 |
| `claude-sonnet-4` | `sonnet` | Claude Sonnet 4 |
| `claude-sonnet-4-5` | - | Claude Sonnet 4.5 |
| `claude-3-5-sonnet` | - | Claude 3.5 Sonnet |
| `claude-haiku` | `haiku` | Claude Haiku |
| `claude-3-5-haiku` | - | Claude 3.5 Haiku |

**自動ルーティング**: `claude-` で始まるモデル名は Claude Code へ、それ以外は Codex CLI へルーティングされます。

---

## 認証

### 認証の仕組み

| アクセス元 | 認証 |
|---|---|
| localhost | 不要（設定で変更可能） |
| 外部（Tunnel経由等） | 必須 |

外部アクセスは `x-forwarded-for` ヘッダーで判定されます。

### APIキーの作成

**管理コンソールから**
1. 「API Keys」タブを開く
2. 「新規作成」ボタンをクリック
3. キー名を入力して作成
4. 表示されたキーを安全に保存（再表示不可）

**API経由**
```bash
curl -X POST http://localhost:8080/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My App Key"}'
```

### APIキーの使用

```bash
curl -X POST https://your-tunnel-url.trycloudflare.com/v1/responses \
  -H "Authorization: Bearer cdx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello"}'
```

### マスターキー

マスターキーは全権限を持つ特別なキーです。設定画面で確認・再生成できます。

```bash
Authorization: Bearer msk_your_master_key_here
```

---

## Cloudflare Tunnel

### Quick Tunnel（推奨）

設定不要で即座に外部公開できます。

1. 管理コンソール → 設定
2. 「トンネル開始」をクリック
3. 発行された URL（`*.trycloudflare.com`）を使用

**注意**: URL は起動ごとに変わります。

### Named Tunnel（カスタムドメイン）

固定の URL やカスタムドメインを使用する場合：

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) でトンネルを作成
2. トンネルトークンをコピー
3. 管理コンソール → 設定 → 「Tunnel Token」に貼り付け
4. 「Custom URL」にドメインを入力（例: `https://api.example.com`）
5. トンネル開始

---

## 設定

### 設定項目

| 項目 | 説明 | デフォルト |
|---|---|---|
| `port` | APIサーバーのポート | 8080 |
| `defaultModel` | デフォルトモデル | gpt-5.2-codex |
| `allowLocalWithoutAuth` | localhost認証スキップ | true |
| `masterKey` | マスターキー | 自動生成 |
| `autoStart` | サーバー自動起動 | true |
| `minimizeToTray` | トレイに最小化 | true |
| `tunnelAutoStart` | トンネル自動開始 | false |
| `tunnelToken` | Named Tunnel トークン | - |
| `tunnelCustomUrl` | カスタムドメインURL | - |

### カスタムCLIパス

CLI が自動検出されない場合、設定画面で手動指定できます：

- **Codex Path**: Codex CLI の絶対パス
- **Claude Path**: Claude Code CLI の絶対パス

---

## 開発者向け

### プロジェクト構造

```
codex_openai_server/
├── src/
│   ├── main/                 # Electron メインプロセス
│   │   ├── index.ts          # エントリーポイント
│   │   ├── config.ts         # 設定管理
│   │   ├── server.ts         # Express API サーバー
│   │   ├── codex.ts          # Codex CLI マネージャー
│   │   ├── claude.ts         # Claude Code マネージャー
│   │   ├── model-router.ts   # モデルルーティング
│   │   ├── tunnel.ts         # Cloudflare Tunnel
│   │   ├── tray.ts           # システムトレイ
│   │   ├── logger.ts         # ロギング
│   │   └── updater.ts        # 自動アップデート
│   ├── preload/              # Preload スクリプト
│   │   └── index.ts
│   └── renderer/             # UI (HTML/CSS/JS)
│       ├── admin.html        # 管理コンソール
│       └── onboarding.html   # セットアップウィザード
├── assets/                   # アイコン等
├── package.json
└── tsconfig.json
```

### ビルド

```bash
# 依存関係インストール
npm install

# 開発モード
npm run dev

# TypeScript コンパイル
npm run build

# パッケージング（現在のプラットフォーム）
npm run dist

# プラットフォーム別ビルド
npm run dist:win     # Windows
npm run dist:mac     # macOS
npm run dist:linux   # Linux
```

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Admin UI   │  │  Onboarding  │  │   System Tray    │  │
│  │  (React)     │  │   Wizard     │  │                  │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
│         │                                                    │
├─────────┼────────────────────────────────────────────────────┤
│         ▼                                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Express API Server                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │ │
│  │  │ /v1/     │  │ /admin/  │  │   Auth Middleware    │ │ │
│  │  │responses │  │  logs    │  │ (Bearer Token Auth)  │ │ │
│  │  │chat/comp │  │ tunnel   │  └──────────────────────┘ │ │
│  │  │models    │  │ config   │                           │ │
│  │  └────┬─────┘  └──────────┘                           │ │
│  └───────┼────────────────────────────────────────────────┘ │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Model Router                               │ │
│  │  ┌─────────────────┐      ┌─────────────────────────┐ │ │
│  │  │ claude-* models │ ───▶ │     Claude Manager      │ │ │
│  │  └─────────────────┘      │  (claude -p ... --print)│ │ │
│  │                           └─────────────────────────┘ │ │
│  │  ┌─────────────────┐      ┌─────────────────────────┐ │ │
│  │  │  Other models   │ ───▶ │     Codex Manager       │ │ │
│  │  └─────────────────┘      │  (codex -m ... -p ...)  │ │ │
│  │                           └─────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Cloudflare Tunnel Manager                  │ │
│  │   Quick Tunnel (trycloudflare.com)                     │ │
│  │   Named Tunnel (Custom Domain with Token)              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              SQLite Database (better-sqlite3)          │ │
│  │   - responses: レスポンス履歴                           │ │
│  │   - api_keys: APIキー管理                              │ │
│  │   - usage_logs: 使用量ログ                             │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## トラブルシューティング

### CLI が見つからない

**Codex CLI**
```bash
# インストール確認
which codex

# 再インストール
npm install -g @openai/codex

# 認証
codex auth
```

**Claude Code**
```bash
# インストール確認
which claude

# 再インストール
npm install -g @anthropic-ai/claude-code

# 認証（初回起動時）
claude
```

**NVM 環境の場合**

設定画面で CLI の絶対パスを手動指定してください：
```
/Users/username/.nvm/versions/node/v22.0.0/bin/codex
```

### ポートが使用中

別のアプリケーションがポートを使用している場合：

1. 設定 → ポート番号を変更（例: 8081）
2. サーバー再起動

### トンネルに接続できない

**DNS エラーの場合**

DNS 設定を変更してみてください：
- Cloudflare DNS: `1.1.1.1`
- Google DNS: `8.8.8.8`

**Cloudflared が見つからない場合**

cloudflared は自動ダウンロードされますが、手動インストールも可能：
```bash
# macOS
brew install cloudflared

# Windows
winget install Cloudflare.cloudflared
```

### 認証エラー (401)

外部からのアクセスには認証が必要です：

```bash
# APIキーを使用
curl -H "Authorization: Bearer cdx_your_key" ...

# またはマスターキーを使用
curl -H "Authorization: Bearer msk_your_master_key" ...
```

### macOS で起動できない

```bash
# Gatekeeper を解除
xattr -cr "/Applications/Codex API Server.app"

# または右クリック → 開く
```

---

## ライセンス

MIT License

Copyright (c) 2024 DaisukeHori

---

## 関連リンク

- [OpenAI Codex CLI](https://github.com/openai/codex)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
