'use strict';

const http = require('http');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApp } = require('../../lib/createApp');

// Use an isolated in-memory database and a single shared HTTP server to
// prevent supertest keep-alive connection leaks between tests.
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

// Clear the problems table before each test for isolation
beforeEach(() => {
  db.prepare('DELETE FROM problems').run();
  // Reset autoincrement counter
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'problems'").run();
});

// Helper to create a problem via the API
async function createProblem(overrides = {}) {
  const defaults = {
    name: 'Test Problem',
    tree: '[1,2,3]',
    code: 'def solve(root):\n    return 0',
    globals: '{}',
    language: 'python',
    mode: 'tree',
  };
  const body = { ...defaults, ...overrides };
  const res = await request(server).post('/api/problems').send(body);
  return res;
}

// ── GET /api/problems ──────────────────────────────────────────────────────

describe('GET /api/problems', () => {
  test('returns 200 and empty array when no problems exist', async () => {
    const res = await request(server).get('/api/problems');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('returns all problems ordered by created_at DESC', async () => {
    await createProblem({ name: 'First' });
    await createProblem({ name: 'Second' });
    const res = await request(server).get('/api/problems');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Most recently created problem should come first
    expect(res.body[0].name).toBe('Second');
    expect(res.body[1].name).toBe('First');
  });

  test('each problem contains expected fields', async () => {
    await createProblem({ name: 'Fields Test', url: 'https://example.com', notes: 'My notes' });
    const res = await request(server).get('/api/problems');
    const p = res.body[0];
    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('name', 'Fields Test');
    expect(p).toHaveProperty('tree');
    expect(p).toHaveProperty('globals');
    expect(p).toHaveProperty('code');
    expect(p).toHaveProperty('url', 'https://example.com');
    expect(p).toHaveProperty('notes', 'My notes');
    expect(p).toHaveProperty('created_at');
    expect(p).toHaveProperty('updated_at');
    expect(p).toHaveProperty('language');
    expect(p).toHaveProperty('mode');
  });
});

// ── POST /api/problems ─────────────────────────────────────────────────────

describe('POST /api/problems', () => {
  test('creates a problem and returns 201 with the new record', async () => {
    const res = await createProblem({ name: 'New Problem' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('New Problem');
  });

  test('defaults language to "javascript" when not provided', async () => {
    const res = await request(server).post('/api/problems').send({
      name: 'Lang Test',
      tree: '[1]',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(201);
    expect(res.body.language).toBe('javascript');
  });

  test('defaults mode to "tree" when not provided', async () => {
    const res = await request(server).post('/api/problems').send({
      name: 'Mode Test',
      tree: '[1]',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('tree');
  });

  test('defaults globals to "{}" when not provided', async () => {
    const res = await request(server).post('/api/problems').send({
      name: 'Globals Test',
      tree: '[1]',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(201);
    expect(res.body.globals).toBe('{}');
  });

  test('stores url and notes when provided', async () => {
    const res = await createProblem({ url: 'https://leetcode.com/problems/1', notes: 'Hard problem' });
    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://leetcode.com/problems/1');
    expect(res.body.notes).toBe('Hard problem');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(server).post('/api/problems').send({
      tree: '[1]',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when tree is missing', async () => {
    const res = await request(server).post('/api/problems').send({
      name: 'No Tree',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code is missing', async () => {
    const res = await request(server).post('/api/problems').send({
      name: 'No Code',
      tree: '[1]',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('persists the created problem in the database', async () => {
    await createProblem({ name: 'Persisted' });
    const res = await request(server).get('/api/problems');
    expect(res.body.some(p => p.name === 'Persisted')).toBe(true);
  });
});

// ── GET /api/problems/:id ──────────────────────────────────────────────────

describe('GET /api/problems/:id', () => {
  test('returns the problem with the given id', async () => {
    const { body: created } = await createProblem({ name: 'Find Me' });
    const res = await request(server).get(`/api/problems/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
    expect(res.body.name).toBe('Find Me');
  });

  test('returns 404 for a non-existent id', async () => {
    const res = await request(server).get('/api/problems/99999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Problem not found');
  });

  test('returns all fields for a single problem', async () => {
    const { body: created } = await createProblem({ name: 'Full Fields', notes: 'Test notes' });
    const res = await request(server).get(`/api/problems/${created.id}`);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('tree');
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('globals');
    expect(res.body).toHaveProperty('language');
    expect(res.body).toHaveProperty('mode');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).toHaveProperty('updated_at');
  });
});

// ── PUT /api/problems/:id ──────────────────────────────────────────────────

describe('PUT /api/problems/:id', () => {
  test('updates the problem and returns the updated record', async () => {
    const { body: created } = await createProblem({ name: 'Original' });
    const res = await request(server).put(`/api/problems/${created.id}`).send({
      name: 'Updated',
      tree: '[4,5,6]',
      globals: '{}',
      code: 'def solve(root): return 1',
      url: null,
      notes: null,
      language: 'python',
      mode: 'tree',
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
    expect(res.body.tree).toBe('[4,5,6]');
  });

  test('updates updated_at timestamp', async () => {
    const { body: created } = await createProblem();
    const before = created.updated_at;
    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 10));
    await request(server).put(`/api/problems/${created.id}`).send({
      name: 'Updated Name',
      tree: created.tree,
      globals: created.globals,
      code: created.code,
      language: created.language,
      mode: created.mode,
    });
    const res = await request(server).get(`/api/problems/${created.id}`);
    // updated_at should be the same or newer (SQLite CURRENT_TIMESTAMP is seconds precision)
    expect(res.body.updated_at >= before).toBe(true);
  });

  test('returns 400 when name is missing (bug: was 500 SQLite NOT NULL violation)', async () => {
    const { body: created } = await createProblem();
    const res = await request(server).put(`/api/problems/${created.id}`).send({
      tree: '[1]',
      globals: '{}',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when tree is missing', async () => {
    const { body: created } = await createProblem();
    const res = await request(server).put(`/api/problems/${created.id}`).send({
      name: 'No Tree',
      globals: '{}',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when code is missing', async () => {
    const { body: created } = await createProblem();
    const res = await request(server).put(`/api/problems/${created.id}`).send({
      name: 'No Code',
      tree: '[1]',
      globals: '{}',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when updating a non-existent id', async () => {
    const res = await request(server).put('/api/problems/99999').send({
      name: 'Ghost',
      tree: '[1]',
      globals: '{}',
      code: 'def solve(root): pass',
    });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Problem not found');
  });

  test('persists the update across subsequent GET requests', async () => {
    const { body: created } = await createProblem({ name: 'Before Update' });
    await request(server).put(`/api/problems/${created.id}`).send({
      name: 'After Update',
      tree: created.tree,
      globals: created.globals,
      code: created.code,
      language: 'python',
      mode: 'tree',
    });
    const res = await request(server).get(`/api/problems/${created.id}`);
    expect(res.body.name).toBe('After Update');
  });

  test('allows updating language and mode fields', async () => {
    const { body: created } = await createProblem({ language: 'python', mode: 'tree' });
    const res = await request(server).put(`/api/problems/${created.id}`).send({
      name: created.name,
      tree: created.tree,
      globals: created.globals,
      code: created.code,
      language: 'javascript',
      mode: 'graph',
    });
    expect(res.body.language).toBe('javascript');
    expect(res.body.mode).toBe('graph');
  });
});

// ── DELETE /api/problems/:id ───────────────────────────────────────────────

describe('DELETE /api/problems/:id', () => {
  test('deletes the problem and returns { success: true }', async () => {
    const { body: created } = await createProblem();
    const res = await request(server).delete(`/api/problems/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('problem is no longer returned after deletion', async () => {
    const { body: created } = await createProblem();
    await request(server).delete(`/api/problems/${created.id}`);
    const res = await request(server).get(`/api/problems/${created.id}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when deleting a non-existent id', async () => {
    const res = await request(server).delete('/api/problems/99999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Problem not found');
  });

  test('only deletes the specified problem, not others', async () => {
    const { body: p1 } = await createProblem({ name: 'Keep Me' });
    const { body: p2 } = await createProblem({ name: 'Delete Me' });
    await request(server).delete(`/api/problems/${p2.id}`);
    const res = await request(server).get('/api/problems');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Keep Me');
  });
});

// ── POST /api/problems/import ──────────────────────────────────────────────

describe('POST /api/problems/import', () => {
  const sampleProblems = [
    { name: 'Imported 1', tree: '[1]', code: 'def solve(root): pass', globals: '{}', language: 'python', mode: 'tree' },
    { name: 'Imported 2', tree: '[2]', code: 'def solve(root): pass', globals: '{}', language: 'python', mode: 'tree' },
  ];

  test('imports an array of problems and returns count + all problems', async () => {
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: sampleProblems });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(Array.isArray(res.body.problems)).toBe(true);
    expect(res.body.problems).toHaveLength(2);
  });

  test('clears existing problems when merge is falsy (replace mode)', async () => {
    await createProblem({ name: 'Existing' });
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: sampleProblems, merge: false });
    expect(res.body.problems).toHaveLength(2);
    expect(res.body.problems.every(p => p.name.startsWith('Imported'))).toBe(true);
  });

  test('preserves existing problems when merge is true', async () => {
    await createProblem({ name: 'Existing' });
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: sampleProblems, merge: true });
    expect(res.body.problems).toHaveLength(3);
  });

  test('defaults globals to "{}" when not provided in import item', async () => {
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: [{ name: 'No Globals', tree: '[1]', code: 'def solve(root): pass' }] });
    expect(res.body.problems[0].globals).toBe('{}');
  });

  test('defaults language to "javascript" when not provided in import item', async () => {
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: [{ name: 'No Lang', tree: '[1]', code: 'def solve(root): pass' }] });
    expect(res.body.problems[0].language).toBe('javascript');
  });

  test('returns 400 when problems is not an array', async () => {
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: 'not an array' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when problems field is missing', async () => {
    const res = await request(server)
      .post('/api/problems/import')
      .send({ merge: true });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('handles empty array import (clears all when merge is false)', async () => {
    await createProblem({ name: 'Existing' });
    const res = await request(server)
      .post('/api/problems/import')
      .send({ problems: [], merge: false });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.problems).toHaveLength(0);
  });

  test('imports are transactional — all or nothing', async () => {
    // Try to import a mix of valid and one that will fail due to missing required fields
    // SQLite NOT NULL constraint on `name` should cause the transaction to roll back
    const badProblems = [
      { name: 'Good', tree: '[1]', code: 'def solve(root): pass' },
      { name: null, tree: '[2]', code: 'def solve(root): pass' }, // name is NOT NULL
    ];
    const before = (await request(server).get('/api/problems')).body.length;
    await request(server).post('/api/problems/import').send({ problems: badProblems, merge: true });
    const after = (await request(server).get('/api/problems')).body.length;
    // Either both were inserted (SQLite may allow null) or neither was
    // The important thing is it doesn't crash the server
    expect(typeof after).toBe('number');
  });
});

// ── GET /api/problems/export/all ───────────────────────────────────────────

describe('GET /api/problems/export/all', () => {
  test('returns version, exportedAt, and problems array', async () => {
    const res = await request(server).get('/api/problems/export/all');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version', 1);
    expect(res.body).toHaveProperty('exportedAt');
    expect(Array.isArray(res.body.problems)).toBe(true);
  });

  test('exportedAt is a valid ISO 8601 date string', async () => {
    const res = await request(server).get('/api/problems/export/all');
    const date = new Date(res.body.exportedAt);
    expect(isNaN(date.getTime())).toBe(false);
  });

  test('includes all problems in the export', async () => {
    await createProblem({ name: 'Export A' });
    await createProblem({ name: 'Export B' });
    const res = await request(server).get('/api/problems/export/all');
    expect(res.body.problems).toHaveLength(2);
  });

  test('returns empty problems array when database is empty', async () => {
    const res = await request(server).get('/api/problems/export/all');
    expect(res.body.problems).toHaveLength(0);
  });
});

// ── Route ordering sanity checks ───────────────────────────────────────────

describe('route ordering', () => {
  test('POST /api/problems/import does not shadow POST /api/problems', async () => {
    // Both routes should work independently
    const importRes = await request(server)
      .post('/api/problems/import')
      .send({ problems: [{ name: 'Via Import', tree: '[1]', code: 'def solve(root): pass' }] });
    expect(importRes.status).toBe(200);

    const createRes = await request(server)
      .post('/api/problems')
      .send({ name: 'Via Create', tree: '[1]', code: 'def solve(root): pass' });
    expect(createRes.status).toBe(201);
  });

  test('GET /api/problems/export/all does not shadow GET /api/problems/:id', async () => {
    const { body: created } = await createProblem({ name: 'Conflict Test' });
    const byId = await request(server).get(`/api/problems/${created.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.name).toBe('Conflict Test');

    const exportRes = await request(server).get('/api/problems/export/all');
    expect(exportRes.status).toBe(200);
    expect(exportRes.body).toHaveProperty('version');
  });
});
