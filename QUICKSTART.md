# 🚀 クイックスタートガイド

## 事前準備（Windows）

### 1. Node.js をインストール

https://nodejs.org/ から LTS版をダウンロードしてインストール

### 2. Codex CLI をインストール

コマンドプロンプトまたはPowerShellを開いて:

```
npm install -g @openai/codex
```

### 3. Codex CLI を認証

```
codex auth
```

ブラウザが開くので、ChatGPTアカウントでログインしてください。

## ビルド方法

### 方法1: バッチファイルを使用（推奨）

1. `build-windows.bat` をダブルクリック
2. 自動的にビルドが開始
3. `release` フォルダに実行ファイルが作成される

### 方法2: 手動ビルド

```bash
# 依存関係インストール
npm install

# TypeScriptビルド
npm run build

# Windows用Electronアプリをビルド
npm run dist:win
```

## 出力ファイル

ビルド完了後、`release` フォルダに以下のファイルが作成されます:

| ファイル | 説明 |
|---------|------|
| `CodexAPIServer-Portable.exe` | ポータブル版（インストール不要） |
| `Codex API Server Setup x.x.x.exe` | インストーラー版 |

## 使い方

### ポータブル版
1. `CodexAPIServer-Portable.exe` を任意の場所にコピー
2. ダブルクリックで起動
3. 初回はセットアップウィザードが表示される

### インストーラー版
1. `Codex API Server Setup x.x.x.exe` を実行
2. インストール先を選択
3. デスクトップショートカットから起動

## トラブルシューティング

### 「'npm' は認識されていません」エラー

Node.jsが正しくインストールされていません。
https://nodejs.org/ からダウンロードして再インストールしてください。

### 「better-sqlite3」のビルドエラー

Visual Studio Build Tools が必要です:
```
npm install --global windows-build-tools
```

### Codex認証エラー

```
codex auth
```
を再実行してください。

## サポート

問題が発生した場合は、以下を確認してください:

1. Node.js v18以上がインストールされているか
2. Codex CLIが正しく認証されているか
3. ポート8080が他のアプリで使用されていないか
