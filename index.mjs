if (process.env.APP_MODE === 'terminal') {
  await import('./terminal-server.mjs');
} else {
  await import('./static-server.mjs');
}
