/**
 * minimal-cdp.mjs —— 极简 Chrome DevTools Protocol 客户端（零依赖）
 *
 * 用 Node 内置的 net + crypto 手写 WebSocket 客户端，避免为了跑测试而安装依赖
 * （本机 npm.ps1 被执行策略拦住，不适合引入 npm 依赖）。
 *
 * 只实现需要的部分：connect / send / 事件订阅 / Runtime.evaluate。
 */

import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * 找出本机可用的 Chromium 系浏览器（Chrome 优先，退到 Edge）。
 *
 * 为什么要有这个函数：以前每个套件都把 Chrome 路径写死在代码里，
 * 一共写了 12 遍。结果用户某天卸载 Chrome 之后，**整套测试全挂**，
 * 报的还是 `spawn ...chrome.exe ENOENT` 这种跟被测代码毫无关系的错，
 * 排查半天才发现是环境问题。路径只该有一个来源。
 *
 * 另外支持用环境变量覆盖，方便在别的机器/便携版上跑：
 *   $env:DSH_BROWSER = 'D:\chrome-win64\chrome.exe'; node tools/run-all.mjs
 */
export function findBrowser() {
  const env = process.env.DSH_BROWSER;
  if (env && existsSync(env)) return env;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    // 非 Windows 也顺手支持，省得以后换机器再改一遍
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    '找不到 Chrome / Edge。装一个，或用 $env:DSH_BROWSER 指定可执行文件路径。'
  );
}

/** 取回 http://host:port/json/version 里的 webSocketDebuggerUrl */
export function fetchDebuggerUrl(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/json/version', timeout: 3000 },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              if (json.webSocketDebuggerUrl) resolve(json.webSocketDebuggerUrl);
              else retry();
            } catch {
              retry();
            }
          });
        }
      );
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
      function retry() {
        if (Date.now() > deadline) {
          reject(new Error(`等待 CDP 端口 ${port} 超时`));
          return;
        }
        setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}

/** 列出可调试的页面 target，返回第一个 page 的 webSocketDebuggerUrl */
export function fetchPageTarget(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/json/list', timeout: 3000 },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            try {
              const list = JSON.parse(body);
              const page = list.find(
                (t) => t.type === 'page' && t.webSocketDebuggerUrl
              );
              if (page) resolve(page);
              else retry();
            } catch {
              retry();
            }
          });
        }
      );
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
      function retry() {
        if (Date.now() > deadline) {
          reject(new Error(`等待页面 target 超时（端口 ${port}）`));
          return;
        }
        setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}

export class CDP extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
  }

  static async connect(wsUrl) {
    const cdp = new CDP();
    await cdp.#open(wsUrl);
    return cdp;
  }

  #open(wsUrl) {
    return new Promise((resolve, reject) => {
      const url = new URL(wsUrl);
      const key = crypto.randomBytes(16).toString('base64');
      const socket = net.connect(
        { host: url.hostname, port: Number(url.port) || 80 },
        () => {
          socket.write(
            [
              `GET ${url.pathname}${url.search} HTTP/1.1`,
              `Host: ${url.host}`,
              'Upgrade: websocket',
              'Connection: Upgrade',
              `Sec-WebSocket-Key: ${key}`,
              'Sec-WebSocket-Version: 13',
              '',
              ''
            ].join('\r\n')
          );
        }
      );

      this.socket = socket;

      const onData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.upgraded) {
          const idx = this.buffer.indexOf('\r\n\r\n');
          if (idx === -1) return;
          const head = this.buffer.slice(0, idx).toString('latin1');
          this.buffer = this.buffer.slice(idx + 4);
          if (!/HTTP\/1\.1 101/.test(head)) {
            reject(new Error('WebSocket 握手失败:\n' + head));
            return;
          }
          const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head);
          const expected = crypto
            .createHash('sha1')
            .update(key + WS_GUID)
            .digest('base64');
          if (!accept || accept[1] !== expected) {
            reject(new Error('WebSocket accept 校验失败'));
            return;
          }
          this.upgraded = true;
          socket.removeListener('data', onData);
          socket.on('data', (c) => this.#onFrameData(c));
          if (this.buffer.length) this.#onFrameData(Buffer.alloc(0));
          resolve();
        }
      };

      socket.on('data', onData);
      socket.on('error', (e) => {
        this.closed = true;
        reject(e);
      });
      socket.on('close', () => {
        this.closed = true;
        this.emit('close');
      });
    });
  }

  #onFrameData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < offset + 2) return;
        len = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this.buffer.length < offset + 8) return;
        const big = this.buffer.readBigUInt64BE(offset);
        if (big > 64n * 1024n * 1024n) throw new Error('帧过大');
        len = Number(big);
        offset += 8;
      }

      let maskKey = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + len) return;
      let payload = this.buffer.slice(offset, offset + len);
      this.buffer = this.buffer.slice(offset + len);

      if (maskKey) {
        const copy = Buffer.from(payload);
        for (let i = 0; i < copy.length; i++) copy[i] ^= maskKey[i % 4];
        payload = copy;
      }

      if (opcode === 0x8) {
        this.closed = true;
        this.emit('close');
        return;
      }
      if (opcode === 0x9) {
        this.#sendFrame(payload, 0xa);
        continue;
      }
      if (opcode === 0xa) continue;

      // 分片：只处理单帧文本（CDP 消息一般不会被分片）
      if (!fin) {
        this.fragment = Buffer.concat([this.fragment || Buffer.alloc(0), payload]);
        continue;
      }
      const full =
        this.fragment && this.fragment.length
          ? Buffer.concat([this.fragment, payload])
          : payload;
      this.fragment = null;

      if (opcode === 0x1 || opcode === 0x0) {
        let msg;
        try {
          msg = JSON.parse(full.toString('utf8'));
        } catch {
          continue;
        }
        this.#handleMessage(msg);
      }
    }
  }

  #handleMessage(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method) this.emit('event', msg);
  }

  #sendFrame(payload, opcode = 0x1) {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error('WebSocket 已关闭');

    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    const len = data.length;
    let header;

    if (len < 126) {
      header = Buffer.alloc(6);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(8);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(14);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;

    const maskKey = crypto.randomBytes(4);
    maskKey.copy(header, header.length - 4);
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= maskKey[i % 4];

    socket.write(Buffer.concat([header, masked]));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.#sendFrame(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 调用超时: ${method}`));
        }
      }, 60000);
    });
  }

  /** 在页面里执行表达式；awaitPromise 让 async 表达式可用 */
  async evaluate(expression, { awaitPromise = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: true
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const desc =
        (d.exception && (d.exception.description || d.exception.value)) ||
        d.text ||
        '未知错误';
      throw new Error(`页面内执行出错: ${desc}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try {
      this.#sendFrame(Buffer.alloc(0), 0x8);
    } catch {
      /* ignore */
    }
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}
