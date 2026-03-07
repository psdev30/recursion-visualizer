'use strict';

/**
 * Preprocess LeetCode-style Python code into standalone functions.
 * - Strips comment-only lines
 * - Unwraps solution-wrapper classes (classes WITHOUT an __init__ method, e.g. `class Solution:`)
 * - Preserves data-structure classes (classes WITH an __init__ method, e.g. custom `Node`)
 * - Removes `self` and type annotations from `def` signatures
 * - Rewires `self.method(` → `method(`
 */
function preprocessPython(code) {
  // Remove all comment-only lines (LeetCode preamble, etc.)
  code = code.replace(/^\s*#.*$/gm, '');

  // Strip solution-wrapper class blocks and de-indent their methods.
  // A "wrapper" class is one with NO __init__ method (i.e. pure solution container).
  // Data-structure classes (Node, TreeNode, etc.) have __init__ and are left intact.
  if (/^\s*class\s+\w+/m.test(code)) {
    const lines = code.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^class\s+\w+/.test(trimmed)) {
        const classBodyIndent = line.search(/\S/) + 1; // any indent deeper than class col

        // Peek ahead: does this class body contain a def __init__?
        let hasInit = false;
        for (let j = i + 1; j < lines.length; j++) {
          const inner = lines[j];
          const innerTrimmed = inner.trim();
          if (innerTrimmed === '') continue;
          const innerIndent = inner.search(/\S/);
          if (innerIndent < classBodyIndent) break; // left the class
          if (innerTrimmed.startsWith('def __init__')) { hasInit = true; break; }
        }

        if (hasInit) {
          // Data-structure class — preserve as-is
          result.push(line);
          i++;
          continue;
        }

        // Solution-wrapper class — strip header and de-indent body
        let methodIndent = -1;
        i++; // skip the `class ...` line
        while (i < lines.length) {
          const classLine = lines[i];
          const classTrimmed = classLine.trim();

          if (classTrimmed === '') { result.push(''); i++; continue; }

          const indent = classLine.search(/\S/);
          if (indent === 0) break; // left the class scope (don't consume this line)

          if (methodIndent < 0 && classTrimmed.startsWith('def ')) {
            methodIndent = indent;
          }

          result.push(methodIndent >= 0 ? classLine.slice(methodIndent) : classLine);
          i++;
        }
        continue; // outer while will re-evaluate lines[i] (first line after class)
      }

      result.push(line);
      i++;
    }
    code = result.join('\n');
  }

  // Clean def lines at column 0 only: remove self, type annotations, return type.
  // Restricting to ^def (start of line) ensures we clean de-indented Solution methods
  // and top-level functions, but leave methods inside preserved data-structure classes
  // (which are still indented) completely untouched.
  code = code.replace(/^def\s+(\w+)\s*\(([^)]*)\)\s*(?:->[^:]+)?:/mg, (_match, name, params) => {
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

/**
 * Build a line map from original code: funcName → 1-based line number of `def`.
 */
function buildLineMap(code) {
  const map = {};
  code.split('\n').forEach((line, i) => {
    const m = line.match(/def\s+(\w+)\s*\(/);
    if (m) map[m[1]] = i + 1;
  });
  return map;
}

/**
 * Build a self-contained Python script for tracing binary-tree recursion.
 *
 * @param {string} userCode   - Raw user Python code
 * @param {string} treeJson   - JSON array for the primary tree (BFS level-order)
 * @param {string} globalsJson - JSON object of global variables
 * @param {string|null} tree2Json - JSON array for secondary tree (enables two-tree mode)
 * @returns {string} Generated Python script
 * @throws {Error} If no function definition is found
 */
function buildPythonScript(userCode, treeJson, globalsJson, tree2Json, leetcode = true) {
  const code = leetcode ? preprocessPython(userCode) : userCode;

  const funcDefs = [];
  const defRegex = /^def\s+(\w+)\s*\(([^)]*)\)/mg;
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

  const mainTreeParams = mainFunc.params.filter(p => p !== 'globals');
  const twoTreeMode = tree2Json && mainTreeParams.length >= 2;

  let processedCode = code;
  for (const name of funcNames) {
    processedCode = processedCode.replace(
      new RegExp(`^def\\s+${name}\\s*\\(`, 'm'),
      `def _original_${name}(`
    );
  }
  for (const name of funcNames) {
    processedCode = processedCode.replace(
      new RegExp(`(?<!def\\s)(?<!_original_)(?<!_wrapped_)\\b${name}\\s*\\(`, 'g'),
      `_wrapped_${name}(`
    );
  }

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

  const mainCallArgs = mainFunc.params.map((p, i) => {
    if (twoTreeMode) {
      if (i === 0) return '_tree1';
      if (i === 1 && mainTreeParams.length >= 2 && p !== 'globals') return '_tree2';
    } else {
      if (i === 0) return '_tree';
    }
    if (p === 'globals') return '_globs';
    // Extra params (e.g. targetSum, k) are looked up from the globals dict so users
    // can supply their initial values via the globals input (e.g. {"targetSum": 22}).
    return `_globs.get("${p}", None)`;
  }).join(', ') || '_tree';

  const treePy = treeJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const globalsPy = globalsJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const tree2Py = tree2Json ? tree2Json.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False') : null;

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
    safe_res = _safe_result(result)
    if _stack:
        _stack[-1]["state"] = "returning"
        _stack[-1]["result"] = safe_res
    _steps.append({
        "type": "return",
        "funcName": func_name,
        "nodeVal": n1_val,
        "nodeId": n1_id,
        "nodeVal2": n2_val,
        "nodeId2": n2_id,
        "result": safe_res,
        "stack": [dict(f) for f in _stack],
        "globals": _snap_globals(globs),
        "returningNode": n1_id,
        "returningNode2": n2_id,
        "message": f"Return {safe_res} from {func_name}({n1_val if n1_val is not None else 'null'}, {n2_val if n2_val is not None else 'null'})"
    })
    if _stack:
        _stack.pop()
` : '';

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
import sys, json, collections, math, heapq, functools, itertools
from collections import deque, defaultdict, Counter, OrderedDict
from typing import Optional, List, Dict, Set, Tuple
from heapq import heappush, heappop, heapify
from functools import lru_cache

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

def _safe_result(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, (list, tuple)):
        return [_safe_result(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _safe_result(val) for k, val in v.items()}
    if hasattr(v, 'val'):
        return v.val
    try:
        return repr(v)
    except Exception:
        return str(type(v).__name__)

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
    safe_res = _safe_result(result)
    if _stack:
        _stack[-1]["state"] = "returning"
        _stack[-1]["result"] = safe_res
    _steps.append({
        "type": "return",
        "funcName": func_name,
        "nodeVal": node_val,
        "nodeId": node_id,
        "result": safe_res,
        "stack": [dict(f) for f in _stack],
        "globals": _snap_globals(globs),
        "returningNode": node_id,
        "message": f"Return {safe_res} from {func_name}({node_val if node_val is not None else 'null'})"
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

/**
 * Build Python script for graph traversal tracing (DFS/BFS on adjacency list).
 *
 * @param {string} userCode      - Raw user Python code
 * @param {string} adjListJson   - JSON object: { nodeId: [neighborId, ...] }
 * @param {number|string} startNode - Starting node ID
 * @param {string} globalsJson   - JSON object of global variables
 * @returns {string} Generated Python script
 * @throws {Error} If no function definition is found
 */
function buildGraphPythonScript(userCode, adjListJson, startNode, globalsJson, leetcode = true) {
  const code = leetcode ? preprocessPython(userCode) : userCode;

  const funcDefs = [];
  const defRegex = /^def\s+(\w+)\s*\(([^)]*)\)/mg;
  let m;
  while ((m = defRegex.exec(code)) !== null) {
    funcDefs.push({ name: m[1], paramsStr: m[2].trim(), params: m[2].trim() ? m[2].trim().split(',').map(p => p.trim()) : [] });
  }

  if (funcDefs.length === 0) {
    throw new Error('Could not find function definition (expected "def funcName(...)")');
  }

  const mainFunc = funcDefs[0];
  const funcNames = funcDefs.map(f => f.name);

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

  const wrappers = funcDefs.map(f => {
    const firstParam = f.params[0] || '_node';
    return `def _wrapped_${f.name}(${f.paramsStr}):
    _record_call("${f.name}", ${firstParam}, _globs)
    result = _original_${f.name}(${f.paramsStr})
    _record_return("${f.name}", ${firstParam}, _globs, result)
    return result`;
  }).join('\n\n');

  const mainCallArgs = mainFunc.params.map((p, i) => {
    if (i === 0) return `${startNode}`;
    if (p === 'graph') return '_graph';
    if (p === 'visited') return '_visited';
    if (p === 'globals') return '_globs';
    return `_globs.get("${p}", None)`;
  }).join(', ');

  const adjPy = adjListJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const globalsPy = globalsJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');

  return `
import sys, json, collections, math, heapq, functools, itertools
from collections import deque, defaultdict, Counter, OrderedDict
from typing import Optional, List, Dict, Set, Tuple
from heapq import heappush, heappop, heapify
from functools import lru_cache

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

/**
 * Build Python script for backtracking recursion tracing.
 *
 * @param {string} userCode       - Raw user Python code
 * @param {string} candidatesJson - JSON array of candidates
 * @param {*}      targetJson     - Target value (any JSON-serializable type)
 * @param {string} globalsJson    - JSON object of global variables
 * @returns {string} Generated Python script
 * @throws {Error} If no function definition is found
 */
function buildBacktrackPythonScript(userCode, candidatesJson, targetJson, globalsJson, leetcode = true) {
  const code = leetcode ? preprocessPython(userCode) : userCode;

  const funcDefs = [];
  const defRegex = /^def\s+(\w+)\s*\(([^)]*)\)/mg;
  let m;
  while ((m = defRegex.exec(code)) !== null) {
    funcDefs.push({ name: m[1], paramsStr: m[2].trim(), params: m[2].trim() ? m[2].trim().split(',').map(p => p.trim()) : [] });
  }

  if (funcDefs.length === 0) {
    throw new Error('Could not find function definition (expected "def funcName(...)")');
  }

  const mainFunc = funcDefs[0];
  const funcNames = funcDefs.map(f => f.name);

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

  const mainCallArgs = mainFunc.params.map(p => {
    if (p === 'candidates') return '_candidates';
    if (p === 'target') return '_target';
    if (p === 'path') return '_path';
    if (p === 'globals') return '_globs';
    return `_globs.get("${p}", None)`;
  }).join(', ');

  const candidatesPy = candidatesJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const targetPy = JSON.stringify(targetJson).replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');
  const globalsPy = globalsJson.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False');

  return `
import sys, json, collections, math, heapq, functools, itertools
from collections import deque, defaultdict, Counter, OrderedDict
from typing import Optional, List, Dict, Set, Tuple
from heapq import heappush, heappop, heapify
from functools import lru_cache

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

module.exports = {
  preprocessPython,
  buildLineMap,
  buildPythonScript,
  buildGraphPythonScript,
  buildBacktrackPythonScript,
};
