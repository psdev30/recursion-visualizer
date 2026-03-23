'use strict';

const { buildBuildTreePythonScript } = require('../../lib/pythonScripts');

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runScript(script) {
  const tmpFile = path.join(os.tmpdir(), `test_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(tmpFile, script);
  try {
    const stdout = execSync(`python3 ${tmpFile}`, { timeout: 10000 }).toString();
    return JSON.parse(stdout);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

const buildTreeCode = [
  'def buildTree(preorder, inorder):',
  '    if not preorder:',
  '        return None',
  '    root = TreeNode(preorder[0])',
  '    mid = inorder.index(preorder[0])',
  '    root.left = buildTree(preorder[1:mid+1], inorder[:mid])',
  '    root.right = buildTree(preorder[mid+1:], inorder[mid+1:])',
  '    return root',
].join('\n');

describe('buildBuildTreePythonScript', () => {
  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    test('throws when no function definition is found', () => {
      expect(() =>
        buildBuildTreePythonScript('x = 1', '{}', '{}')
      ).toThrow('Could not find function definition');
    });

    test('returns a string', () => {
      const script = buildBuildTreePythonScript(buildTreeCode, '{"preorder": [1], "inorder": [1]}', '{}');
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });
  });

  // ── Script structure ──────────────────────────────────────────────────────

  describe('generated script structure', () => {
    test('includes auto-ID TreeNode class', () => {
      const script = buildBuildTreePythonScript(buildTreeCode, '{}', '{}');
      expect(script).toContain('class TreeNode:');
      expect(script).toContain('_next_node_id');
      expect(script).toContain('_all_nodes');
    });

    test('includes _call_id counter', () => {
      const script = buildBuildTreePythonScript(buildTreeCode, '{}', '{}');
      expect(script).toContain('_call_id = [0]');
    });

    test('includes treeSnapshot in record functions', () => {
      const script = buildBuildTreePythonScript(buildTreeCode, '{}', '{}');
      expect(script).toContain('treeSnapshot');
      expect(script).toContain('_serialize_tree');
    });

    test('uses _args.get() for parameter lookup', () => {
      const script = buildBuildTreePythonScript(buildTreeCode, '{}', '{}');
      expect(script).toContain('_args.get("preorder", None)');
      expect(script).toContain('_args.get("inorder", None)');
    });

    test('outputs buildTree flag', () => {
      const script = buildBuildTreePythonScript(buildTreeCode, '{}', '{}');
      expect(script).toContain('"buildTree": True');
    });
  });

  // ── Execution ─────────────────────────────────────────────────────────────

  describe('execution', () => {
    test('constructs correct tree from preorder/inorder', () => {
      const argsJson = JSON.stringify({ preorder: [3, 9, 20, 15, 7], inorder: [9, 3, 15, 20, 7] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      expect(result.buildTree).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);

      // Final step should have the complete tree
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.treeSnapshot).not.toBeNull();
      expect(lastStep.treeSnapshot.val).toBe(3);
      expect(lastStep.treeSnapshot.left.val).toBe(9);
      expect(lastStep.treeSnapshot.right.val).toBe(20);
      expect(lastStep.treeSnapshot.right.left.val).toBe(15);
      expect(lastStep.treeSnapshot.right.right.val).toBe(7);
    });

    test('single node tree', () => {
      const argsJson = JSON.stringify({ preorder: [1], inorder: [1] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.treeSnapshot.val).toBe(1);
      expect(lastStep.treeSnapshot.left).toBeNull();
      expect(lastStep.treeSnapshot.right).toBeNull();
    });

    test('first call step has null treeSnapshot (no tree built yet)', () => {
      const argsJson = JSON.stringify({ preorder: [3, 9, 20], inorder: [9, 3, 20] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      expect(result.steps[0].type).toBe('call');
      expect(result.steps[0].treeSnapshot).toBeNull();
    });

    test('tree grows incrementally via treeSnapshot', () => {
      const argsJson = JSON.stringify({ preorder: [3, 9, 20], inorder: [9, 3, 20] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      // Find first step where treeSnapshot is non-null
      const firstWithTree = result.steps.find(s => s.treeSnapshot !== null);
      expect(firstWithTree).toBeDefined();

      // That snapshot should have the root node (val=3)
      expect(firstWithTree.treeSnapshot.val).toBe(3);

      // Final snapshot should have all three nodes
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.treeSnapshot.val).toBe(3);
      expect(lastStep.treeSnapshot.left.val).toBe(9);
      expect(lastStep.treeSnapshot.right.val).toBe(20);
    });

    test('steps have call and return types', () => {
      const argsJson = JSON.stringify({ preorder: [1, 2], inorder: [2, 1] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      const calls = result.steps.filter(s => s.type === 'call');
      const returns = result.steps.filter(s => s.type === 'return');
      expect(calls.length).toBe(returns.length);
      expect(calls.length).toBeGreaterThan(0);
    });

    test('call steps have activeNode, return steps have returningNode', () => {
      const argsJson = JSON.stringify({ preorder: [1], inorder: [1] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      result.steps.forEach(s => {
        if (s.type === 'call') {
          expect(s).toHaveProperty('activeNode');
        } else {
          expect(s).toHaveProperty('returningNode');
        }
      });
    });

    test('auto-assigns unique node IDs', () => {
      const argsJson = JSON.stringify({ preorder: [3, 9, 20, 15, 7], inorder: [9, 3, 15, 20, 7] });
      const script = buildBuildTreePythonScript(buildTreeCode, argsJson, '{}');
      const result = runScript(script);

      // Collect all node IDs from the final tree
      const ids = new Set();
      function collectIds(node) {
        if (!node) return;
        ids.add(node.id);
        collectIds(node.left);
        collectIds(node.right);
      }
      const lastStep = result.steps[result.steps.length - 1];
      collectIds(lastStep.treeSnapshot);

      expect(ids.size).toBe(5); // 5 unique nodes
    });
  });

  // ── Globals support ───────────────────────────────────────────────────────

  describe('globals support', () => {
    test('globals are tracked in steps', () => {
      const code = [
        'def buildTree(preorder, inorder, globals):',
        '    if not preorder:',
        '        return None',
        '    globals["count"] = globals.get("count", 0) + 1',
        '    root = TreeNode(preorder[0])',
        '    mid = inorder.index(preorder[0])',
        '    root.left = buildTree(preorder[1:mid+1], inorder[:mid], globals)',
        '    root.right = buildTree(preorder[mid+1:], inorder[mid+1:], globals)',
        '    return root',
      ].join('\n');

      const argsJson = JSON.stringify({ preorder: [1, 2], inorder: [2, 1] });
      const script = buildBuildTreePythonScript(code, argsJson, '{"count": 0}');
      const result = runScript(script);

      // Last return step should have count > 0
      const lastReturn = result.steps.filter(s => s.type === 'return').pop();
      expect(lastReturn.globals.count).toBeGreaterThan(0);
    });
  });

  // ── LeetCode preprocessing ────────────────────────────────────────────────

  describe('LeetCode preprocessing', () => {
    test('strips class Solution wrapper', () => {
      const leetCode = [
        'class Solution:',
        '    def buildTree(self, preorder: List[int], inorder: List[int]) -> Optional[TreeNode]:',
        '        if not preorder:',
        '            return None',
        '        root = TreeNode(preorder[0])',
        '        mid = inorder.index(preorder[0])',
        '        root.left = self.buildTree(preorder[1:mid+1], inorder[:mid])',
        '        root.right = self.buildTree(preorder[mid+1:], inorder[mid+1:])',
        '        return root',
      ].join('\n');

      const argsJson = JSON.stringify({ preorder: [3, 9, 20, 15, 7], inorder: [9, 3, 15, 20, 7] });
      const script = buildBuildTreePythonScript(leetCode, argsJson, '{}', true);
      const result = runScript(script);

      expect(result.buildTree).toBe(true);
      const lastStep = result.steps[result.steps.length - 1];
      expect(lastStep.treeSnapshot.val).toBe(3);
    });
  });

  // ── Step limit ────────────────────────────────────────────────────────────

  describe('step limit', () => {
    test('returns error when step limit exceeded', () => {
      // Build a very deep recursion that will exceed 2000 steps
      const code = [
        'def buildTree(nums):',
        '    if not nums:',
        '        return None',
        '    root = TreeNode(nums[0])',
        '    root.left = buildTree(nums[1:])',
        '    return root',
      ].join('\n');

      const longList = Array.from({ length: 500 }, (_, i) => i);
      const argsJson = JSON.stringify({ nums: longList });
      const script = buildBuildTreePythonScript(code, argsJson, '{}');
      const result = runScript(script);

      expect(result.error).toBeDefined();
    });
  });
});
