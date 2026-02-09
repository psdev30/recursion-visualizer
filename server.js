const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'db', 'problems.db'));

// Create tables
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

// API Routes

// GET all problems
app.get('/api/problems', (req, res) => {
  try {
    const problems = db.prepare(`
      SELECT * FROM problems ORDER BY created_at DESC
    `).all();
    res.json(problems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single problem
app.get('/api/problems/:id', (req, res) => {
  try {
    const problem = db.prepare(`
      SELECT * FROM problems WHERE id = ?
    `).get(req.params.id);
    
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    res.json(problem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new problem
app.post('/api/problems', (req, res) => {
  try {
    const { name, tree, globals, code, url, notes } = req.body;
    
    if (!name || !tree || !code) {
      return res.status(400).json({ error: 'Name, tree, and code are required' });
    }
    
    const result = db.prepare(`
      INSERT INTO problems (name, tree, globals, code, url, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, tree, globals || '{}', code, url || null, notes || null);
    
    const newProblem = db.prepare('SELECT * FROM problems WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newProblem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update problem
app.put('/api/problems/:id', (req, res) => {
  try {
    const { name, tree, globals, code, url, notes } = req.body;
    
    const result = db.prepare(`
      UPDATE problems 
      SET name = ?, tree = ?, globals = ?, code = ?, url = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, tree, globals, code, url, notes, req.params.id);
    
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

// POST bulk import
app.post('/api/problems/import', (req, res) => {
  try {
    const { problems, merge } = req.body;
    
    if (!Array.isArray(problems)) {
      return res.status(400).json({ error: 'Problems must be an array' });
    }
    
    const insert = db.prepare(`
      INSERT INTO problems (name, tree, globals, code, url, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    // Use transaction for bulk insert
    const importMany = db.transaction((items) => {
      if (!merge) {
        db.prepare('DELETE FROM problems').run();
      }
      
      for (const p of items) {
        insert.run(p.name, p.tree, p.globals || '{}', p.code, p.url || null, p.notes || null);
      }
    });
    
    importMany(problems);
    
    const allProblems = db.prepare('SELECT * FROM problems ORDER BY created_at DESC').all();
    res.json({ imported: problems.length, problems: allProblems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET export all problems
app.get('/api/problems/export/all', (req, res) => {
  try {
    const problems = db.prepare('SELECT * FROM problems ORDER BY created_at DESC').all();
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      problems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Recursive Visualizer running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit();
});
