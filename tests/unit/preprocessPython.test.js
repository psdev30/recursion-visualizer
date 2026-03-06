'use strict';

const { preprocessPython } = require('../../lib/pythonScripts');

describe('preprocessPython', () => {
  // ── Comment removal ────────────────────────────────────────────────────────

  describe('comment removal', () => {
    test('removes a single comment-only line', () => {
      const input = '# This is a comment\ndef foo(x):\n    return x';
      const result = preprocessPython(input);
      expect(result).not.toContain('# This is a comment');
      expect(result).toContain('def foo(x):');
    });

    test('removes indented comment lines', () => {
      const input = 'def foo(x):\n    # inner comment\n    return x';
      const result = preprocessPython(input);
      expect(result).not.toContain('# inner comment');
    });

    test('preserves inline comments on code lines', () => {
      // Lines where # is NOT the first non-whitespace character are kept
      const input = 'def foo(x):  # inline\n    return x';
      const result = preprocessPython(input);
      expect(result).toContain('def foo(x):  # inline');
    });

    test('removes multiple comment lines', () => {
      const input = '# line 1\n# line 2\ndef foo(x):\n    return x';
      const result = preprocessPython(input);
      expect(result).not.toMatch(/# line/);
    });
  });

  // ── Class unwrapping ───────────────────────────────────────────────────────

  describe('class Solution unwrapping', () => {
    test('removes class header and de-indents methods', () => {
      const input = [
        'class Solution:',
        '    def maxDepth(self, root):',
        '        return 1',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).not.toContain('class Solution:');
      expect(result).toContain('def maxDepth(');
      // Should be de-indented (no leading 4 spaces)
      expect(result).not.toMatch(/^    def maxDepth/m);
    });

    test('removes self from parameter list', () => {
      const input = [
        'class Solution:',
        '    def solve(self, node):',
        '        return node.val',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('def solve(node):');
      expect(result).not.toContain('self');
    });

    test('removes self when it is the only parameter', () => {
      const input = [
        'class Solution:',
        '    def solve(self):',
        '        return 0',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('def solve():');
    });

    test('handles arbitrary class name (not just Solution)', () => {
      const input = [
        'class MyAlgo:',
        '    def dfs(self, node):',
        '        pass',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).not.toContain('class MyAlgo:');
      expect(result).toContain('def dfs(node):');
    });

    test('de-indents multiple methods in the same class', () => {
      const input = [
        'class Solution:',
        '    def helper(self, node):',
        '        return node',
        '    def solve(self, root):',
        '        return self.helper(root)',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('def helper(node):');
      expect(result).toContain('def solve(root):');
    });

    test('stops de-indenting when leaving class scope', () => {
      const input = [
        'class Solution:',
        '    def solve(self, node):',
        '        return 1',
        'x = 42',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('x = 42');
    });
  });

  // ── Type annotation removal ────────────────────────────────────────────────

  describe('type annotation removal', () => {
    test('removes type annotations from parameters', () => {
      const input = 'def solve(self, root: Optional[TreeNode]) -> int:\n    return 0';
      const result = preprocessPython(input);
      expect(result).toContain('def solve(root):');
      expect(result).not.toContain('Optional');
      expect(result).not.toContain('-> int');
    });

    test('removes return type annotation', () => {
      const input = 'def maxDepth(self, root: TreeNode) -> int:\n    pass';
      const result = preprocessPython(input);
      expect(result).toContain('def maxDepth(root):');
      expect(result).not.toContain('-> int');
    });

    test('preserves parameters without annotations', () => {
      const input = 'def foo(a, b, c):\n    return a + b + c';
      const result = preprocessPython(input);
      expect(result).toContain('def foo(a, b, c):');
    });

    test('handles mixed annotated and unannotated params', () => {
      const input = 'def foo(self, a: int, b, c: str) -> bool:\n    pass';
      const result = preprocessPython(input);
      expect(result).toContain('def foo(a, b, c):');
    });
  });

  // ── self.method() replacement ──────────────────────────────────────────────

  describe('self.method() replacement', () => {
    test('replaces self.method( with method(', () => {
      const input = [
        'class Solution:',
        '    def solve(self, root):',
        '        return self.helper(root)',
        '    def helper(self, node):',
        '        return node.val',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('return helper(root)');
      expect(result).not.toContain('self.helper(');
    });

    test('handles multiple self calls on same line', () => {
      const input = 'def foo(self, a, b):\n    return self.bar(a) + self.baz(b)';
      const result = preprocessPython(input);
      expect(result).toContain('return bar(a) + baz(b)');
    });
  });

  // ── Plain functions (no class) ─────────────────────────────────────────────

  describe('plain functions without a class', () => {
    test('leaves plain function untouched structurally', () => {
      const input = 'def inorder(root):\n    if not root:\n        return []\n    return inorder(root.left) + [root.val] + inorder(root.right)';
      const result = preprocessPython(input);
      expect(result).toContain('def inorder(root):');
      expect(result).toContain('return inorder(root.left)');
    });

    test('still removes comment lines from plain functions', () => {
      const input = '# preamble\ndef dfs(node):\n    pass';
      const result = preprocessPython(input);
      expect(result).not.toContain('# preamble');
      expect(result).toContain('def dfs(node):');
    });
  });

  // ── Custom data-structure classes ──────────────────────────────────────────

  describe('custom data-structure class preservation', () => {
    test('preserves a class that has __init__ (data structure, not solution wrapper)', () => {
      const input = [
        'class Node:',
        '    def __init__(self, val):',
        '        self.val = val',
        '        self.left = None',
        '        self.right = None',
        '',
        'def traverse(root):',
        '    if not root:',
        '        return []',
        '    return traverse(root.left) + [root.val] + traverse(root.right)',
      ].join('\n');
      const result = preprocessPython(input);
      // Node class should survive intact
      expect(result).toContain('class Node:');
      expect(result).toContain('def __init__');
      expect(result).toContain('self.val = val');
      // Standalone function should still be present
      expect(result).toContain('def traverse(root):');
    });

    test('still strips a Solution class that has no __init__', () => {
      const input = [
        'class Solution:',
        '    def solve(self, root):',
        '        return 0',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).not.toContain('class Solution:');
      expect(result).toContain('def solve(root):');
    });

    test('handles both a data-structure class and a Solution class together', () => {
      const input = [
        'class Node:',
        '    def __init__(self, val):',
        '        self.val = val',
        '',
        'class Solution:',
        '    def build(self, vals):',
        '        return Node(vals[0])',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('class Node:');
      expect(result).not.toContain('class Solution:');
      expect(result).toContain('def build(vals):');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('handles empty string gracefully', () => {
      expect(() => preprocessPython('')).not.toThrow();
    });

    test('returns a string', () => {
      expect(typeof preprocessPython('def foo(): pass')).toBe('string');
    });

    test('handles function with no params (only self)', () => {
      const input = [
        'class Solution:',
        '    def solve(self):',
        '        return 0',
      ].join('\n');
      const result = preprocessPython(input);
      expect(result).toContain('def solve():');
    });

    test('preserves code indentation inside methods', () => {
      const input = [
        'class Solution:',
        '    def solve(self, root):',
        '        if not root:',
        '            return 0',
        '        return 1',
      ].join('\n');
      const result = preprocessPython(input);
      // After de-indenting 4 spaces, inner body should still be indented by 4
      expect(result).toContain('    if not root:');
      expect(result).toContain('        return 0');
    });
  });
});
