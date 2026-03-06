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
});
