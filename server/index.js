// Local / self-hosted server: serves the built app (dist/) and the API from server/api.js.
// On Netlify this file isn't used — netlify/functions/api.mjs runs the same API.
//   npm run build && npm start   →  http://localhost:8787
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handleApi } from './api.js';

const PORT = process.env.PORT || 8787;
const app = express();
app.disable('x-powered-by');

// Hand /api requests to the shared handler as standard web Requests
app.use('/api', express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
  const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body?.length;
  const response = await handleApi(new Request(`http://localhost${req.originalUrl}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
    body: hasBody ? req.body : undefined,
  }));
  res.status(response.status);
  response.headers.forEach((v, k) => res.set(k, v));
  res.send(Buffer.from(await response.arrayBuffer()));
});

// The built app
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => console.log(`Shop Khata on http://localhost:${PORT}`));
