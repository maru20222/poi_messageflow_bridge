# poi_messageflow_bridge

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

- 本ブリッジは既定で **ファイルにログを出力**します。  
  - 場所（既定）: `%USERPROFILE%\Documents\logbook-bridge\poi_messageflow_bridge.log`

### ログに出る代表的な行
- `[ws] connected api → ws://127.0.0.1:8890/api/websocket`
- `[ws] connected image → ws://127.0.0.1:8890/image/websocket`
- `[ws] connected imageJson → ws://127.0.0.1:8890/imageJson/websocket`
- `[api] sent (Fetch) /kcsapi/api_start2/getData`
- `[api] sent (Fetch) /kcsapi/api_get_member/require_info`
- `[api] sent (Fetch) /kcsapi/api_port/port`
- `[image] sent /kcs2/...`
- `[imageJson] sent /kcs2/...json`


## クイックスタート
1. `start_poi.bat` をダブルクリックする
2. バッチが自動でやること  
   - (1) **logbook-kai-messageflow** に接続確認
   - (2) **poi** を `--remote-debugging-port=9222` 付きで起動  
   - (3) **ブリッジ** `poi_messageflow_bridge.js` を起動（落ちたら自動再起動・多重起動防止・ログ出力）
3. poi で艦これにログイン
4. ブリッジログファイルに以下が出ればOK  
   - `[ws] connected api/image/imageJson`  
   - `[api] sent (Fetch) /kcsapi/api_start2/getData`  
   - `[api] sent (Fetch) /kcsapi/api_get_member/require_info`  
   - `[api] sent (Fetch) /kcsapi/api_port/port`
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

## 設定（任意）
- logbook-kai-messageflowポート変更時はスクリプト先頭の WS URL を修正
- ログを減らしたい場合は `console.log` の頻度を調整

## ライセンス
- 本リポジトリの LICENSE を参照
