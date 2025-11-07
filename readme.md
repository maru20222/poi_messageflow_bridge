# poi_messageflow_bridge

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/maru20222/poi_messageflow_bridge)](https://github.com/maru20222/poi_messageflow_bridge/releases/latest)
[![GitHub](https://img.shields.io/github/license/maru20222/poi_messageflow_bridge)](LICENSE)
[![GitHub All Releases](https://img.shields.io/github/downloads/maru20222/poi_messageflow_bridge/total)](https://github.com/maru20222/poi_messageflow_bridge/releases)
[![GitHub Release Date](https://img.shields.io/github/release-date/maru20222/poi_messageflow_bridge)](https://github.com/maru20222/poi_messageflow_bridge/releases)


poi（艦これ専用ブラウザ）→ logbook-kai-messageflow（航海日誌改の外部ツール）へ  
**/kcsapi（API）・/kcs2（画像/JSON）** を転送する Node.js ブリッジ。

```text
[poi] --CDP--> [poi_messageflow_bridge.js] --WS--> [logbook-kai-messageflow] --> [航海日誌改]
```

![poi](./image/poi_desktop.png)

## 特徴
- CDPで非侵入に観測（MITM不要）
- /kcsapi・/kcs2 を自動判定して送信
- 重要API（getData/require_info/port）は Fetch(Response) で確実取得
- 再接続＆多重起動ガード、ローカルWS(127.0.0.1)のみ

## 動作要件
- Windows 11
- poi v11.0.0以降（--remote-debugging-port=9222 で起動可能）
- Node.js 18+（推奨 20〜22）
- 航海日誌改 v24.0.17以降 + logbook-kai-messageflow v1.0.1以降（既定: WS 8890 / Web 8888）

## 置き場所
- 任意（例）:
    - %USERPROFILE%\Documents\logbook-bridge\poi_messageflow_bridge.js

## ログファイル

- 本ブリッジは既定で **日時付きログをファイル出力**します（**月次ローテーション**）。
  - 出力先（既定）: `%USERPROFILE%\Documents\logbook-bridge\logs\YYYY-MM.log`
  - 詳細ログはファイルを参照してください（コンソール出力は最小限です）。

### ログに出る代表的な行
- `[2025-11-05 12:32:01.637][INFO] [ws] connected imageJson → ws://127.0.0.1:8890/imageJson/websocket`
- `[2025-11-05 12:32:01.640][INFO] [ws] connected image → ws://127.0.0.1:8890/image/websocket`
- `[2025-11-05 12:32:01.641][INFO] [ws] connected api → ws://127.0.0.1:8890/api/websocket`
- `[2025-11-05 12:32:09.892][INFO] [api] sent (Fetch) /kcsapi/api_start2/getData (base64)`
- `[2025-11-05 12:32:10.108][INFO] [api] sent (Fetch) /kcsapi/api_get_member/require_info (base64)`
- `[2025-11-05 12:32:10.399][INFO] [api] sent (Fetch) /kcsapi/api_port/port (base64)`
- `[2025-11-05 12:32:22.491][INFO] [image] sent /kcs2/...`
- `[2025-11-05 12:32:42.179][INFO] [imageJson] sent /kcs2/...json`

## 事前準備

本ブリッジは Node.js と `ws` パッケージを使用します。初回のみ以下を実施してください。

### 0) PowerShell/ターミナルを開く

- スタートメニューで **「power」** と入力 → **Windows PowerShell** を選択して開く  
- 権限は **通常ユーザーでOK**（管理者である必要はありません）
- 以降のコマンドは、特記ない限り **Windows PowerShell** 上で実行します

### 1) Node.js のインストール（Windows）
- 公式サイトから **LTS（推奨版）** のインストーラを取得し、画面の指示に従ってインストールします。  
  ※既定で PATH に追加されます。管理者権限は不要です。
- 代替（お好みで）
  - **winget**: `winget install OpenJS.NodeJS.LTS`
  - **Chocolatey**: `choco install nodejs-lts -y`

インストール確認：
- `node -v` と `npm -v` がバージョンを表示すればOK。

### 2) ブリッジフォルダへ移動
- 例: `cd %USERPROFILE%\Documents\logbook-bridge`

### 3) package.json の作成（無い場合のみ）
- `npm init -y`

### 4) 依存パッケージwsのインストール（必須）
- `npm install ws`

### 5) 自己確認（任意）
- `dir node_modules\ws` で存在確認  
- `node -p "require.resolve('ws')"` で解決パスが表示されればOK

### 6) プロキシ環境で失敗する場合（任意）
- `npm config set proxy http://USER:PASS@proxy.host:port`  
- `npm config set https-proxy http://USER:PASS@proxy.host:port`

## クイックスタート
1. `start_poi.bat` をダブルクリックする
2. バッチが自動でやること  
   - (1) **logbook-kai-messageflow** に接続確認
   - (2) **poi** を `--remote-debugging-port=9222` 付きで起動  
   - (3) **ブリッジ** `poi_messageflow_bridge.js` を起動（落ちたら自動再起動・多重起動防止・ログ出力）
3. poi で艦これにログイン
4. ブリッジログファイルに以下が出ればOK  
    - `[2025-11-05 12:32:01.637][INFO] [ws] connected imageJson → ws://127.0.0.1:8890/imageJson/websocket`
    - `[2025-11-05 12:32:01.640][INFO] [ws] connected image → ws://127.0.0.1:8890/image/websocket`
    - `[2025-11-05 12:32:01.641][INFO] [ws] connected api → ws://127.0.0.1:8890/api/websocket`
    - `[2025-11-05 12:32:09.892][INFO] [api] sent (Fetch) /kcsapi/api_start2/getData (base64)`
    - `[2025-11-05 12:32:10.108][INFO] [api] sent (Fetch) /kcsapi/api_get_member/require_info (base64)`
    - `[2025-11-05 12:32:10.399][INFO] [api] sent (Fetch) /kcsapi/api_port/port (base64)`
5. messageflowの丸が緑、Queue（直近5分）が増えればOK

### messageflow の確認手順

#### 1) ステータス丸
- **緑（connect）**：少なくとも1系統（api / image / imageJson）が接続済み。ブリッジからの送信を受け取れる状態
- **赤（disconnect）**：どの系統も未接続。ブリッジやポート、messageflowの起動状態を確認

> 補足（詳細はブリッジ側ログで確認）
> - `[ws] connected api → ws://127.0.0.1:8890/api/websocket`
> - `[ws] connected image → ws://127.0.0.1:8890/image/websocket`
> - `[ws] connected imageJson → ws://127.0.0.1:8890/imageJson/websocket`

#### 2) Queue（直近5分）
- **場所**：messageflow 画面の「Queue（直近5分）」表示
- **内容**：過去5分間に受け取ったメッセージ数（ローリング集計）
  - **API** …… `/kcsapi/...`（getData / require_info / port / 出撃・演習の各種API）
  - **Image** …… `/kcs2/...` の画像・音声など（PNG/JPG/WebP/MP3 等）
  - **ImageJson** …… `/kcs2/...*.json`（UI定義やスプライト等）

**正常の目安**
- 丸が **緑**
- ブリッジの送信ログが出る  
  例：
  - `[api] sent (Fetch) /kcsapi/api_start2/getData`
  - `[api] sent (Fetch) /kcsapi/api_get_member/require_info`
  - `[api] sent (Fetch) /kcsapi/api_port/port`
  - `[image] sent /kcs2/...`
  - `[imageJson] sent /kcs2/...json`
- 直後に **Queue(直近5分)** の各カウントが増える  
  ※操作が止まれば 5 分で自然に下がる（ローリング）

#### 3) 代表的な“丸×Queue”の組み合わせと対処
- **丸が赤 / Queueが増えない**  
  → messageflowを再起動 → ブリッジ再起動 → poi で リロード
  → ポート **8890** の競合やセキュリティ製品のブロックを確認
- **丸は緑 / Queueが増えない**  
  → ゲーム側で対象通信が発生していない可能性  
  → 母港入り直しや編成/任務/出撃などに遷移して通信を発生  
  → ブリッジログに `[api] sent / [image] sent / [imageJson] sent` が出るか確認
- **Queueが多いまま減らないように見える**  
  → 継続的に操作していると増減を繰り返すため。何も操作せず **5分** 待てば下がる  
  → 稀に二重送信（旧拡張や別ブリッジ動作）疑い：poi側の送信機構は無効化し、Nodeブリッジの多重起動を停止

#### 4) すぐ試せる動作確認フロー
1. messageflow を起動（**丸の色**を確認）  
2. ブリッジを起動 → ログで `ws connected ...` を確認  
3. poi で艦これを開き、母港入り直し  
4. ブリッジログに  
   - `[api] sent (Fetch) /kcsapi/api_start2/getData`  
   - `.../require_info` / `.../port`  
   が出る → **Queue(API)** が増える
5. 編成・任務・出撃画面へ遷移 → **Image / ImageJson** の Queue が増える


## よくある質問
- logbook-kai-messageflow 丸が赤のまま → logbook-kai-messageflow再起動、8890の占有確認、ローカルWS許可
- 何も送られない → poiにデバッグポートが付いているか、ログの `attached: webview …kancolle` を確認
- `Error: Cannot find module 'ws'`→依存パッケージ`ws`がインストールされていません。**事前準備**を確認

## 設定（任意）
- logbook-kai-messageflowポート変更時はスクリプト先頭の WS URL を修正
- ログを減らしたい場合は `console.log` の頻度を調整

## ライセンス
- 本リポジトリの LICENSE を参照
