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

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Initialize SQLite database
const db = new Database(path.join(dbDir, 'problems.db'));

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

// Migration: add mode column if it doesn't exist
try {
    db.exec(`ALTER TABLE problems ADD COLUMN mode TEXT DEFAULT 'tree'`);
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

    const result = db.prepare(`
      UPDATE problems
      SET name = ?, tree = ?, globals = ?, code = ?, url = ?, notes = ?, language = ?, mode = ?, updated_at = CURRENT_TIMESTAMP
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

// POST bulk import
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

    // Use transaction for bulk insert
    const importMany = db.transaction((items) => {
      if (!merge) {
        db.prepare('DELETE FROM problems').run();
      }

      for (const p of items) {
        insert.run(p.name, p.tree, p.globals || '{}', p.code, p.url || null, p.notes || null, p.language || 'javascript', p.mode || 'tree');
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
function buildPythonScript(userCode, treeJson, globalsJson, tree2Json) {
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

  // Detect two-tree mode: main function has 2+ non-globals params and tree2 data provided
  const mainTreeParams = mainFunc.params.filter(p => p !== 'globals');
  const twoTreeMode = tree2Json && mainTreeParams.length >= 2;

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
    if (twoTreeMode) {
      const treeParams = f.params.filter(p => p !== 'globals');
      if (treeParams.length >= 2) {
        const p1 = treeParams[0];
        const p2 = treeParams[1];
        return `def _wrapped_${f.name}(${f.paramsStr}):
    _record_call_2t("${f.name}", ${p1}, ${p2}, _globs)
    result = _original_${f.name}(${f.paramsStr})
    _record_return_2t("${f.name}", ${p1}, ${p2}, _globs, result)
    return result`;
      }
    }
    const firstParam = f.params[0] || '_node';
    return `def _wrapped_${f.name}(${f.paramsStr}):
    _record_call("${f.name}", ${firstParam}, _globs)
    result = _original_${f.name}(${f.paramsStr})
    _record_return("${f.name}", ${firstParam}, _globs, result)
    return result`;
  }).join('\n\n');

  // Determine entry call arguments
  const mainCallArgs = mainFunc.params.map((p, i) => {
    if (twoTreeMode) {
      if (i === 0) return '_tree1';
      if (i === 1 && mainTreeParams.length >= 2 && p !== 'globals') return '_tree2';
    } else {
      if (i === 0) return '_tree';
    }
    if (p === 'globals') return '_globs';
    return p;
  }).join(', ') || '_tree';

  // Convert JSON literals to Python equivalents
  const treePy = treeJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const globalsPy = globalsJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const tree2Py = tree2Json ? tree2Json.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False') : null;

  // Two-tree tracing functions
  const twoTreeTracing = twoTreeMode ? `
def _record_call_2t(func_name, node1, node2, globs):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    n1_val = node1.val if node1 else None
    n1_id = node1.id if node1 else None
    n2_val = node2.val if node2 else None
    n2_id = node2.id if node2 else None
    _stack.append({"funcName": func_name, "nodeVal": n1_val, "nodeId": n1_id, "nodeVal2": n2_val, "nodeId2": n2_id, "state": "active"})
    _steps.append({
        "type": "call",
        "funcName": func_name,
        "nodeVal": n1_val,
        "nodeId": n1_id,
        "nodeVal2": n2_val,
        "nodeId2": n2_id,
        "stack": [dict(f) for f in _stack],
        "globals": _snap_globals(globs),
        "activeNode": n1_id,
        "activeNode2": n2_id,
        "message": f"Call {func_name}({n1_val if n1_val is not None else 'null'}, {n2_val if n2_val is not None else 'null'})"
    })

def _record_return_2t(func_name, node1, node2, globs, result):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    n1_val = node1.val if node1 else None
    n1_id = node1.id if node1 else None
    n2_val = node2.val if node2 else None
    n2_id = node2.id if node2 else None
    if _stack:
        _stack[-1]["state"] = "returning"
        _stack[-1]["result"] = result
    _steps.append({
        "type": "return",
        "funcName": func_name,
        "nodeVal": n1_val,
        "nodeId": n1_id,
        "nodeVal2": n2_val,
        "nodeId2": n2_id,
        "result": result,
        "stack": [dict(f) for f in _stack],
        "globals": _snap_globals(globs),
        "returningNode": n1_id,
        "returningNode2": n2_id,
        "message": f"Return {result} from {func_name}({n1_val if n1_val is not None else 'null'}, {n2_val if n2_val is not None else 'null'})"
    })
    if _stack:
        _stack.pop()
` : '';

  // Main block differs for two-tree mode
  const mainBlock = twoTreeMode ? `
try:
    _tree1 = build_tree(${treePy})
    _tree2 = build_tree(${tree2Py}, id_offset=1000)
    _globs = ${globalsPy}
    _wrapped_${mainFunc.name}(${mainCallArgs})
    print(json.dumps({"steps": _steps, "twoTree": True}))
except RecursionError:
    print(json.dumps({"error": "Maximum recursion depth exceeded (limit: 500)"}))
except _StepLimitExceeded as e:
    print(json.dumps({"error": str(e)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
` : `
try:
    _tree = build_tree(${treePy})
    _globs = ${globalsPy}
    _wrapped_${mainFunc.name}(${mainCallArgs})
    print(json.dumps({"steps": _steps}))
except RecursionError:
    print(json.dumps({"error": "Maximum recursion depth exceeded (limit: 500)"}))
except _StepLimitExceeded as e:
    print(json.dumps({"error": str(e)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

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

def build_tree(arr, id_offset=0):
    if not arr or arr[0] is None:
        return None
    root = TreeNode(arr[0], id_offset)
    queue = collections.deque([root])
    i = 1
    node_id = id_offset + 1
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
${twoTreeTracing}
# ---------- User code (renamed) ----------
${processedCode}

# ---------- Wrappers ----------
${wrappers}

# ---------- Main ----------
${mainBlock}
`;
}

// Build line map from original code (funcName -> line number)
function buildLineMap(code) {
  const map = {};
  code.split('\n').forEach((line, i) => {
    const m = line.match(/def\s+(\w+)\s*\(/);
    if (m) map[m[1]] = i + 1;
  });
  return map;
}

// Build Python script for graph traversal tracing
function buildGraphPythonScript(userCode, adjListJson, startNode, globalsJson) {
  const code = preprocessPython(userCode);

  const funcDefs = [];
  const defRegex = /def\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = defRegex.exec(code)) !== null) {
    funcDefs.push({ name: m[1], paramsStr: m[2].trim(), params: m[2].trim() ? m[2].trim().split(',').map(p => p.trim()) : [] });
  }

  if (funcDefs.length === 0) {
    throw new Error('Could not find function definition (expected "def funcName(...)")');
  }

  const mainFunc = funcDefs[0];
  const funcNames = funcDefs.map(f => f.name);

  // Rename & rewire
  let processedCode = code;
  for (const name of funcNames) {
    processedCode = processedCode.replace(new RegExp(`def\\s+${name}\\s*\\(`), `def _original_${name}(`);
  }
  for (const name of funcNames) {
    processedCode = processedCode.replace(
      new RegExp(`(?<!def\\s)(?<!_original_)(?<!_wrapped_)\\b${name}\\s*\\(`, 'g'),
      `_wrapped_${name}(`
    );
  }

  // Wrappers — first param is graph node ID (int)
  const wrappers = funcDefs.map(f => {
    const firstParam = f.params[0] || '_node';
    return `def _wrapped_${f.name}(${f.paramsStr}):
    _record_call("${f.name}", ${firstParam}, _globs)
    result = _original_${f.name}(${f.paramsStr})
    _record_return("${f.name}", ${firstParam}, _globs, result)
    return result`;
  }).join('\n\n');

  // Entry args: first param -> start_node, 'graph' -> _graph, 'visited' -> _visited, 'globals' -> _globs
  const mainCallArgs = mainFunc.params.map((p, i) => {
    if (i === 0) return `${startNode}`;
    if (p === 'graph') return '_graph';
    if (p === 'visited') return '_visited';
    if (p === 'globals') return '_globs';
    return p;
  }).join(', ');

  const adjPy = adjListJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const globalsPy = globalsJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');

  return `
import sys, json

sys.setrecursionlimit(500)

# ---------- Tracing infrastructure ----------
_steps = []
_stack = []
_MAX_STEPS = 2000

class _StepLimitExceeded(Exception):
    pass

def _snap_globals(g):
    return {k: v for k, v in g.items()}

def _serialize(v):
    if isinstance(v, set):
        return list(v)
    return v

def _record_call(func_name, node_id, globs):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    _stack.append({"funcName": func_name, "nodeVal": node_id, "nodeId": node_id, "state": "active"})
    _steps.append({
        "type": "call",
        "funcName": func_name,
        "nodeVal": node_id,
        "nodeId": node_id,
        "stack": [dict(f) for f in _stack],
        "globals": {k: _serialize(v) for k, v in globs.items()},
        "activeNode": node_id,
        "message": f"Call {func_name}({node_id})"
    })

def _record_return(func_name, node_id, globs, result):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    if _stack:
        _stack[-1]["state"] = "returning"
        _stack[-1]["result"] = _serialize(result)
    _steps.append({
        "type": "return",
        "funcName": func_name,
        "nodeVal": node_id,
        "nodeId": node_id,
        "result": _serialize(result),
        "stack": [dict(f) for f in _stack],
        "globals": {k: _serialize(v) for k, v in globs.items()},
        "returningNode": node_id,
        "message": f"Return {_serialize(result)} from {func_name}({node_id})"
    })
    if _stack:
        _stack.pop()

# ---------- User code (renamed) ----------
${processedCode}

# ---------- Wrappers ----------
${wrappers}

# ---------- Main ----------
try:
    _graph = {int(k): v for k, v in (${adjPy}).items()}
    _visited = set()
    _globs = ${globalsPy}
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

// Build Python script for backtracking tracing
function buildBacktrackPythonScript(userCode, candidatesJson, targetJson, globalsJson) {
  const code = preprocessPython(userCode);

  const funcDefs = [];
  const defRegex = /def\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = defRegex.exec(code)) !== null) {
    funcDefs.push({ name: m[1], paramsStr: m[2].trim(), params: m[2].trim() ? m[2].trim().split(',').map(p => p.trim()) : [] });
  }

  if (funcDefs.length === 0) {
    throw new Error('Could not find function definition (expected "def funcName(...)")');
  }

  const mainFunc = funcDefs[0];
  const funcNames = funcDefs.map(f => f.name);

  // Rename & rewire
  let processedCode = code;
  for (const name of funcNames) {
    processedCode = processedCode.replace(new RegExp(`def\\s+${name}\\s*\\(`), `def _original_${name}(`);
  }
  for (const name of funcNames) {
    processedCode = processedCode.replace(
      new RegExp(`(?<!def\\s)(?<!_original_)(?<!_wrapped_)\\b${name}\\s*\\(`, 'g'),
      `_wrapped_${name}(`
    );
  }

  // For backtracking, we use a call counter as node ID since there are no graph/tree nodes
  const wrappers = funcDefs.map(f => {
    return `def _wrapped_${f.name}(${f.paramsStr}):
    _call_id[0] += 1
    cid = _call_id[0]
    # Try to get meaningful label from first param
    first_arg = ${f.params[0] || 'None'}
    label = str(first_arg) if not isinstance(first_arg, (list, dict, set)) else str(len(first_arg))
    _record_call("${f.name}", label, cid, _globs)
    result = _original_${f.name}(${f.paramsStr})
    _record_return("${f.name}", label, cid, _globs, result)
    return result`;
  }).join('\n\n');

  // Entry args
  const mainCallArgs = mainFunc.params.map(p => {
    if (p === 'candidates') return '_candidates';
    if (p === 'target') return '_target';
    if (p === 'path') return '_path';
    if (p === 'globals') return '_globs';
    return p;
  }).join(', ');

  const candidatesPy = candidatesJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const targetPy = JSON.stringify(targetJson).replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const globalsPy = globalsJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');

  return `
import sys, json

sys.setrecursionlimit(500)

# ---------- Tracing infrastructure ----------
_steps = []
_stack = []
_call_id = [0]
_MAX_STEPS = 2000

class _StepLimitExceeded(Exception):
    pass

def _serialize(v):
    if isinstance(v, set):
        return list(v)
    if isinstance(v, list):
        return list(v)
    return v

def _record_call(func_name, label, call_id, globs):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    _stack.append({"funcName": func_name, "nodeVal": label, "nodeId": call_id, "state": "active"})
    _steps.append({
        "type": "call",
        "funcName": func_name,
        "nodeVal": label,
        "nodeId": call_id,
        "stack": [dict(f) for f in _stack],
        "globals": {k: _serialize(v) for k, v in globs.items()},
        "activeNode": call_id,
        "message": f"Call {func_name}({label})"
    })

def _record_return(func_name, label, call_id, globs, result):
    if len(_steps) >= _MAX_STEPS:
        raise _StepLimitExceeded("Exceeded maximum number of steps (2000)")
    if _stack:
        _stack[-1]["state"] = "returning"
        _stack[-1]["result"] = _serialize(result)
    _steps.append({
        "type": "return",
        "funcName": func_name,
        "nodeVal": label,
        "nodeId": call_id,
        "result": _serialize(result),
        "stack": [dict(f) for f in _stack],
        "globals": {k: _serialize(v) for k, v in globs.items()},
        "returningNode": call_id,
        "message": f"Return {_serialize(result)} from {func_name}({label})"
    })
    if _stack:
        _stack.pop()

# ---------- User code (renamed) ----------
${processedCode}

# ---------- Wrappers ----------
${wrappers}

# ---------- Main ----------
try:
    _candidates = ${candidatesPy}
    _target = ${targetPy}
    _path = []
    _globs = ${globalsPy}
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
  const { code, tree, tree2, graph, startNode, candidates, target, globals, mode } = req.body;

  if (!code || !code.trim()) {
    return res.status(400).json({ error: 'No code provided' });
  }

  let script;
  const lm = buildLineMap(code);

  try {
    const globalsJson = JSON.stringify(globals || {});

    if (mode === 'graph') {
      const adjListJson = JSON.stringify(graph || {});
      script = buildGraphPythonScript(code, adjListJson, startNode || 0, globalsJson);
    } else if (mode === 'backtrack') {
      const candidatesJson = JSON.stringify(candidates || []);
      script = buildBacktrackPythonScript(code, candidatesJson, target, globalsJson);
    } else {
      const treeJson = JSON.stringify(tree || []);
      const tree2Json = tree2 ? JSON.stringify(tree2) : null;
      script = buildPythonScript(code, treeJson, globalsJson, tree2Json);
    }
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
      result.lineMap = lm;
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
