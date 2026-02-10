const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');

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

// Migration: add language column if it doesn't exist
try {
    db.exec(`ALTER TABLE problems ADD COLUMN language TEXT DEFAULT 'javascript'`);
} catch (e) { /* column already exists */ }

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
    const { name, tree, globals, code, url, notes, language } = req.body;

    if (!name || !tree || !code) {
      return res.status(400).json({ error: 'Name, tree, and code are required' });
    }

    const result = db.prepare(`
      INSERT INTO problems (name, tree, globals, code, url, notes, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, tree, globals || '{}', code, url || null, notes || null, language || 'javascript');
    
    const newProblem = db.prepare('SELECT * FROM problems WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newProblem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update problem
app.put('/api/problems/:id', (req, res) => {
  try {
    const { name, tree, globals, code, url, notes, language } = req.body;

    const result = db.prepare(`
      UPDATE problems
      SET name = ?, tree = ?, globals = ?, code = ?, url = ?, notes = ?, language = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, tree, globals, code, url, notes, language || 'javascript', req.params.id);
    
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
      INSERT INTO problems (name, tree, globals, code, url, notes, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Use transaction for bulk insert
    const importMany = db.transaction((items) => {
      if (!merge) {
        db.prepare('DELETE FROM problems').run();
      }

      for (const p of items) {
        insert.run(p.name, p.tree, p.globals || '{}', p.code, p.url || null, p.notes || null, p.language || 'javascript');
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

// Preprocess LeetCode-style Python code into standalone functions
function preprocessPython(code) {
  // Remove all comment-only lines (LeetCode preamble, etc.)
  code = code.replace(/^\s*#.*$/gm, '');

  // Strip "class Solution:" wrapper and de-indent methods
  if (/^\s*class\s+\w+/m.test(code)) {
    const lines = code.split('\n');
    const result = [];
    let inClass = false;
    let methodIndent = -1;

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^class\s+\w+/.test(trimmed)) {
        inClass = true;
        methodIndent = -1;
        continue;
      }

      if (inClass) {
        if (trimmed === '') { result.push(''); continue; }

        const indent = line.search(/\S/);
        // If we hit a line at column 0, we've left the class
        if (indent === 0) { inClass = false; result.push(line); continue; }

        // Detect method indent from first def
        if (methodIndent < 0 && trimmed.startsWith('def ')) {
          methodIndent = indent;
        }

        result.push(methodIndent >= 0 ? line.slice(methodIndent) : line);
      } else {
        result.push(line);
      }
    }
    code = result.join('\n');
  }

  // Clean def lines: remove self, type annotations, return type
  code = code.replace(/def\s+(\w+)\s*\(([^)]*)\)\s*(?:->[^:]+)?:/g, (_match, name, params) => {
    const cleanParams = params.split(',')
      .map(p => p.trim())
      .filter(p => p && p !== 'self')
      .map(p => p.replace(/\s*:.*$/, ''))
      .join(', ');
    return `def ${name}(${cleanParams}):`;
  });

  // Replace self.method( with method(
  code = code.replace(/self\.(\w+)\s*\(/g, '$1(');

  return code;
}

// Build a self-contained Python script for tracing recursion
function buildPythonScript(userCode, treeJson, globalsJson) {
  // Preprocess LeetCode-style code (class/self/annotations)
  const code = preprocessPython(userCode);

  // Find all function definitions with their parameter lists
  const funcDefs = [];
  const defRegex = /def\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = defRegex.exec(code)) !== null) {
    const name = m[1];
    const paramsStr = m[2].trim();
    const params = paramsStr ? paramsStr.split(',').map(p => p.trim()) : [];
    funcDefs.push({ name, paramsStr, params });
  }

  if (funcDefs.length === 0) {
    throw new Error('Could not find function definition (expected "def funcName(...)")');
  }

  const mainFunc = funcDefs[0];
  const funcNames = funcDefs.map(f => f.name);

  // Rename all functions: def foo( -> def _original_foo(
  let processedCode = code;
  for (const name of funcNames) {
    processedCode = processedCode.replace(
      new RegExp(`def\\s+${name}\\s*\\(`),
      `def _original_${name}(`
    );
  }

  // Rewire all calls: foo( -> _wrapped_foo(
  for (const name of funcNames) {
    processedCode = processedCode.replace(
      new RegExp(`(?<!def\\s)(?<!_original_)(?<!_wrapped_)\\b${name}\\s*\\(`, 'g'),
      `_wrapped_${name}(`
    );
  }

  // Generate a wrapper for each function
  const wrappers = funcDefs.map(f => {
    const firstParam = f.params[0] || '_node';
    return `def _wrapped_${f.name}(${f.paramsStr}):
    _record_call("${f.name}", ${firstParam}, _globs)
    result = _original_${f.name}(${f.paramsStr})
    _record_return("${f.name}", ${firstParam}, _globs, result)
    return result`;
  }).join('\n\n');

  // Determine entry call arguments: first param -> _tree, 'globals' param -> _globs
  const mainCallArgs = mainFunc.params.map((p, i) => {
    if (i === 0) return '_tree';
    if (p === 'globals') return '_globs';
    return p;
  }).join(', ') || '_tree';

  return `
import sys, json, collections

sys.setrecursionlimit(500)

# ---------- TreeNode ----------
class TreeNode:
    def __init__(self, val, node_id):
        self.val = val
        self.id = node_id
        self.left = None
        self.right = None

def build_tree(arr):
    if not arr or arr[0] is None:
        return None
    root = TreeNode(arr[0], 0)
    queue = collections.deque([root])
    i = 1
    node_id = 1
    while queue and i < len(arr):
        node = queue.popleft()
        if i < len(arr) and arr[i] is not None:
            node.left = TreeNode(arr[i], node_id)
            node_id += 1
            queue.append(node.left)
        i += 1
        if i < len(arr) and arr[i] is not None:
            node.right = TreeNode(arr[i], node_id)
            node_id += 1
            queue.append(node.right)
        i += 1
    return root

# ---------- Tracing infrastructure ----------
_steps = []
_stack = []
_MAX_STEPS = 2000

class _StepLimitExceeded(Exception):
    pass

def _snap_globals(g):
    return {k: v for k, v in g.items()}

def _record_call(func_name, node, globs):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    node_val = node.val if node else None
    node_id = node.id if node else None
    _stack.append({"funcName": func_name, "nodeVal": node_val, "nodeId": node_id, "state": "active"})
    _steps.append({
        "type": "call",
        "funcName": func_name,
        "nodeVal": node_val,
        "nodeId": node_id,
        "stack": [dict(f) for f in _stack],
        "globals": _snap_globals(globs),
        "activeNode": node_id,
        "message": f"Call {func_name}({node_val if node_val is not None else 'null'})"
    })

def _record_return(func_name, node, globs, result):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    node_val = node.val if node else None
    node_id = node.id if node else None
    if _stack:
        _stack[-1]["state"] = "returning"
        _stack[-1]["result"] = result
    _steps.append({
        "type": "return",
        "funcName": func_name,
        "nodeVal": node_val,
        "nodeId": node_id,
        "result": result,
        "stack": [dict(f) for f in _stack],
        "globals": _snap_globals(globs),
        "returningNode": node_id,
        "message": f"Return {result} from {func_name}({node_val if node_val is not None else 'null'})"
    })
    if _stack:
        _stack.pop()

# ---------- User code (renamed) ----------
${processedCode}

# ---------- Wrappers ----------
${wrappers}

# ---------- Main ----------
try:
    _tree = build_tree(${treeJson})
    _globs = ${globalsJson}
    _wrapped_${mainFunc.name}(${mainCallArgs})
    print(json.dumps({"steps": _steps}))
except RecursionError:
    print(json.dumps({"error": "Maximum recursion depth exceeded (limit: 500)"}))
except _StepLimitExceeded as e:
    print(json.dumps({"error": str(e)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
}

// Execute Python code for recursion tracing
app.post('/api/execute-python', (req, res) => {
  const { code, tree, globals } = req.body;

  if (!code || !code.trim()) {
    return res.status(400).json({ error: 'No code provided' });
  }

  let script;
  try {
    const treeJson = JSON.stringify(tree || []);
    const globalsJson = JSON.stringify(globals || {});
    script = buildPythonScript(code, treeJson, globalsJson);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Write to temp file
  const tmpFile = path.join(os.tmpdir(), `rv_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(tmpFile, script);

  execFile('python3', [tmpFile], { timeout: 10000 }, (err, stdout, stderr) => {
    // Clean up temp file
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
      res.json(result);
    } catch (e) {
      res.json({ error: 'Failed to parse output from Python' });
    }
  });
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
