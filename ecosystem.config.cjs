/* eslint-disable */
/**
 * PM2 process manifest for Obsidian Sync.
 *
 * Two processes share the working directory but have independent ports:
 *   - obsidian-sync-web    → Next.js (port 3000)
 *   - obsidian-sync-socket → Socket.IO + Yjs (port 3001)
 *
 * Both read environment variables from the project's .env file (loaded by
 * Next.js itself for the web process, and explicitly via dotenv in
 * src/socket/server.ts for the socket process).
 *
 * Logs go to ${LOG_DIR} (defaults to /var/log/obsidian-sync, see install.sh).
 * pino-roll handles its own daily rotation per file inside the application;
 * the PM2 *_file paths below are PM2's own stdout/stderr capture for crash
 * diagnostics and start-up logs.
 */
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || '/var/log/obsidian-sync';

module.exports = {
  apps: [
    {
      name: 'obsidian-sync-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        OSYNC_PROCESS: 'web',
      },
      out_file: path.join(LOG_DIR, 'pm2-web.out.log'),
      error_file: path.join(LOG_DIR, 'pm2-web.error.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'obsidian-sync-socket',
      script: 'dist/socket/main.mjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      kill_timeout: 10000, // give graceful shutdown 10s to flush snapshots
      env: {
        NODE_ENV: 'production',
        OSYNC_PROCESS: 'socket',
      },
      out_file: path.join(LOG_DIR, 'pm2-socket.out.log'),
      error_file: path.join(LOG_DIR, 'pm2-socket.error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
