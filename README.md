# Recursion Visualizer

An interactive debugger for recursive algorithms. Paste any Python recursive function, hit Run, and watch every call and return animate step-by-step across a live tree, call stack, variable panel, and call tree — all synchronized in real time.

**[Live demo →](https://github.com/psdev30/recursion-visualizer)**

---

## What it does

Most people learn recursion by staring at code or mentally tracing through it. This tool makes the execution visible:

- The **tree** lights up as each node is visited, showing which node is currently active, which ones are waiting on the stack, and which have already returned
- The **call stack** panel shows the exact frames on the stack at every moment, with live variable values
- The **call tree** shows the full shape of the recursion — every branch, in order, with return values annotated
- The **code panel** highlights the function being executed at each step
- **Breakpoints** let you jump instantly to any specific recursive call, just like a real debugger

---

## Modes

### Tree mode
Visualize recursive functions that traverse a binary tree. Input your tree as a level-order array (the same format LeetCode uses) and write your function against a standard `TreeNode` with `.val`, `.left`, and `.right`.

```python
def maxDepth(root):
    if not root:
        return 0
    return 1 + max(maxDepth(root.left), maxDepth(root.right))
```

Tree input: `[3, 9, 20, null, null, 15, 7]`

**Two-tree mode:** Click `+ Add Tree` to add a second tree — useful for problems like Same Tree or Lowest Common Ancestor that operate on two trees simultaneously. Both trees are visualized side-by-side and highlighted in sync.

### Graph mode
Visualize recursive graph traversals. Provide the graph as a JSON adjacency list and choose a start node.

```python
def dfs(node, graph, visited):
    if node in visited:
        return
    visited.add(node)
    for neighbor in graph.get(node, []):
        dfs(neighbor, graph, visited)
```

Graph input: `{"0": [1, 2], "1": [0, 3], "2": [0], "3": [1]}`

### Backtracking mode
Visualize backtracking algorithms. Provide a candidates array and a target value. The decision tree is rendered as a call tree showing every path explored, including backtracks.

```python
def backtrack(candidates, target, path):
    if target == 0:
        return
    for c in candidates:
        if c <= target:
            path.append(c)
            backtrack(candidates, target - c, path)
            path.pop()
```

### Visualize mode
Just want to see what a tree looks like without running any code? Paste a LeetCode-style level-order array and click **Show Tree** to render it instantly. Supports two-tree comparison.

---

## LeetCode support

Paste code directly from LeetCode — `class Solution` wrapper, `self` parameter, and type annotations are all handled automatically. No cleanup needed.

```python
class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
        if not root:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))
```

---

## Panels

The visualization panel is split into four resizable cards. Every card updates in sync as you step through execution.

| Panel | What it shows |
|---|---|
| **Tree / Graph / Decision Tree** | The data structure with color-coded node states (active, waiting, returning, completed) and return value labels |
| **Call Stack** | Live stack frames with current argument values; top frame is always highlighted |
| **Variables** | Global variables you declared in the Globals JSON field, updated at every step |
| **Code** | Your source code with the currently-executing function highlighted; breakpoint indicators shown inline |
| **Call Tree** | The full recursion tree built from your execution, with return values annotated on each node |
| **Trace** | A chronological log of every call and return event |

The call stack panel also shows **complexity stats** — total calls made and maximum recursion depth — with a "Show Analysis" button for a plain-English time/space complexity breakdown.

---

## Breakpoints

Set a breakpoint by clicking the **gutter** (the area to the left of the line numbers) in the code editor. A red dot appears on that line.

Once a breakpoint is set:

- **⏭ Continue** (or **F8**) — jumps to the next execution step where that function is called, updating the tree, call tree, call stack, and variables all at once
- **▶ Play** — plays through execution automatically and pauses when it hits a breakpointed function
- Click the gutter again to remove the breakpoint

Breakpoints persist across runs — they stay set as you tweak your tree or code and re-run.

---

## Stepping controls

| Control | Action |
|---|---|
| **▶ Play / ⏸ Pause** | Auto-play through steps at the selected speed |
| **← Prev** | Go back one step |
| **Next →** | Advance one step |
| **Reset** | Jump back to step 1 |
| **⏭ Continue** | Jump to next breakpointed call |
| **Speed slider** | Adjust playback speed (1–10) |

**Keyboard shortcuts** (active when the code editor is not focused):

| Key | Action |
|---|---|
| `→` | Next step |
| `←` | Previous step |
| `Space` | Play / Pause |
| `R` | Reset |
| `F8` | Continue to next breakpoint |

---

## Global variables

To track state that persists across recursive calls (like a running maximum or result list), declare it in the **Global Variables** field as JSON:

```json
{"maxDiameter": 0, "result": []}
```

Then access it inside your function:

```python
def diameter(root, globals):
    if not root:
        return 0
    left = diameter(root.left, globals)
    right = diameter(root.right, globals)
    globals["maxDiameter"] = max(globals["maxDiameter"], left + right)
    return 1 + max(left, right)
```

The Variables panel shows the current value of every global at each step.

---

## Saving and loading problems

Click **💾 Save** to persist your current setup (tree, code, globals, mode, notes, and LeetCode URL) to the database. Saved problems appear in the **Load Problem** dropdown at the top.

When a saved problem is loaded, a **Problem Info** card shows your notes and a direct link to the LeetCode problem page.

### Export / Import

- **📤 Export** — downloads all saved problems as a `.json` file
- **📥 Import** — loads problems from a previously exported file, with a preview and a merge-or-replace option

### Share

**🔗 Share** encodes the current tree, code, globals, and mode into the URL so you can send a link directly to a specific visualization.

---

## Running locally

**Requirements:** Node.js 18+ and Python 3

```bash
git clone https://github.com/psdev30/recursion-visualizer
cd recursion-visualizer
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

---

## Docker

```bash
docker build -t recursion-visualizer .
docker run -p 3000:3000 -v recursion-viz-data:/app/db recursion-visualizer
```

The `-v` flag mounts a named volume at `/app/db` so the SQLite database persists across container restarts.

---

## Deploying

The app is a single Node.js process with a SQLite file at `./db/problems.db`. Any platform that runs Node.js works. Mount a persistent volume at `/app/db` to keep your saved problems.

A `render.yaml` is included for one-click deployment to [Render](https://render.com). For other platforms:

| Platform | Persistent volume path |
|---|---|
| Render | `/app/db` (Disk) |
| Railway | `/app/db` (Volume) |
| Fly.io | `/app/db` (Volume) |

---

## REST API

The backend exposes a simple REST API for managing saved problems.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/problems` | List all saved problems |
| `GET` | `/api/problems/:id` | Get a single problem |
| `POST` | `/api/problems` | Create a new problem |
| `PUT` | `/api/problems/:id` | Update a problem |
| `DELETE` | `/api/problems/:id` | Delete a problem |
| `POST` | `/api/problems/import` | Bulk import problems |
| `GET` | `/api/problems/export/all` | Export all problems as JSON |
| `POST` | `/api/execute-python` | Execute a recursive function and return traced steps |

---

## Security

A GitHub Actions workflow runs on every push and pull request:

- **`npm audit`** — fails the build if any dependency has a high or critical advisory
- **Dependency Review** — blocks PRs that introduce newly vulnerable packages
- **CodeQL** — static analysis for injection, path traversal, prototype pollution, and other OWASP-class vulnerabilities

Dependabot opens weekly PRs to keep npm dependencies and GitHub Actions up to date.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML/CSS, CodeMirror 5 |
| Backend | Node.js, Express |
| Database | SQLite via `better-sqlite3` |
| Code execution | Python 3 subprocess |
| Testing | Jest, Supertest |

---

## License

MIT
