/* 最小复现：position:relative + padding 的父元素，绝对定位子元素 top:0 落在哪？ */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9345;
const profile = mkdtempSync(join(tmpdir(), 'asmin-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('no devtools');
}
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

const HTML = `<!doctype html><meta charset=utf-8>
<style>
  html,body{margin:0;padding:0}
  .stage{width:794px;height:1123px;position:relative}
  .outer{position:relative;border:1px solid #000;padding:7.93701px;margin:0}
  .flow{height:20px;background:#ccc}
  .abs{position:absolute;top:0;left:0;width:10px;height:10px;background:red}
  .abs2{position:absolute;top:5mm;left:20px;width:10px;height:10px;background:blue}
</style>
<div class=stage>
  <div class=outer id=outer>
    <div class=abs id=abs></div>
    <div class=flow id=flow></div>
    <div class=abs2 id=abs2></div>
  </div>
</div>`;

await send('Page.enable');
await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML) });
await sleep(1500);

const EXPR = `(() => {
  const px2mm = 25.4/96;
  const outer = document.getElementById('outer');
  const o = outer.getBoundingClientRect();
  const r = (id) => { const e = document.getElementById(id).getBoundingClientRect(); return Math.round((e.top - o.top)*px2mm*1000)/1000; };
  const cs = getComputedStyle(outer);
  return {
    borderTop: cs.borderTopWidth, padTop: cs.paddingTop, position: cs.position,
    absAt0MM: r('abs'), flowTopMM: r('flow'), absAt5mm: r('abs2')
  };
})()`;
const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log('MINIMAL =', JSON.stringify(res.result?.result?.value, null, 1));
ws.close(); chrome.kill(); process.exit(0);
