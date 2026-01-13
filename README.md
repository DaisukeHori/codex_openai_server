# Codex API Server - Desktop Application

OpenAI API互換サーバーのデスクトップアプリケーション版です。
ダブルクリックで起動し、すぐに使い始められます。

## 特徴

- **ワンクリック起動**: インストール後、ダブルクリックで使用開始
- **オンボーディング**: 初回起動時に設定ウィザードで簡単セットアップ
- **システムトレイ**: バックグラウンドで動作、トレイアイコンから操作
- **完全自己完結**: Node.js, cloudflared等すべて同梱
- **Cloudflare Tunnel**: ボタン一発で外部公開

## 動作要件

- Windows 10/11 (64-bit)
- macOS 10.15+
- Linux (Ubuntu 20.04+)

**事前インストールが必要なもの:**
- Codex CLI: `npm i -g @openai/codex`
- ChatGPTアカウントでの認証: `codex auth`

## インストール

### Windows
1. `CodexAPIServer-Setup.exe` をダウンロード
2. 実行してインストール
3. デスクトップのショートカットから起動

### ポータブル版 (Windows)
1. `CodexAPIServer-Portable.exe` をダウンロード
2. 任意の場所に配置
3. ダブルクリックで起動（インストール不要）

### macOS
1. `CodexAPIServer.dmg` をダウンロード
2. アプリケーションフォルダにドラッグ
3. ターミナルから"xattr -cr "/Applications/Codex API Server.app"で権限付与
4. Launchpadから起動

### Linux
1. `CodexAPIServer.AppImage` をダウンロード
2. 実行権限を付与: `chmod +x CodexAPIServer.AppImage`
3. ダブルクリックで起動

## 初回セットアップ

1. アプリを起動
2. セットアップウィザードが表示される
3. 以下の手順に従って設定:
   - Step 1: ようこそ画面
   - Step 2: Codex CLI認証の確認
   - Step 3: マスターキーの設定
   - Step 4: ポート設定
   - Step 5: 完了！サーバー起動

## 使い方

### 基本操作

- **起動**: アプリアイコンをダブルクリック
- **管理画面**: 自動的に表示される、またはトレイアイコンから開く
- **最小化**: ウィンドウを閉じるとトレイに格納
- **終了**: トレイアイコンを右クリック → 終了

### API エンドポイント

サーバー起動後、以下のエンドポイントが利用可能:

```
http://localhost:8080/v1/responses    - Responses API
http://localhost:8080/v1/chat/completions - Chat API
http://localhost:8080/admin           - 管理画面
http://localhost:8080/docs            - Swagger UI
```

### Cloudflare Tunnel

1. 管理画面 → 設定を開く
2. 「トンネル開始」をクリック
3. 公開URLが表示される
4. このURLを外部から使用可能

## 開発者向け

### ビルド方法

```bash
# 依存関係インストール
npm install

# 開発モードで起動
npm run dev

# Windows用ビルド
npm run dist:win

# macOS用ビルド
npm run dist:mac

# Linux用ビルド
npm run dist:linux
```

### プロジェクト構造

```
codex-electron/
├── src/
│   ├── main/           # Electronメインプロセス
│   │   ├── index.ts    # エントリーポイント
│   │   ├── config.ts   # 設定管理
│   │   ├── codex.ts    # Codex CLI連携
│   │   ├── server.ts   # 埋め込みExpressサーバー
│   │   ├── tunnel.ts   # Cloudflare Tunnel
│   │   └── tray.ts     # システムトレイ
│   ├── preload/        # Preloadスクリプト
│   └── renderer/       # UI (HTML/CSS/JS)
│       ├── onboarding.html  # セットアップウィザード
│       └── admin.html       # 管理画面
├── assets/             # アイコン等
└── bin/                # プラットフォーム別バイナリ
```

## トラブルシューティング

### Codex CLIが見つからない

```bash
# グローバルインストール
npm i -g @openai/codex

# 認証
codex auth
```

### ポートが使用中

設定画面からポート番号を変更してください。

### トンネルが開始できない

cloudflaredが自動ダウンロードされます。
手動でインストールする場合:
```bash
npm i -g cloudflared
```

## ライセンス

MIT License
