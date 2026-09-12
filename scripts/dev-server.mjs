// scripts/dev-server.mjs
// Zero-dependency static file server for local preview only. Not shipped as
// part of the app (GitHub Pages serves index.html directly) -- this exists
// purely so `fetch('data/program.json')` works during development, since
// fetch is blocked under file:// in most browsers.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.PORT || 5173;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = normalize(join(ROOT, urlPath === '/' ? '/index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    const st = await stat(filePath).catch(() => null);
    if (st && st.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`Dev server running at http://localhost:${PORT}`));
