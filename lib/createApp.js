'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');

const {
  buildLineMap,
  buildPythonScript,
  buildGraphPythonScript,
  buildBacktrackPythonScript,
  buildBuildTreePythonScript,
} = require('./pythonScripts');

/**
 * Initialize the problems table and run migrations on the provided database.
 * Safe to call multiple times (uses IF NOT EXISTS).
 *
 * @param {import('better-sqlite3').Database} db
 */
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tree TEXT NOT NULL,
      globals TEXT DEFAULT '{}',
      code TEXT NOT NULL,
      url TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_problems_name ON problems(name);
    CREATE INDEX IF NOT EXISTS idx_problems_created ON problems(created_at);
  `);

  // Migrations — ignore errors when columns already exist
  try { db.exec(`ALTER TABLE problems ADD COLUMN language TEXT DEFAULT 'javascript'`); } catch (_) {}
  try { db.exec(`ALTER TABLE problems ADD COLUMN mode TEXT DEFAULT 'tree'`); } catch (_) {}
}

/**
 * Create and configure the Express application.
 *
 * @param {import('better-sqlite3').Database} db - An already-open SQLite database instance
 * @returns {import('express').Application}
 */
function createApp(db) {
  initDb(db);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ── Problems CRUD ──────────────────────────────────────────────────────────

  // GET all problems
  app.get('/api/problems', (req, res) => {
    try {
      const problems = db.prepare(`SELECT * FROM problems ORDER BY created_at DESC`).all();
      res.json(problems);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST bulk import — must be registered BEFORE /:id to avoid route shadowing
  app.post('/api/problems/import', (req, res) => {
    try {
      const { problems, merge } = req.body;

      if (!Array.isArray(problems)) {
        return res.status(400).json({ error: 'Problems must be an array' });
      }

      const insert = db.prepare(`
        INSERT INTO problems (name, tree, globals, code, url, notes, language, mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const importMany = db.transaction((items) => {
        if (!merge) {
          db.prepare('DELETE FROM problems').run();
        }
        for (const p of items) {
          insert.run(
            p.name, p.tree, p.globals || '{}', p.code,
            p.url || null, p.notes || null,
            p.language || 'javascript', p.mode || 'tree'
          );
        }
      });

      importMany(problems);

      const allProblems = db.prepare('SELECT * FROM problems ORDER BY created_at DESC').all();
      res.json({ imported: problems.length, problems: allProblems });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET export all problems — must be registered BEFORE /:id
  app.get('/api/problems/export/all', (req, res) => {
    try {
      const problems = db.prepare('SELECT * FROM problems ORDER BY created_at DESC').all();
      res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        problems,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single problem
  app.get('/api/problems/:id', (req, res) => {
    try {
      const problem = db.prepare(`SELECT * FROM problems WHERE id = ?`).get(req.params.id);
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
      res.json(problem);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create new problem
  app.post('/api/problems', (req, res) => {
    try {
      const { name, tree, globals, code, url, notes, language, mode } = req.body;

      if (!name || !tree || !code) {
        return res.status(400).json({ error: 'Name, tree, and code are required' });
      }

      const result = db.prepare(`
        INSERT INTO problems (name, tree, globals, code, url, notes, language, mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, tree, globals || '{}', code, url || null, notes || null, language || 'javascript', mode || 'tree');

      const newProblem = db.prepare('SELECT * FROM problems WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json(newProblem);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update problem
  app.put('/api/problems/:id', (req, res) => {
    try {
      const { name, tree, globals, code, url, notes, language, mode } = req.body;

      if (!name || !tree || !code) {
        return res.status(400).json({ error: 'Name, tree, and code are required' });
      }

      const result = db.prepare(`
        UPDATE problems
        SET name = ?, tree = ?, globals = ?, code = ?, url = ?, notes = ?,
            language = ?, mode = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, tree, globals, code, url, notes, language || 'javascript', mode || 'tree', req.params.id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Problem not found' });
      }

      const updated = db.prepare('SELECT * FROM problems WHERE id = ?').get(req.params.id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE problem
  app.delete('/api/problems/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM problems WHERE id = ?').run(req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Problem not found' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Python execution ───────────────────────────────────────────────────────

  app.post('/api/execute-python', (req, res) => {
    const { code, tree, tree2, graph, startNode, candidates, target, args, globals, mode, leetcode } = req.body;
    const isLeetCode = leetcode !== false; // default true

    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'No code provided' });
    }

    let script;
    const lm = buildLineMap(code);

    try {
      const globalsJson = JSON.stringify(typeof globals === 'object' && globals !== null ? globals : {});

      if (mode === 'graph') {
        const adjListJson = JSON.stringify(graph || {});
        script = buildGraphPythonScript(code, adjListJson, startNode || 0, globalsJson, isLeetCode);
      } else if (mode === 'backtrack') {
        const candidatesJson = JSON.stringify(candidates || []);
        // Default target to null — JSON.stringify(undefined) returns undefined (not a string),
        // which would throw a TypeError when .replace() is called on it.
        script = buildBacktrackPythonScript(code, candidatesJson, target !== undefined ? target : null, globalsJson, isLeetCode);
      } else if (mode === 'buildtree') {
        const argsJson = JSON.stringify(args || {});
        script = buildBuildTreePythonScript(code, argsJson, globalsJson, isLeetCode);
      } else {
        const treeJson = JSON.stringify(tree || []);
        const tree2Json = tree2 ? JSON.stringify(tree2) : null;
        script = buildPythonScript(code, treeJson, globalsJson, tree2Json, isLeetCode);
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const tmpFile = path.join(os.tmpdir(), `rv_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    fs.writeFileSync(tmpFile, script);

    execFile('python3', [tmpFile], { timeout: 10000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}

      if (err) {
        if (err.killed) {
          return res.json({ error: 'Execution timed out (10s limit)' });
        }
        const msg = stderr ? stderr.split('\n').filter(Boolean).pop() : err.message;
        return res.json({ error: msg || 'Execution failed' });
      }

      try {
        const result = JSON.parse(stdout);
        result.lineMap = lm;
        res.json(result);
      } catch (_) {
        res.json({ error: 'Failed to parse output from Python' });
      }
    });
  });

  // ── Frontend ───────────────────────────────────────────────────────────────

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

module.exports = { createApp, initDb };
