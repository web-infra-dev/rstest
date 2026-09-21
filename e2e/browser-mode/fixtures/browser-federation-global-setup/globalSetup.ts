import { createServer } from 'node:http';
import { BROWSER_PORTS } from '../ports';

const remoteEntry = `globalThis.browser_setup_remote = {
  init() {},
  get() {
    return Promise.resolve(() => ({ __esModule: true, default: 'served-by-global-setup' }));
  },
};`;

export default async function globalSetup() {
  const server = createServer((request, response) => {
    if (request.url !== '/remoteEntry.js') {
      response.writeHead(404).end();
      return;
    }
    console.log('[federation-remote] requested');
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/javascript',
    });
    response.end(remoteEntry);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(
      BROWSER_PORTS['browser-federation-global-setup-remote'],
      '127.0.0.1',
      resolve,
    );
  });

  return async function globalTeardown() {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    console.log('[federation-global-teardown] executed');
  };
}
