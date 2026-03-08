'use strict';

const { buildLineMap } = require('../../lib/pythonScripts');

describe('buildLineMap', () => {
  test('maps a single function to its 1-based line number', () => {
    const code = 'def solve(root):\n    return root.val';
    const map = buildLineMap(code);
    expect(map).toEqual({ solve: 1 });
  });

  test('maps multiple functions to correct line numbers', () => {
    const code = [
      'def foo(x):',      // line 1
      '    return x',     // line 2
      'def bar(y):',      // line 3
      '    return y',     // line 4
    ].join('\n');
    const map = buildLineMap(code);
    expect(map.foo).toBe(1);
    expect(map.bar).toBe(3);
  });

  test('returns empty object when no def statements are present', () => {
    const code = 'x = 1\ny = 2\nprint(x + y)';
    expect(buildLineMap(code)).toEqual({});
  });

  test('ignores indented def-like patterns that are not definitions', () => {
    // The regex /def\s+(\w+)\s*\(/ catches anything with `def `, so a
    // nested def inside a string would be matched — but that is the
    // existing behavior and this test documents it.
    const code = [
      'def outer(x):',   // line 1
      '    def inner(y):', // line 2
      '        return y',
    ].join('\n');
    const map = buildLineMap(code);
    expect(map.outer).toBe(1);
    expect(map.inner).toBe(2);
  });

  test('handles class method defs (works on raw code with class wrapper)', () => {
    const code = [
      'class Solution:',         // line 1
      '    def maxDepth(self, root):', // line 2
      '        return 0',
    ].join('\n');
    const map = buildLineMap(code);
    expect(map.maxDepth).toBe(2);
  });

  test('handles empty string', () => {
    expect(buildLineMap('')).toEqual({});
  });

  test('overwrites earlier mapping when same function name appears twice', () => {
    // Unusual but shouldn't throw — last occurrence wins
    const code = 'def foo(x):\n    pass\ndef foo(y):\n    pass';
    const map = buildLineMap(code);
    // foo appears on lines 1 and 3 — last definition at line 3 overwrites
    expect(map.foo).toBe(3);
  });

  // ── Breakpoint-relevant cases ──────────────────────────────────────────────

  test('functions with type annotations are correctly mapped', () => {
    // LeetCode-style signatures with type hints — the regex must still capture the name
    const code = [
      'def maxDepth(root: Optional[TreeNode]) -> int:',  // line 1
      '    return 0',
      'def minDepth(root: Optional[TreeNode]) -> int:',  // line 3
      '    return 0',
    ].join('\n');
    const map = buildLineMap(code);
    expect(map.maxDepth).toBe(1);
    expect(map.minDepth).toBe(3);
  });

  test('blank lines between functions do not shift line numbers', () => {
    const code = [
      'def alpha(x):',   // line 1
      '    return x',    // line 2
      '',                // line 3 (blank)
      '',                // line 4 (blank)
      'def beta(y):',    // line 5
      '    return y',
    ].join('\n');
    const map = buildLineMap(code);
    expect(map.alpha).toBe(1);
    expect(map.beta).toBe(5);
  });

  test('lineMap keys are exactly the function names (no extra whitespace)', () => {
    const code = 'def   myFunc  (x):   # trailing stuff\n    pass';
    const map = buildLineMap(code);
    // The regex captures the word after "def\s+" — name is "myFunc", not "myFunc  "
    expect(Object.keys(map)).toEqual(['myFunc']);
    expect(map['myFunc']).toBe(1);
  });

  test('breakpoint resolution: given a funcName from a step, lineMap returns correct 1-based line', () => {
    // Simulates how the frontend uses lineMap to resolve a step's funcName
    // to a line number for matching against a set breakpoint.
    const code = [
      'def outer(root):',    // line 1  ← breakpoint target
      '    return inner(root)',
      'def inner(root):',    // line 3
      '    return 0',
    ].join('\n');
    const map = buildLineMap(code);

    // Simulate: breakpoints = new Set([1])
    const breakpoints = new Set([1]);
    const stepFuncName = 'outer'; // as returned in step.funcName
    const hitLine = map[stepFuncName];
    expect(breakpoints.has(hitLine)).toBe(true);

    // inner does not hit the breakpoint on line 1
    expect(breakpoints.has(map['inner'])).toBe(false);
  });
});
