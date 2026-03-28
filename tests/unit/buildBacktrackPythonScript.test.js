'use strict';

const { buildBacktrackPythonScript } = require('../../lib/pythonScripts');

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

describe('buildBacktrackPythonScript', () => {
  // ── Error handling ─────────────────────────────────────────────────────────

  describe('input validation', () => {
    test('throws when no function definition is found', () => {
      expect(() =>
        buildBacktrackPythonScript('x = 1', '[]', 7, '{}')
      ).toThrow('Could not find function definition');
    });

    test('returns a string', () => {
      const code = 'def backtrack(candidates, target, path):\n    pass';
      const script = buildBacktrackPythonScript(code, '[2,3,6,7]', 7, '{}');
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });
  });

  // ── Script structure ───────────────────────────────────────────────────────

  describe('generated script structure', () => {
    const baseCode = [
      'def backtrack(candidates, target, path):',
      '    if target == 0:',
      '        return',
      '    for c in candidates:',
      '        if c <= target:',
      '            path.append(c)',
      '            backtrack(candidates, target - c, path)',
      '            path.pop()',
    ].join('\n');

    test('includes _call_id counter', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).toContain('_call_id = [0]');
    });

    test('includes _serialize helper', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).toContain('def _serialize(');
    });

    test('does NOT include TreeNode or build_tree', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).not.toContain('class TreeNode');
      expect(script).not.toContain('def build_tree(');
    });

    test('renames user function to _original_', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).toContain('def _original_backtrack(');
    });

    test('generates inline wrapper function with call_id tracking', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      // Inline wrapper uses the original function name (not _wrapped_)
      expect(script).toMatch(/def backtrack\([^)]*\):\s*\n\s*_call_id\[0\] \+= 1/);
      expect(script).toContain('_call_id[0] += 1');
    });

    test('maps "candidates" param to _candidates', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).toContain('_candidates');
    });

    test('maps "target" param to _target', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).toContain('_target');
    });

    test('maps "path" param to _path', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 5, '{}');
      expect(script).toContain('_path = []');
    });

    test('serializes numeric target correctly', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', 7, '{}');
      expect(script).toContain('_target = 7');
    });

    test('serializes null target as Python None', () => {
      const script = buildBacktrackPythonScript(baseCode, '[2,3]', null, '{}');
      expect(script).toContain('_target = None');
    });

    test('converts null/true/false in candidates JSON', () => {
      const code = 'def solve(candidates, target):\n    pass';
      const script = buildBacktrackPythonScript(code, '[1,null,true,false]', 1, '{}');
      expect(script).toContain('None');
      expect(script).toContain('True');
      expect(script).toContain('False');
    });
  });

  // ── Execution ──────────────────────────────────────────────────────────────

  describe('execution', () => {
    test('produces call and return steps', () => {
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
      const script = buildBacktrackPythonScript(code, '[2,3]', 4, '{}');
      const output = runScript(script);

      expect(output.steps).toBeDefined();
      expect(Array.isArray(output.steps)).toBe(true);
      expect(output.steps.length).toBeGreaterThan(0);

      const types = new Set(output.steps.map(s => s.type));
      expect(types.has('call')).toBe(true);
      expect(types.has('return')).toBe(true);
    });

    test('each step has nodeId (call_id) and nodeVal (label)', () => {
      const code = [
        'def bt(candidates, target, path):',
        '    if target <= 0:',
        '        return',
        '    bt(candidates, target - candidates[0], path)',
      ].join('\n');
      const script = buildBacktrackPythonScript(code, '[1]', 2, '{}');
      const { steps } = runScript(script);

      for (const step of steps) {
        expect(step).toHaveProperty('nodeId');
        expect(step).toHaveProperty('nodeVal');
        expect(step).toHaveProperty('funcName');
        expect(step).toHaveProperty('message');
      }
    });

    test('call IDs are unique and incrementing', () => {
      const code = [
        'def bt(candidates, target, path):',
        '    if target <= 0:',
        '        return',
        '    bt(candidates, target - candidates[0], path)',
      ].join('\n');
      const script = buildBacktrackPythonScript(code, '[1]', 2, '{}');
      const { steps } = runScript(script);

      const callSteps = steps.filter(s => s.type === 'call');
      const ids = callSteps.map(s => s.nodeId);
      // All IDs should be unique
      expect(new Set(ids).size).toBe(ids.length);
      // IDs should be monotonically increasing
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThan(ids[i - 1]);
      }
    });

    test('handles LeetCode-style class code with nested functions', () => {
      const code = [
        'class Solution:',
        '    def combinationSum(self, candidates, target):',
        '        results = []',
        '        def backtrack(start, path, remaining):',
        '            if remaining == 0:',
        '                results.append(list(path))',
        '                return',
        '            for i in range(start, len(candidates)):',
        '                if candidates[i] <= remaining:',
        '                    path.append(candidates[i])',
        '                    backtrack(i, path, remaining - candidates[i])',
        '                    path.pop()',
        '        backtrack(0, [], target)',
        '        return results',
      ].join('\n');
      const script = buildBacktrackPythonScript(code, '[2,3,6,7]', 7, '{}');
      const output = runScript(script);

      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(2);

      // Should trace both the outer combinationSum and inner backtrack calls
      const funcNames = new Set(output.steps.map(s => s.funcName));
      expect(funcNames.has('backtrack')).toBe(true);

      // Backtrack calls should have meaningful labels (not just "4")
      const btCalls = output.steps.filter(s => s.type === 'call' && s.funcName === 'backtrack');
      expect(btCalls.length).toBeGreaterThan(1);
    });

    test('globals are included in each step', () => {
      const code = [
        'def bt(candidates, target, globals):',
        '    globals["calls"] = globals.get("calls", 0) + 1',
        '    if target <= 0:',
        '        return',
        '    bt(candidates, target - candidates[0], globals)',
      ].join('\n');
      const script = buildBacktrackPythonScript(code, '[1]', 2, '{"calls": 0}');
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      for (const step of output.steps) {
        expect(step).toHaveProperty('globals');
      }
    });
  });
});
