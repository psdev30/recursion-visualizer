'use strict';

const { buildGraphPythonScript } = require('../../lib/pythonScripts');

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

describe('buildGraphPythonScript', () => {
  // ── Error handling ─────────────────────────────────────────────────────────

  describe('input validation', () => {
    test('throws when no function definition is found', () => {
      expect(() =>
        buildGraphPythonScript('x = 1', '{}', 0, '{}')
      ).toThrow('Could not find function definition');
    });

    test('returns a string', () => {
      const code = 'def dfs(node, graph, visited):\n    pass';
      const script = buildGraphPythonScript(code, '{"0": [1]}', 0, '{}');
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });
  });

  // ── Script structure ───────────────────────────────────────────────────────

  describe('generated script structure', () => {
    const baseCode = [
      'def dfs(node, graph, visited):',
      '    if node in visited:',
      '        return',
      '    visited.add(node)',
      '    for n in graph.get(node, []):',
      '        dfs(n, graph, visited)',
    ].join('\n');

    test('includes graph tracing infrastructure', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1,2]}', 0, '{}');
      expect(script).toContain('_record_call');
      expect(script).toContain('_record_return');
      expect(script).toContain('_MAX_STEPS = 2000');
    });

    test('does NOT include TreeNode or build_tree', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1]}', 0, '{}');
      expect(script).not.toContain('class TreeNode');
      expect(script).not.toContain('def build_tree(');
    });

    test('includes _serialize helper for sets', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1]}', 0, '{}');
      expect(script).toContain('def _serialize(');
    });

    test('renames user function with _original_ prefix', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1]}', 0, '{}');
      expect(script).toContain('def _original_dfs(');
    });

    test('generates _wrapped_ function', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1]}', 0, '{}');
      expect(script).toContain('def _wrapped_dfs(');
    });

    test('converts JSON keys to int in graph dict', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1,2]}', 0, '{}');
      expect(script).toContain('{int(k): v for k, v in');
    });

    test('passes start node as first argument', () => {
      const script = buildGraphPythonScript(baseCode, '{"5":[6]}', 5, '{}');
      expect(script).toContain('_wrapped_dfs(5');
    });

    test('maps "graph" param to _graph', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1]}', 0, '{}');
      expect(script).toContain('_graph');
    });

    test('maps "visited" param to _visited', () => {
      const script = buildGraphPythonScript(baseCode, '{"0":[1]}', 0, '{}');
      expect(script).toContain('_visited');
    });

    test('converts null/true/false in globals JSON', () => {
      const code = 'def dfs(node, globals):\n    pass';
      const script = buildGraphPythonScript(code, '{}', 0, '{"active": true, "x": null}');
      expect(script).toContain('True');
      expect(script).toContain('None');
    });
  });

  // ── Execution ──────────────────────────────────────────────────────────────

  describe('execution', () => {
    test('produces call and return steps for simple graph DFS', () => {
      const code = [
        'def dfs(node, graph, visited):',
        '    if node in visited:',
        '        return',
        '    visited.add(node)',
        '    for n in graph.get(node, []):',
        '        dfs(n, graph, visited)',
      ].join('\n');
      const adj = JSON.stringify({ 0: [1, 2], 1: [], 2: [] });
      const script = buildGraphPythonScript(code, adj, 0, '{}');
      const output = runScript(script);

      expect(output.steps).toBeDefined();
      expect(Array.isArray(output.steps)).toBe(true);
      expect(output.steps.length).toBeGreaterThan(0);

      const types = new Set(output.steps.map(s => s.type));
      expect(types.has('call')).toBe(true);
      expect(types.has('return')).toBe(true);
    });

    test('each step includes nodeId and nodeVal; call steps have activeNode, return steps have returningNode', () => {
      const code = [
        'def dfs(node, graph, visited):',
        '    if node in visited:',
        '        return',
        '    visited.add(node)',
        '    for n in graph.get(node, []):',
        '        dfs(n, graph, visited)',
      ].join('\n');
      const adj = JSON.stringify({ 0: [1], 1: [] });
      const script = buildGraphPythonScript(code, adj, 0, '{}');
      const { steps } = runScript(script);

      for (const step of steps) {
        expect(step).toHaveProperty('nodeId');
        expect(step).toHaveProperty('nodeVal');
        if (step.type === 'call') {
          expect(step).toHaveProperty('activeNode');
        } else {
          expect(step).toHaveProperty('returningNode');
        }
      }
    });

    test('handles graph with a single node and no edges', () => {
      const code = [
        'def dfs(node, graph, visited):',
        '    visited.add(node)',
      ].join('\n');
      const script = buildGraphPythonScript(code, '{"0":[]}', 0, '{}');
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(0);
    });

    test('handles LeetCode-style class code in graph mode', () => {
      const code = [
        'class Solution:',
        '    def dfs(self, node, graph, visited):',
        '        if node in visited:',
        '            return',
        '        visited.add(node)',
        '        for n in graph.get(node, []):',
        '            self.dfs(n, graph, visited)',
      ].join('\n');
      const adj = JSON.stringify({ 0: [1], 1: [] });
      const script = buildGraphPythonScript(code, adj, 0, '{}');
      const output = runScript(script);
      expect(output.steps).toBeDefined();
      expect(output.steps.length).toBeGreaterThan(0);
    });

    test('serializes set values in globals to lists', () => {
      const code = [
        'def dfs(node, graph, visited):',
        '    visited.add(node)',
      ].join('\n');
      const script = buildGraphPythonScript(code, '{"0":[]}', 0, '{}');
      const output = runScript(script);
      // Should not throw during JSON parsing (sets become lists)
      expect(output.steps).toBeDefined();
    });
  });
});
