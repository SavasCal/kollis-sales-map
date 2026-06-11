// `yarn dev` entry point: starts the app server, plus the mock JSONBin
// when .env points JSONBIN_BASE at localhost (i.e. no real account in play).
if ((process.env.JSONBIN_BASE || '').includes('localhost')) {
  await import('./mock-jsonbin.mjs');
}
await import('./dev-server.mjs');
