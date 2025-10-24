// poi_messageflow_bridge.js (v6)
// 目的: poi の CDP Network/Fetch から /kcsapi と /kcs2(画像/.json/音声等) を取得し、
//       航海日誌改 MessageFlow へ SockJS 互換 WebSocketで送信（失敗時はHTTP POST）。
// 特徴: webview 明示アタッチ / session対応 / WS自動再接続 / キャッシュ無効化&クリア
//       /kcsapi は Fetch(Response) で確実に横取りして送信。

const http = require('http');
const https = require('https');
const { request: httpRequest } = require('http');
const WebSocket = require('ws');

// ===== 設定 =====
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
// target 選択用フィルタ（小文字で部分一致）
const FILTER = (process.env.FILTER || 'kcs|gadgets/ifr|osapi.dmm.com|play.games.dmm.com').toLowerCase();

// SockJS 直叩き WS エンドポイント
const WS_URLS = {
  api:       'ws://127.0.0.1:8890/api/websocket',
  image:     'ws://127.0.0.1:8890/image/websocket',
  imageJson: 'ws://127.0.0.1:8890/imageJson/websocket',
};

// HTTP フォールバック（保険）
const HTTP_FALLBACKS = {
  api:       ['http://127.0.0.1:8890/api'],
  image:     ['http://127.0.0.1:8890/image'],
  imageJson: ['http://127.0.0.1:8890/imageJson'],
};

process.on('SIGINT',  () => { console.log('[bridge] SIGINT received, exiting');  process.exit(0); });
process.on('SIGTERM', () => { console.log('[bridge] SIGTERM received, exiting'); process.exit(0); });

// ===== ユーティリティ =====
function getJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    lib.get(u, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function postJSON(url, obj) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(obj);
      const u = new URL(url);
      const req = httpRequest({
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 2000,
      }, (res) => { res.on('data', ()=>{}); res.on('end', resolve); });
      req.on('error', resolve);
      req.on('timeout', () => { try { req.destroy(); } catch {} ; resolve(); });
      req.write(body); req.end();
    } catch { resolve(); }
  });
}

// SockJS 直叩き用 WS（JSONをそのまま送る）
function makeSock(url, name) {
  let ws = null;
  let timer = null;
  let ready = false;

  const open = () => {
    try { ws = new WebSocket(url); } catch { schedule(); return; }
    ws.on('open',  () => { ready = true;  console.log(`[ws] connected ${name} → ${url}`); });
    ws.on('close', () => { ready = false; console.log(`[ws] closed ${name} ← ${url}`); schedule(); });
    ws.on('error', () => { ready = false; /* quiet */ });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(open, 1000); };
  const sendJson = (obj) => {
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(obj));
      return true;
    } catch { return false; }
  };

  open();
  return { sendJson, isReady: () => ready };
}

const wsApi       = makeSock(WS_URLS.api, 'api');
const wsImage     = makeSock(WS_URLS.image, 'image');
const wsImageJson = makeSock(WS_URLS.imageJson, 'imageJson');

function looksLikeBase64(s) {
  if (typeof s !== 'string' || s.length < 32) return false;
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(clean);
}

// ===== 本体 =====
(async () => {
  const targets = await getJSON(`http://${CDP_HOST}:${CDP_PORT}/json`);
  console.log('[bridge] targets:');
  targets.forEach((t, i) => console.log(`  [${i}] type=${t.type} url=${t.url}`));

  const pick = (arr) => {
    const re = new RegExp(FILTER);
    // webview優先 → page → その他
    let t = arr.find(t => (t.type === 'webview' || t.type === 'page') && re.test((t.url||'').toLowerCase()));
    if (!t) t = arr.find(t => t.type === 'webview');
    if (!t) t = arr.find(t => t.type === 'page');
    if (!t) t = arr[0];
    return t;
  };

  const target = pick(targets);
  if (!target || !target.webSocketDebuggerUrl) {
    console.error('[bridge] CDP target not found. Start poi with --remote-debugging-port=9222');
    process.exit(1);
  }
  console.log('[bridge] chosen target:', target.url);

  const cdp = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const send = (method, params = {}, sessionId = undefined) => {
    const msg = { id: ++seq, method, params };
    if (sessionId) msg.sessionId = sessionId;
    cdp.send(JSON.stringify(msg));
    return { id: seq, sessionId };
  };

  // requestId を sessionId と合わせて管理
  // key: `${sid||''}:${requestId}` -> { url, method, postData }
  const reqInfo = new Map();
  // getResponseBody / Fetch.getResponseBody 応答待ち
  // key: `${sid||''}:${id}` -> { url, method, postData, kind, fetchRequestId? }
  const pending = new Map();

  cdp.on('open', () => {
    console.log('[bridge] CDP connected');
    // root セッションで Network を準備（キャッシュ殺し）
    send('Network.enable');
    send('Network.setCacheDisabled', { cacheDisabled: true });
    send('Network.clearBrowserCache');
    // 新しいターゲットの検出と自動アタッチ
    send('Target.setDiscoverTargets', { discover: true });
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  });

  cdp.on('message', async (raw) => {
    const msg = JSON.parse(raw);
    const sid = msg.sessionId;

    // 新規 target（webview）を検出したら明示 attach
    if (msg.method === 'Target.targetCreated' && msg.params && msg.params.targetInfo) {
      const ti = msg.params.targetInfo;
      const url = (ti.url || '').toLowerCase();
      if (ti.type === 'webview' && (url.includes('play.games.dmm.com') || url.includes('kancolle'))) {
        send('Target.attachToTarget', { targetId: ti.targetId, flatten: true });
      }
    }

    // attachedToTarget: 各 session で Network/Fetch 準備（キャッシュ無効化＆getDataフック）
    if (msg.method === 'Target.attachedToTarget' && msg.params && msg.params.sessionId) {
      const ti = msg.params.targetInfo || {};
      console.log('[bridge] attached:', ti.type, ti.url);
      // Network 有効化 & キャッシュ抑止
      send('Network.enable', {}, msg.params.sessionId);
      send('Network.setCacheDisabled', { cacheDisabled: true }, msg.params.sessionId);
      send('Network.clearBrowserCache', {}, msg.params.sessionId);
      // /kcsapi/api_start2/getData を Response段階で横取り
      send('Fetch.enable', {
        patterns: [
          { urlPattern: '*://*/kcsapi/api_start2/getData*',        requestStage: 'Response' },
          { urlPattern: '*://*/kcsapi/api_get_member/require_info*', requestStage: 'Response' },
          { urlPattern: '*://*/kcsapi/api_port/port*',               requestStage: 'Response' }
        ]
      }, msg.params.sessionId);
      return;
    }

    // Fetch (Response stage) で getData を確実に確保
    if (msg.method === 'Fetch.requestPaused' && msg.params) {
      const p = msg.params; // {requestId, request, responseStatusCode, responseHeaders, networkId?}
      const url = (p.request && p.request.url) || '';

      if (url.includes('/kcsapi/')) {
        const cmd = send('Fetch.getResponseBody', { requestId: p.requestId }, sid);
        const pendKey = `${cmd.sessionId || ''}:${cmd.id}`;
        pending.set(pendKey, {
          url,
          method: (p.request && p.request.method) || 'GET',
          postData: '',
          kind: 'api_fetch',
          fetchRequestId: p.requestId
        });
        return; // 応答受信後に continueResponse する
      }

      // 対象外はそのまま続行
      send('Fetch.continueRequest', { requestId: p.requestId }, sid);
      return;
    }

    // 送信前: request 情報を保存（postDataも拾う）
    if (msg.method === 'Network.requestWillBeSent') {
      const { requestId, request } = msg.params || {};
      if (!requestId || !request || !request.url) return;
      const key = `${sid || ''}:${requestId}`;
      reqInfo.set(key, {
        url: request.url,
        method: request.method || 'GET',
        postData: request.postData || ''
      });
      return;
    }

    // レスポンス受信: /kcsapi, /kcs2 のみ本文取得
    if (msg.method === 'Network.responseReceived') {
      const p = msg.params || {};
      const key = `${sid || ''}:${p.requestId}`;
      const info = reqInfo.get(key);
      if (!info || !info.url) return;

      if (info.url.includes('/kcsapi/')) {
        const cmd = send('Network.getResponseBody', { requestId: p.requestId }, sid);
        const pendKey = `${cmd.sessionId || ''}:${cmd.id}`;
        pending.set(pendKey, { url: info.url, method: info.method, postData: info.postData, kind: 'api' });
        return;
      }

      if (info.url.includes('/kcs2/')) {
        const cmd = send('Network.getResponseBody', { requestId: p.requestId }, sid);
        const pendKey = `${cmd.sessionId || ''}:${cmd.id}`;
        pending.set(pendKey, { url: info.url, method: info.method, kind: 'kcs2' });
        return;
      }
      return;
    }

    // 本文応答（Network.getResponseBody / Fetch.getResponseBody）
    if (msg.id) {
      const pendKey = `${sid || ''}:${msg.id}`;
      if (!pending.has(pendKey)) return;
      const meta = pending.get(pendKey);
      pending.delete(pendKey);

      const res = msg.result;
      if (!res || typeof res.body !== 'string') return;

      // Fetch 経由で確保した getData
      if (meta.kind === 'api_fetch') {
        const u   = new URL(meta.url);
        const uri = u.pathname + (u.search || '');
        const qs  = u.search || '';
        const qp  = Object.fromEntries(u.searchParams.entries());

        const isB64 = !!res.base64Encoded;
        const payload = {
          method: meta.method || 'GET',
          encoding: isB64 ? 'base64' : '',
          uri, queryString: qs, queryParams: qp,
          postData: meta.postData || '',
          responseBody: res.body
        };

        let ok = wsApi.isReady() && wsApi.sendJson(payload);
        if (!ok) {
          for (const u2 of HTTP_FALLBACKS.api) { /* eslint-disable no-await-in-loop */
            await postJSON(u2, payload);
            ok = true; break;
          }
        }
        if (ok) console.log('[api] sent (Fetch) /kcsapi/api_start2/getData', isB64 ? '(base64)' : '');

        // ブラウザにレスポンスを返して継続
        send('Fetch.continueResponse', { requestId: meta.fetchRequestId }, sid);
        return;
      }

      // Network 経由の /kcsapi
      if (meta.kind === 'api') {
        const u   = new URL(meta.url);
        const uri = u.pathname + (u.search || '');
        const qs  = u.search || '';
        const qp  = Object.fromEntries(u.searchParams.entries());

        const isB64 = !!res.base64Encoded;
        const payload = {
          method: meta.method || 'GET',
          encoding: isB64 ? 'base64' : '',
          uri, queryString: qs, queryParams: qp,
          postData: meta.postData || '',
          responseBody: res.body
        };

        let ok = wsApi.isReady() && wsApi.sendJson(payload);
        if (!ok) {
          for (const u2 of HTTP_FALLBACKS.api) { /* eslint-disable no-await-in-loop */
            await postJSON(u2, payload);
            ok = true; break;
          }
        }
        if (ok && Math.random() < 0.1) console.log('[api] sent', uri, isB64 ? '(base64)' : '');
        return;
      }

      // /kcs2: .json or 画像/音声など
      const u   = new URL(meta.url);
      const uri = u.pathname + (u.search || '');
      const qs  = u.search || '';
      const qp  = Object.fromEntries(u.searchParams.entries());

      if (/\.json($|\?)/i.test(uri)) {
        const payload = {
          method: meta.method || 'GET',
          encoding: '',
          uri, queryString: qs, queryParams: qp,
          postData: '',
          responseBody: res.body,
        };
        let ok = wsImageJson.isReady() && wsImageJson.sendJson(payload);
        if (!ok) {
          for (const u2 of HTTP_FALLBACKS.imageJson) { /* eslint-disable no-await-in-loop */
            await postJSON(u2, payload);
            ok = true; break;
          }
        }
        if (ok && Math.random() < 0.1) console.log('[imageJson] sent', uri);
      } else {
        const b64 = res.base64Encoded ? res.body
                 : (looksLikeBase64(res.body) ? res.body
                 : Buffer.from(res.body, 'utf8').toString('base64'));
        const payload = {
          method: meta.method || 'GET',
          encoding: 'base64',
          uri, queryString: qs, queryParams: qp,
          postData: '',
          responseBody: b64,
        };
        let ok = wsImage.isReady() && wsImage.sendJson(payload);
        if (!ok) {
          for (const u2 of HTTP_FALLBACKS.image) { /* eslint-disable no-await-in-loop */
            await postJSON(u2, payload);
            ok = true; break;
          }
        }
        if (ok && Math.random() < 0.05) console.log('[image] sent', uri, 'len=', b64.length);
      }
    }
  });

  cdp.on('close', () => console.log('[bridge] CDP closed'));
  cdp.on('error', (e) => console.log('[bridge] CDP error', e && e.message));
})();
