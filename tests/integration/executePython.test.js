'use strict';

const http = require('http');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApp } = require('../../lib/createApp');

let db;
let server;

beforeAll(done => {
  db = new Database(':memory:');
  const app = createApp(db);
  server = http.createServer(app);
  server.listen(0, done);
});

afterAll(done => {
  server.close(() => {
    db.close();
    done();
  });
});

// ── Input validation ───────────────────────────────────────────────────────

describe('POST /api/execute-python — input validation', () => {
  test('returns 400 when code is missing', async () => {
    const res = await request(server).post('/api/execute-python').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code is empty string', async () => {
    const res = await request(server).post('/api/execute-python').send({ code: '' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code is whitespace only', async () => {
    const res = await request(server).post('/api/execute-python').send({ code: '   \n  ' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code has no function definition (tree mode)', async () => {
    const res = await request(server)
      .post('/api/execute-python')
      .send({ code: 'x = 1 + 2', tree: [1], mode: 'tree' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code has no function definition (graph mode)', async () => {
    const res = await request(server)
      .post('/api/execute-python')
      .send({ code: 'x = 1', graph: {}, startNode: 0, mode: 'graph' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code has no function definition (backtrack mode)', async () => {
    const res = await request(server)
      .post('/api/execute-python')
      .send({ code: 'x = 1', candidates: [], target: 0, mode: 'backtrack' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── Tree mode ──────────────────────────────────────────────────────────────

describe('POST /api/execute-python — tree mode', () => {
  const treeCode = [
    'def maxDepth(root):',
    '    if not root:',
    '        return 0',
    '    return 1 + maxDepth(root.left) + maxDepth(root.right)',
  ].join('\n');

  test('returns steps array for valid tree recursion', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: treeCode,
      tree: [1, 2, 3],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('returns lineMap with function definitions', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: treeCode,
      tree: [1, 2, 3],
      mode: 'tree',
    });
    expect(res.body.lineMap).toBeDefined();
    expect(typeof res.body.lineMap).toBe('object');
    expect(res.body.lineMap.maxDepth).toBe(1);
  });

  test('steps contain call and return events', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: treeCode,
      tree: [3, 9, 20, null, null, 15, 7],
      mode: 'tree',
    });
    const types = new Set(res.body.steps.map(s => s.type));
    expect(types.has('call')).toBe(true);
    expect(types.has('return')).toBe(true);
  });

  test('handles empty tree array', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: treeCode,
      tree: [],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  test('handles missing tree field (defaults to empty array)', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: treeCode,
      mode: 'tree',
    });
    expect(res.status).toBe(200);
  });

  test('handles globals object', async () => {
    const code = [
      'def solve(root, globals):',
      '    if not root:',
      '        return 0',
      '    globals["count"] = globals.get("count", 0) + 1',
      '    return solve(root.left, globals) + solve(root.right, globals) + 1',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3],
      globals: { count: 0 },
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  test('handles LeetCode class-style code', async () => {
    const code = [
      'class Solution:',
      '    def maxDepth(self, root):',
      '        if not root:',
      '            return 0',
      '        return 1 + self.maxDepth(root.left) + self.maxDepth(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('returns error message for Python runtime errors', async () => {
    const code = 'def solve(root):\n    return 1 / 0';
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/division by zero|ZeroDivisionError/i);
  });

  test('two-tree mode: returns twoTree flag when tree2 provided', async () => {
    const code = [
      'def isSameTree(p, q):',
      '    if not p and not q:',
      '        return True',
      '    if not p or not q:',
      '        return False',
      '    return p.val == q.val and isSameTree(p.left, q.left) and isSameTree(p.right, q.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3],
      tree2: [1, 2, 3],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body.twoTree).toBe(true);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });
});

// ── Graph mode ─────────────────────────────────────────────────────────────

describe('POST /api/execute-python — graph mode', () => {
  const graphCode = [
    'def dfs(node, graph, visited):',
    '    if node in visited:',
    '        return',
    '    visited.add(node)',
    '    for n in graph.get(node, []):',
    '        dfs(n, graph, visited)',
  ].join('\n');

  test('returns steps for valid graph DFS', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: graphCode,
      graph: { 0: [1, 2], 1: [], 2: [] },
      startNode: 0,
      mode: 'graph',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('returns lineMap in graph mode', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: graphCode,
      graph: { 0: [1] },
      startNode: 0,
      mode: 'graph',
    });
    expect(res.body.lineMap).toBeDefined();
    expect(res.body.lineMap.dfs).toBe(1);
  });

  test('handles missing graph field (defaults to empty adjacency)', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: graphCode,
      startNode: 0,
      mode: 'graph',
    });
    expect(res.status).toBe(200);
  });

  test('handles missing startNode (defaults to 0)', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: graphCode,
      graph: { 0: [] },
      mode: 'graph',
    });
    expect(res.status).toBe(200);
  });

  test('steps reference graph node IDs as nodeId', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: graphCode,
      graph: { 5: [6], 6: [] },
      startNode: 5,
      mode: 'graph',
    });
    const callSteps = res.body.steps.filter(s => s.type === 'call');
    expect(callSteps.some(s => s.nodeId === 5)).toBe(true);
    expect(callSteps.some(s => s.nodeId === 6)).toBe(true);
  });
});

// ── Backtrack mode ─────────────────────────────────────────────────────────

describe('POST /api/execute-python — backtrack mode', () => {
  const backtrackCode = [
    'def backtrack(candidates, target, path):',
    '    if target == 0:',
    '        return',
    '    for c in candidates:',
    '        if c <= target:',
    '            path.append(c)',
    '            backtrack(candidates, target - c, path)',
    '            path.pop()',
  ].join('\n');

  test('returns steps for valid backtracking', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: backtrackCode,
      candidates: [2, 3],
      target: 4,
      mode: 'backtrack',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('returns lineMap in backtrack mode', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: backtrackCode,
      candidates: [2],
      target: 2,
      mode: 'backtrack',
    });
    expect(res.body.lineMap).toBeDefined();
    expect(res.body.lineMap.backtrack).toBe(1);
  });

  test('handles missing candidates (defaults to empty array)', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: backtrackCode,
      target: 5,
      mode: 'backtrack',
    });
    expect(res.status).toBe(200);
  });

  test('handles missing target without crashing (bug: JSON.stringify(undefined) is not a string)', async () => {
    // Previously target=undefined caused JSON.stringify(undefined) to return the
    // primitive `undefined`, then .replace() threw a TypeError.
    const res = await request(server).post('/api/execute-python').send({
      code: backtrackCode,
      candidates: [2, 3],
      mode: 'backtrack',
      // target intentionally omitted
    });
    // Should not crash with 500; either succeeds or returns a meaningful error
    expect(res.status).not.toBe(500);
    expect(res.body).toBeDefined();
  });

  test('handles numeric target', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: backtrackCode,
      candidates: [1],
      target: 2,
      mode: 'backtrack',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  test('steps have unique incremental nodeId values', async () => {
    const res = await request(server).post('/api/execute-python').send({
      code: backtrackCode,
      candidates: [2],
      target: 4,
      mode: 'backtrack',
    });
    const callSteps = res.body.steps.filter(s => s.type === 'call');
    const ids = callSteps.map(s => s.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Non-LeetCode functions ─────────────────────────────────────────────────

describe('POST /api/execute-python — non-LeetCode tree functions', () => {
  test('plain tree traversal without class wrapper works', async () => {
    const code = [
      'def inorder(root):',
      '    if not root:',
      '        return []',
      '    return inorder(root.left) + [root.val] + inorder(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [4, 2, 6, 1, 3, 5, 7],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('function with extra param works when param value provided in globals', async () => {
    const code = [
      'def pathSum(root, targetSum):',
      '    if not root:',
      '        return False',
      '    if not root.left and not root.right:',
      '        return root.val == targetSum',
      '    return pathSum(root.left, targetSum - root.val) or pathSum(root.right, targetSum - root.val)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [5, 4, 8, 11, null, 13, 4, 7, 2, null, null, null, 1],
      globals: { targetSum: 22 },
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('custom Node class is preserved and does not cause a NameError', async () => {
    const code = [
      'class Node:',
      '    def __init__(self, val):',
      '        self.val = val',
      '        self.left = None',
      '        self.right = None',
      '',
      'def countNodes(root):',
      '    if not root:',
      '        return 0',
      '    return 1 + countNodes(root.left) + countNodes(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3, 4, 5],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
    // Sanity: no 'self is not defined' error
    expect(res.body.error).toBeUndefined();
  });

  test('non-standard param name (node instead of root) works fine', async () => {
    const code = [
      'def maxDepth(node):',
      '    if node is None:',
      '        return 0',
      '    return 1 + max(maxDepth(node.left), maxDepth(node.right))',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [3, 9, 20, null, null, 15, 7],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });
});

// ── Default mode (no mode field) ───────────────────────────────────────────

describe('POST /api/execute-python — default/tree mode', () => {
  test('defaults to tree mode when mode is not specified', async () => {
    const code = 'def solve(root):\n    if not root:\n        return 0\n    return 1';
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1],
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });
});

// ── lineMap ────────────────────────────────────────────────────────────────

describe('POST /api/execute-python — lineMap', () => {
  test('lineMap is built from original (unprocessed) code', async () => {
    const code = [
      '# comment line',
      'def helper(node):',  // line 2 in original
      '    return node',
      'def solve(root):',   // line 4 in original
      '    return helper(root)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1],
      mode: 'tree',
    });
    expect(res.body.lineMap.helper).toBe(2);
    expect(res.body.lineMap.solve).toBe(4);
  });

  test('lineMap is included even when Python execution returns an error', async () => {
    const code = 'def solve(root):\n    raise ValueError("oops")';
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1],
      mode: 'tree',
    });
    // Python might return an error in the output JSON, but lineMap should still be there
    expect(res.body.lineMap).toBeDefined();
    expect(res.body.lineMap.solve).toBe(1);
  });
});

// ── Non-primitive return values ─────────────────────────────────────────────

describe('POST /api/execute-python — functions returning non-primitive values', () => {
  test('invertTree (returns TreeNode) runs without error', async () => {
    const code = [
      'def invertTree(root):',
      '    if not root:',
      '        return None',
      '    root.left, root.right = invertTree(root.right), invertTree(root.left)',
      '    return root',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [4, 2, 7, 1, 3, 6, 9],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('invertTree return steps carry the node val, not a raw object', async () => {
    const code = [
      'def invertTree(root):',
      '    if not root:',
      '        return None',
      '    root.left, root.right = invertTree(root.right), invertTree(root.left)',
      '    return root',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [4, 2, 7],
      mode: 'tree',
    });
    const returnSteps = res.body.steps.filter(s => s.type === 'return' && s.result !== null);
    expect(returnSteps.length).toBeGreaterThan(0);
    returnSteps.forEach(s => {
      expect(typeof s.result).toBe('number');
    });
  });

  test('LeetCode-style invertTree with class Solution runs without error', async () => {
    const code = [
      'class Solution:',
      '    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:',
      '        if not root:',
      '            return None',
      '        root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)',
      '        return root',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [4, 2, 7, 1, 3, 6, 9],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.steps.length).toBeGreaterThan(0);
  });

  test('inorder traversal (returns list) runs without error', async () => {
    const code = [
      'def inorder(root):',
      '    if not root:',
      '        return []',
      '    return inorder(root.left) + [root.val] + inorder(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [2, 1, 3],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    const returnSteps = res.body.steps.filter(s => s.type === 'return');
    returnSteps.forEach(s => {
      expect(Array.isArray(s.result) || s.result === null).toBe(true);
    });
  });

  test('response body is fully JSON-serializable when function returns TreeNode', async () => {
    const code = [
      'def invertTree(root):',
      '    if not root:',
      '        return None',
      '    root.left, root.right = invertTree(root.right), invertTree(root.left)',
      '    return root',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3],
      mode: 'tree',
    });
    // If any non-serializable object leaked through, this would have failed at the server
    // level. Verify the response parses cleanly and round-trips.
    expect(() => JSON.stringify(res.body)).not.toThrow();
  });
});

// ── Breakpoint contract ─────────────────────────────────────────────────────
// The frontend breakpoint feature resolves step.funcName via lineMap to a
// 1-based line number, then checks if that line is in the user's breakpoint
// set.  These tests verify the server upholds that contract across all modes.

describe('POST /api/execute-python — breakpoint contract', () => {
  test('tree mode: every step has a funcName string', async () => {
    const code = [
      'def maxDepth(root):',
      '    if not root:',
      '        return 0',
      '    return 1 + maxDepth(root.left) + maxDepth(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3],
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    res.body.steps.forEach(s => {
      expect(typeof s.funcName).toBe('string');
      expect(s.funcName.length).toBeGreaterThan(0);
    });
  });

  test('tree mode: every step\'s funcName resolves to a lineMap entry', async () => {
    const code = [
      'def maxDepth(root):',
      '    if not root:',
      '        return 0',
      '    return 1 + maxDepth(root.left) + maxDepth(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [3, 9, 20],
      mode: 'tree',
    });
    const { steps, lineMap } = res.body;
    steps.forEach(s => {
      expect(lineMap[s.funcName]).toBeDefined();
      expect(typeof lineMap[s.funcName]).toBe('number');
    });
  });

  test('tree mode: multi-function code — each function\'s steps map to its own def line', async () => {
    // solve is defined on line 1 (entry point), helper on line 4.
    // Both should produce steps, and each funcName maps to its own lineMap line.
    const code = [
      'def solve(root):',            // line 1
      '    if not root:',
      '        return 0',
      '    return helper(root)',
      'def helper(root):',           // line 5
      '    return root.val',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1],
      mode: 'tree',
    });
    const { steps, lineMap } = res.body;
    expect(lineMap.solve).toBe(1);
    expect(lineMap.helper).toBe(5);

    const solveSteps  = steps.filter(s => s.funcName === 'solve');
    const helperSteps = steps.filter(s => s.funcName === 'helper');
    expect(solveSteps.length).toBeGreaterThan(0);
    expect(helperSteps.length).toBeGreaterThan(0);

    // With per-line stepping, each step has lineNumber — verify funcName-based lineMap still works
    solveSteps.forEach(s => expect(lineMap[s.funcName]).toBe(1));
    helperSteps.forEach(s => expect(lineMap[s.funcName]).toBe(5));
  });

  test('graph mode: every step has a funcName that maps to lineMap', async () => {
    const code = [
      'def dfs(node, graph, visited):',
      '    if node in visited:',
      '        return',
      '    visited.add(node)',
      '    for n in graph.get(node, []):',
      '        dfs(n, graph, visited)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      graph: { 0: [1], 1: [] },
      startNode: 0,
      mode: 'graph',
    });
    const { steps, lineMap } = res.body;
    expect(lineMap.dfs).toBe(1);
    steps.forEach(s => {
      expect(lineMap[s.funcName]).toBeDefined();
    });
  });

  test('backtrack mode: every step has a funcName that maps to lineMap', async () => {
    const code = [
      'def backtrack(candidates, target, path):',
      '    if target == 0:',
      '        return',
      '    for c in candidates:',
      '        if c <= target:',
      '            path.append(c)',
      '            backtrack(candidates, target - c, path)',
      '            path.pop()',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      candidates: [2],
      target: 2,
      mode: 'backtrack',
    });
    const { steps, lineMap } = res.body;
    expect(lineMap.backtrack).toBe(1);
    steps.forEach(s => {
      expect(lineMap[s.funcName]).toBeDefined();
    });
  });

  test('two-tree mode: every step\'s funcName resolves to lineMap', async () => {
    const code = [
      'def isSameTree(p, q):',
      '    if not p and not q:',
      '        return True',
      '    if not p or not q:',
      '        return False',
      '    return p.val == q.val and isSameTree(p.left, q.left) and isSameTree(p.right, q.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2],
      tree2: [1, 2],
      mode: 'tree',
    });
    const { steps, lineMap } = res.body;
    expect(lineMap.isSameTree).toBe(1);
    steps.forEach(s => {
      expect(lineMap[s.funcName]).toBeDefined();
    });
  });

  test('lineMap line numbers are 1-based positive integers', async () => {
    const code = [
      'def solve(root):',
      '    if not root:',
      '        return 0',
      '    return 1 + solve(root.left) + solve(root.right)',
    ].join('\n');
    const res = await request(server).post('/api/execute-python').send({
      code,
      tree: [1, 2, 3],
      mode: 'tree',
    });
    Object.values(res.body.lineMap).forEach(lineNum => {
      expect(Number.isInteger(lineNum)).toBe(true);
      expect(lineNum).toBeGreaterThanOrEqual(1);
    });
  });
});
