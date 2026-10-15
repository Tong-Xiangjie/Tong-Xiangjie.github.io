// 极简静态服务器：让 headless Chrome 用 http:// 打开（file:// 下 localStorage 可能抛异常）
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');   // 仓库根
const port = +(process.argv[2] || 8099);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.png':'image/png',
               '.css':'text/css', '.json':'application/json', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('no'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404 ' + url); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
server.listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on http://127.0.0.1:' + port));
