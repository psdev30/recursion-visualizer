# Per-Line Stepping & Null-Child Swap Animation

## Overview

Two improvements to the recursion visualizer:
1. Replace wrapper-based function tracing with `sys.settrace` for per-line stepping, with the currently executing line highlighted in the Code tab
2. Animate null-child swaps at leaf nodes in tree mode (e.g., Invert Binary Tree swapping two null children)

## 1. Per-Line Stepping via sys.settrace

### Current State

- Python tracer wraps each user function: `_wrapped_func` calls `_record_call`, then `_original_func`, then `_record_return`
- Only two step types: `call` and `return`
- Line highlighting in the Code tab maps `step.funcName` → `def` line number via `lineMap`
- No visibility into which line inside a function body is executing

### New Approach

Replace the wrapper-based tracing with Python's `sys.settrace`. The trace function fires on three event types:
- `'call'` — function entry
- `'line'` — about to execute a statement
- `'return'` — function exit

#### Step Data Changes

Steps gain a `lineNumber` field (1-based, matching the user's code). Step types expand from `{call, return}` to `{call, line, return}`.

A `line` step carries the same fields as today (`nodeId`, `stack`, `globals`, `treeSnapshot`, `message`) plus `lineNumber`. `call` and `return` steps also get `lineNumber`.

#### Python Script Changes (lib/pythonScripts.js — `buildPythonScript`)

The generated Python script changes from wrapper-based to `sys.settrace`-based:

1. **No more function renaming/wrapping**: Remove the `_original_` / `_wrapped_` rename dance. User code runs as-is.
2. **Trace function**: A `_tracer(frame, event, arg)` function registered via `sys.settrace(_tracer)`:
   - Filters to only trace user-defined functions (check `frame.f_code.co_filename == '<string>'` or a known marker)
   - On `'call'`: extract the first argument (the tree node) from `frame.f_locals`, record a call step with `lineNumber = frame.f_lineno`, push onto `_stack`
   - On `'line'`: record a line step with `lineNumber = frame.f_lineno`, snapshot globals and tree
   - On `'return'`: record a return step with `lineNumber = frame.f_lineno` and `result = arg`, pop from `_stack`
   - Returns itself to continue tracing (return `_tracer` for call/line events)
3. **Line number offset**: Since the generated script has preamble code before the user code, we need to track the offset so `lineNumber` maps to the user's original code lines. Store the starting line of user code in the script and subtract it from `frame.f_lineno`.
4. **Node extraction**: On `'call'` events, extract the tree node from `frame.f_locals` using the function's first parameter name. We can get parameter names from `frame.f_code.co_varnames`. For `'line'` and `'return'` events, reuse the node from the current stack frame.
5. **treeSnapshot**: Captured on every step (call, line, return) so the tree view stays in sync with mutations.
6. **Step limit**: Keep the 2000-step limit. Per-line stepping increases step count (~3-5x), but this acts as a safety valve. May need to increase later based on usage.

#### Server Changes (lib/createApp.js)

- `lineMap` construction (`buildLineMap`) becomes optional/unused — each step carries its own `lineNumber`
- Server still passes `lineMap` in response for backward compatibility, but frontend uses `step.lineNumber` directly

#### Frontend Changes (public/index.html)

1. **`updateCodeHighlight(step)`**: Use `step.lineNumber` directly instead of `lineMap[step.funcName]`. Apply `active-call` class for `call` steps, `active-return` for `return` steps, and a new `active-line` class for `line` steps.
2. **`renderCodeHighlight()`**: No changes needed — still renders all lines with line numbers.
3. **CSS**: Add `.code-line.active-line` style (a breakpoint-like indicator: left-border highlight or background color to show "this line is executing").
4. **Call tree / call stack**: Only update on `call` and `return` steps. `line` steps do not add/remove call tree nodes or stack frames — they only update: code highlight, tree snapshot, globals display.
5. **Step counter**: Shows all steps (including `line` steps) in the total count.

#### Two-Tree Mode

Same approach — `sys.settrace` naturally handles functions with multiple tree parameters. On `'call'` events, extract both tree params from `frame.f_locals`.

### What lineMap Becomes

`lineMap` is no longer needed for code highlighting. However, it may still be used for breakpoint functionality (clicking a line to set a breakpoint). Breakpoints can be checked against `step.lineNumber` directly.

## 2. Animated Null-Child Swap in Tree Mode

### Current State

When Invert Binary Tree reaches a leaf node:
- The tree snapshot before and after swapping two null children is identical
- `snapKey === lastTreeSnapshotKey` → no re-render → no visual change
- Both null nodes exist in `layout.nullPositions` but are never highlighted or animated

### Detection

In `updateVisualization()`, after tree snapshot comparison, detect the null-swap case:
1. Step type is `line`
2. The active node (from `_stack`) has both `left` and `right` entries in `layout.nullPositions`
3. The tree snapshot is unchanged from the previous step

When all three conditions are met, trigger the swap animation.

### Animation

CSS keyframe animation on the null node `<g>` elements:

1. Both null nodes and their edges become visible (opacity 1, active styling)
2. Calculate the horizontal distance between left and right null positions
3. Left null `<g>` gets `@keyframes` animation: translateX from 0 to +distance
4. Right null `<g>` gets `@keyframes` animation: translateX from 0 to -distance
5. Null edges animate correspondingly (endpoints shift)
6. Duration: ~400ms, ease-in-out
7. After animation completes, both settle into swapped positions (visually identical since both are null)

#### Implementation

- Add CSS `@keyframes null-swap-left` and `@keyframes null-swap-right` with translateX
- In `updateVisualization()`, when the null-swap case is detected:
  - Add a `swapping` class to both null node elements
  - Set CSS custom properties `--swap-distance` for the translateX amount
  - The animation plays once, then the class is removed
- For null edges: animate using the same approach, or simply hide edges during swap and show them after

#### Edge Cases

- Single null child (only one side is null): no swap animation, only one null is shown as active (existing behavior)
- Non-tree modes (graph, backtrack): not applicable, no changes needed
- Two-tree mode: apply independently to each tree's null positions
- Auto-play mode: animation should complete before advancing to next step (or skip animation if play speed is fast)

## Files to Modify

1. **lib/pythonScripts.js** — Replace wrapper generation with `sys.settrace`-based tracing in `buildPythonScript`. Similar changes for `buildGraphPythonScript` and `buildBacktrackPythonScript` if they should also support per-line stepping.
2. **public/index.html** — Update `updateCodeHighlight`, `updateVisualization`, add CSS for `active-line` and null-swap animation
3. **lib/createApp.js** — Minor: adjust `lineMap` handling
4. **tests/** — Update unit and integration tests for new step shape (line steps, lineNumber field)

## Scope Limitation

- Only `buildPythonScript` (tree mode) gets `sys.settrace` initially. Graph and backtrack modes can be updated later.
- The null-swap animation only applies to tree mode.
