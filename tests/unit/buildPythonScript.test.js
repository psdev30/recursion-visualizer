'use strict';

const { buildPythonScript } = require('../../lib/pythonScripts');

// Helper: execute a generated script and return parsed JSON output
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

describe('buildPythonScript', () => {
  // ── Error handling ─────────────────────────────────────────────────────────

  describe('input validation', () => {
    test('throws when no function definition is found', () => {
      expect(() =>
        buildPythonScript('x = 1 + 2', '[1]', '{}', null)
      ).toThrow('Could not find function definition');
    });

    test('returns a non-empty string', () => {
      const code = 'def solve(root):\n    return 0';
      const script = buildPythonScript(code, '[1]', '{}', null);
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });
  });

  // ── Script structure ───────────────────────────────────────────────────────

  describe('generated script structure', () => {
    const baseCode = 'def solve(root):\n    if not root:\n        return 0\n    return 1 + solve(root.left) + solve(root.right)';

    test('includes TreeNode class', () => {
      const script = buildPythonScript(baseCode, '[1,2,3]', '{}', null);
      expect(script).toContain('class TreeNode:');
    });

    test('includes build_tree function', () => {
      const script = buildPythonScript(baseCode, '[1,2,3]', '{}', null);
      expect(script).toContain('def build_tree(');
    });

    test('includes tracing infrastructure', () => {
      const script = buildPythonScript(baseCode, '[1,2,3]', '{}', null);
      expect(script).toContain('_record_call');
      expect(script).toContain('_record_return');
      expect(script).toContain('_MAX_STEPS = 2000');
    });

    test('renames user function to _original_', () => {
      const script = buildPythonScript(baseCode, '[1]', '{}', null);
      expect(script).toContain('def _original_solve(');
    });

    test('generates a _wrapped_ function', () => {
      const script = buildPythonScript(baseCode, '[1]', '{}', null);
      expect(script).toContain('def _wrapped_solve(');
    });

    test('rewires recursive calls to _wrapped_', () => {
      const script = buildPythonScript(baseCode, '[1]', '{}', null);
      expect(script).toContain('_wrapped_solve(');
    });

    test('sets recursion limit to 500', () => {
      const script = buildPythonScript(baseCode, '[1]', '{}', null);
      expect(script).toContain('sys.setrecursionlimit(500)');
    });

    test('converts JSON null to Python None in tree', () => {
      const script = buildPythonScript(baseCode, '[1,null,3]', '{}', null);
      expect(script).toContain('None');
    });

    test('converts JSON true/false to Python True/False in globals', () => {
      const code = 'def solve(root, globals):\n    return 0';
      const script = buildPythonScript(code, '[1]', '{"visited": true, "done": false}', null);
      expect(script).toContain('True');
      expect(script).toContain('False');
    });
  });

  // ── Single-tree mode execution ─────────────────────────────────────────────

  describe('single-tree mode execution', () => {
    test('produces call and return steps for simple recursion', () => {
      const code = [
        'def maxDepth(root):',
        '    if not root:',
        '        return 0',
        '    return 1 + maxDepth(root.left) + maxDepth(root.right)',
      ].join('\n');
      const script = buildPythonScript(code, '[1,2,3]', '{}', null);
      const output = runScript(script);

      expect(output.steps).toBeDefined();
      expect(Array.isArray(output.steps)).toBe(true);
      expect(output.steps.length).toBeGreaterThan(0);
    });

    test('step types are "call" and "return"', () => {
      const code = [
        'def maxDepth(root):',
        '    if not root:',
        '        return 0',
        '    return 1 + maxDepth(root.left) + maxDepth(root.right)',
      ].join('\n');
      const script = buildPythonScript(code, '[1,2,3]', '{}', null);
      const { steps } = runScript(script);

      const types = new Set(steps.map(s => s.type));
      expect(types.has('call')).toBe(true);
      expect(types.has('return')).toBe(true);
    });

    test('each step contains required fields', () => {
      const code = 'def solve(root):\n    if not root:\n        return 0\n    return solve(root.left) + solve(root.right)';
      const script = buildPythonScript(code, '[1,2,3]', '{}', null);
      const { steps } = runScript(script);

      for (const step of steps) {
        expect(step).toHaveProperty('type');
        expect(step).toHaveProperty('funcName');
        expect(step).toHaveProperty('stack');
        expect(step).toHaveProperty('globals');
        expect(step).toHaveProperty('message');
      }
    });

    test('handles empty tree (null root) gracefully', () => {
      const code = 'def solve(root):\n    if not root:\n        return 0\n    return 1';
      const script = buildPythonScript(code, '[]', '{}', null);
      const output = runScript(script);
      // Should produce steps for a single call with null node
      expect(output.steps).toBeDefined();
    });

    test('globals are snapshottted in each step', () => {
      const code = [
        'def count(root, globals):',
        '    if not root:',
        '        return 0',
        '    globals["n"] = globals.get("n", 0) + 1',
        '    count(root.left, globals)',
        '    count(root.right, globals)',
        '    return globals["n"]',
      ].join('\n');
      const script = buildPythonScript(code, '[1,2,3]', '{"n": 0}', null);
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      // At least one return step should have globals with "n"
      const returnSteps = output.steps.filter(s => s.type === 'return');
      expect(returnSteps.length).toBeGreaterThan(0);
      const lastReturn = returnSteps[returnSteps.length - 1];
      expect(lastReturn.globals).toHaveProperty('n');
    });

    test('LeetCode-style class code works in single-tree mode', () => {
      const code = [
        'class Solution:',
        '    def maxDepth(self, root: Optional[TreeNode]) -> int:',
        '        if not root:',
        '            return 0',
        '        return 1 + self.maxDepth(root.left) + self.maxDepth(root.right)',
      ].join('\n');
      const script = buildPythonScript(code, '[3,9,20,null,null,15,7]', '{}', null);
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(0);
    });
  });

  // ── Two-tree mode ──────────────────────────────────────────────────────────

  describe('two-tree mode', () => {
    test('activates when tree2Json is provided and function has 2+ params', () => {
      const code = 'def isSameTree(p, q):\n    if not p and not q:\n        return True\n    if not p or not q:\n        return False\n    return p.val == q.val and isSameTree(p.left, q.left) and isSameTree(p.right, q.right)';
      const script = buildPythonScript(code, '[1,2,3]', '{}', '[1,2,3]');
      expect(script).toContain('_record_call_2t');
      expect(script).toContain('_record_return_2t');
      expect(script).toContain('build_tree');
      // Both trees should be built
      expect(script).toContain('_tree1 = build_tree(');
      expect(script).toContain('_tree2 = build_tree(');
    });

    test('two-tree mode produces twoTree flag in output', () => {
      const code = 'def isSameTree(p, q):\n    if not p and not q:\n        return True\n    if not p or not q:\n        return False\n    return p.val == q.val and isSameTree(p.left, q.left) and isSameTree(p.right, q.right)';
      const script = buildPythonScript(code, '[1,2,3]', '{}', '[1,2,3]');
      const output = runScript(script);
      expect(output.twoTree).toBe(true);
      expect(Array.isArray(output.steps)).toBe(true);
    });

    test('does NOT activate when tree2Json is null even with 2+ params', () => {
      const code = 'def solve(p, q):\n    return 0';
      const script = buildPythonScript(code, '[1]', '{}', null);
      expect(script).not.toContain('_record_call_2t');
    });

    test('does NOT activate when function has only 1 non-globals param', () => {
      const code = 'def solve(root):\n    return 0';
      const script = buildPythonScript(code, '[1]', '{}', '[2]');
      expect(script).not.toContain('_record_call_2t');
    });
  });

  // ── Extra parameters (non-LeetCode functions) ─────────────────────────────

  describe('extra parameters via globals', () => {
    test('passes extra param from globals dict (e.g. pathSum(root, targetSum))', () => {
      const code = [
        'def pathSum(root, targetSum):',
        '    if not root:',
        '        return False',
        '    if not root.left and not root.right:',
        '        return root.val == targetSum',
        '    return pathSum(root.left, targetSum - root.val) or pathSum(root.right, targetSum - root.val)',
      ].join('\n');
      // targetSum=5: path 5->4->11->2 sums to 22; tree [5,4,8,11,null,13,4,7,2] with target 22
      const script = buildPythonScript(code, '[5,4,8,11,null,13,4,7,2,null,null,null,1]', '{"targetSum": 22}', null);
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(0);
    });

    test('extra param entry call uses _globs.get()', () => {
      const code = 'def countAtDepth(root, depth):\n    return 0';
      const script = buildPythonScript(code, '[1]', '{"depth": 3}', null);
      expect(script).toContain('_globs.get("depth", None)');
    });

    test('extra param defaults to None when not in globals', () => {
      const code = [
        'def pathSum(root, targetSum):',
        '    if not root:',
        '        return False',
        '    return pathSum(root.left, targetSum) or pathSum(root.right, targetSum)',
      ].join('\n');
      // targetSum not provided → defaults to None; function will execute without NameError
      const script = buildPythonScript(code, '[1]', '{}', null);
      const output = runScript(script);
      // Should not crash with a NameError — may return a result or Python error
      expect(output).toBeDefined();
      expect(output).not.toHaveProperty('execError');
    });
  });

  // ── Custom Node class preservation ────────────────────────────────────────

  describe('custom Node class preservation', () => {
    test('custom Node class is preserved and traversal works correctly', () => {
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
      const script = buildPythonScript(code, '[1,2,3,4,5]', '{}', null);
      // Node class should not be stripped
      expect(script).toContain('class Node:');
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(0);
    });
  });

  // ── Multiple functions ─────────────────────────────────────────────────────

  describe('multiple functions', () => {
    test('first function is used as the entry point', () => {
      const code = [
        'def main(root):',
        '    return helper(root)',
        'def helper(node):',
        '    return node.val if node else 0',
      ].join('\n');
      const script = buildPythonScript(code, '[1]', '{}', null);
      expect(script).toContain('_wrapped_main(');
      expect(script).toContain('def _original_main(');
      expect(script).toContain('def _original_helper(');
    });

    test('generates wrappers for all helper functions', () => {
      const code = [
        'def solve(root):',
        '    return helper(root)',
        'def helper(node):',
        '    return 0',
      ].join('\n');
      const script = buildPythonScript(code, '[1]', '{}', null);
      expect(script).toContain('def _wrapped_solve(');
      expect(script).toContain('def _wrapped_helper(');
    });
  });

  // ── Non-primitive return values ────────────────────────────────────────────

  describe('non-primitive return values', () => {
    test('function returning a TreeNode (e.g. invertTree) does not crash', () => {
      const code = [
        'def invertTree(root):',
        '    if not root:',
        '        return None',
        '    root.left, root.right = invertTree(root.right), invertTree(root.left)',
        '    return root',
      ].join('\n');
      const script = buildPythonScript(code, '[4,2,7,1,3,6,9]', '{}', null);
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(Array.isArray(output.steps)).toBe(true);
      expect(output.steps.length).toBeGreaterThan(0);
    });

    test('return steps from invertTree have a serializable result (node val, not object)', () => {
      const code = [
        'def invertTree(root):',
        '    if not root:',
        '        return None',
        '    root.left, root.right = invertTree(root.right), invertTree(root.left)',
        '    return root',
      ].join('\n');
      const script = buildPythonScript(code, '[4,2,7]', '{}', null);
      const { steps } = runScript(script);
      const returnSteps = steps.filter(s => s.type === 'return' && s.result !== null);
      expect(returnSteps.length).toBeGreaterThan(0);
      returnSteps.forEach(s => {
        // result must be a primitive (number), not an object
        expect(typeof s.result).toBe('number');
      });
    });

    test('LeetCode-style invertTree with class Solution does not crash', () => {
      const code = [
        'class Solution:',
        '    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:',
        '        if not root:',
        '            return None',
        '        root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)',
        '        return root',
      ].join('\n');
      const script = buildPythonScript(code, '[4,2,7,1,3,6,9]', '{}', null);
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(0);
    });

    test('function returning a list (e.g. inorder) does not crash', () => {
      const code = [
        'def inorder(root):',
        '    if not root:',
        '        return []',
        '    return inorder(root.left) + [root.val] + inorder(root.right)',
      ].join('\n');
      const script = buildPythonScript(code, '[2,1,3]', '{}', null);
      const { steps } = runScript(script);
      expect(steps).toBeDefined();
      expect(steps.length).toBeGreaterThan(0);
      const returnSteps = steps.filter(s => s.type === 'return');
      returnSteps.forEach(s => {
        expect(Array.isArray(s.result) || s.result === null).toBe(true);
      });
    });

    test('stack frames also have serializable results after returning a TreeNode', () => {
      const code = [
        'def invertTree(root):',
        '    if not root:',
        '        return None',
        '    root.left, root.right = invertTree(root.right), invertTree(root.left)',
        '    return root',
      ].join('\n');
      const script = buildPythonScript(code, '[1,2,3]', '{}', null);
      const { steps } = runScript(script);
      // Verify every step is JSON-round-trippable (i.e. no non-serializable objects leaked)
      expect(() => JSON.stringify(steps)).not.toThrow();
    });
  });

  // ── Step limit ─────────────────────────────────────────────────────────────

  describe('step limit', () => {
    test('returns an error when step limit is exceeded', () => {
      // A perfect binary tree with 2047 nodes produces 4094 steps (call+return per node),
      // which exceeds the 2000-step limit.
      const code = [
        'def countNodes(root):',
        '    if not root:',
        '        return 0',
        '    return 1 + countNodes(root.left) + countNodes(root.right)',
      ].join('\n');
      // 2047-element level-order array = perfect binary tree of depth 10
      const bigTree = Array.from({ length: 2047 }, (_, i) => i + 1);
      const script = buildPythonScript(code, JSON.stringify(bigTree), '{}', null);
      const output = runScript(script);
      expect(output.error).toBeDefined();
      expect(output.error).toMatch(/Exceeded maximum number of steps/i);
    });
  });
});
