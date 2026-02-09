# Recursive Algorithm Visualizer

An interactive tool for visualizing recursive tree algorithms. Save your LeetCode problems and step through the recursion to understand how they work.

## Features

- 🌳 Visualize any binary tree structure
- 🔄 Step through recursion call-by-call
- 📊 Watch the call stack and variables update
- 💾 Save problems to a SQLite database
- 📤 Export/Import your problem library
- 🔗 Link to LeetCode problems with notes

## Quick Start

### Option 1: Run Locally

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000
```

### Option 2: Docker

```bash
# Build the image
docker build -t recursive-viz .

# Run with persistent data
docker run -p 3000:3000 -v recursive-viz-data:/app/db recursive-viz
```

### Option 3: Deploy to Railway/Render/Fly.io

This app is ready to deploy to any Node.js hosting platform. The SQLite database is stored in `./db/problems.db`.

For persistent storage on cloud platforms:
- **Railway**: Attach a volume to `/app/db`
- **Render**: Use a persistent disk mounted to `/app/db`
- **Fly.io**: Use a volume for `/app/db`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/problems` | List all problems |
| GET | `/api/problems/:id` | Get single problem |
| POST | `/api/problems` | Create new problem |
| PUT | `/api/problems/:id` | Update problem |
| DELETE | `/api/problems/:id` | Delete problem |
| POST | `/api/problems/import` | Bulk import |
| GET | `/api/problems/export/all` | Export all |

## Writing Custom Problems

Your recursive function receives `(node, globals)`:

```javascript
// node has: node.val, node.left, node.right
// globals is your tracked state object

function height(node, globals) {
    if (!node) return -1;
    
    let left = height(node.left, globals);
    let right = height(node.right, globals);
    
    globals.maxD = Math.max(globals.maxD, left + right + 2);
    
    return Math.max(left, right) + 1;
}
```

## Tech Stack

- **Frontend**: Vanilla JS, HTML, CSS
- **Backend**: Express.js
- **Database**: SQLite (better-sqlite3)

## License

MIT
