'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const { createApp } = require('./lib/createApp');

const PORT = process.env.PORT || 3000;

// Ensure db directory exists (not needed for :memory: but harmless)
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dbDir, 'problems.db');
const db = new Database(dbPath);

const app = createApp(db);

// Only start listening when this file is run directly (not when required in tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Recursive Visualizer running at http://localhost:${PORT}`);
  });

  process.on('SIGINT', () => {
    db.close();
    process.exit();
  });
}

module.exports = { app, db };
