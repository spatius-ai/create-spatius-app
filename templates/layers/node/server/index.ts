import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { handleRequest } from '../worker/index.js';

const root = resolve('dist');
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = createServer((incoming, outgoing) => {
  void serve(incoming, outgoing);
});
async function serve(incoming: IncomingMessage, outgoing: ServerResponse) {
  try {
    const scheme = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const origin = `${scheme}://${incoming.headers.host ?? 'localhost'}`;
    const url = new URL(incoming.url ?? '/', origin);
    outgoing.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    outgoing.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (url.pathname.startsWith('/api/')) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const raw of incoming) {
        const chunk: unknown = raw;
        if (!Buffer.isBuffer(chunk)) throw new Error('Invalid request body');
        size += Buffer.byteLength(chunk);
        if (size > 64 * 1024) {
          outgoing.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const request = new Request(url, {
        method: incoming.method,
        headers,
        ...(['GET', 'HEAD'].includes(incoming.method ?? 'GET')
          ? {}
          : { body: Buffer.concat(chunks) }),
      });
      const response = await handleRequest(
        request,
        process.env as unknown as CloudflareBindings,
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method ?? '')) {
      outgoing.writeHead(405).end();
      return;
    }
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep) && path !== root) {
      outgoing.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(path)).isFile()) path = resolve(root, 'index.html');
    } catch {
      if (extname(path)) {
        outgoing.writeHead(404).end();
        return;
      }
      path = resolve(root, 'index.html');
    }
    const data = await readFile(path);
    outgoing.setHeader(
      'Content-Type',
      mime[extname(path)] ?? 'application/octet-stream',
    );
    outgoing.end(incoming.method === 'HEAD' ? undefined : data);
  } catch {
    outgoing.writeHead(500).end('Request failed.');
  }
}
server.listen(Number(process.env.PORT ?? 8787), '0.0.0.0');
process.on('SIGTERM', () => {
  server.close();
});
