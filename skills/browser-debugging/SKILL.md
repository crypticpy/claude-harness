---
name: browser-debugging
description: "Debug web apps via Chrome DevTools Protocol. Read console logs, monitor network requests, capture screenshots. Use when troubleshooting browser issues, form submissions not working, or investigating client-side errors."
---

# Browser Debugging (cdp-cli)

Lightweight CLI for Chrome DevTools Protocol. Zero project dependencies - uses globally installed `cdp-cli`.

## Prerequisites

```bash
# One-time global install
npm install -g @myerscarpenter/cdp-cli
```

## Critical: How CDP Works

**cdp-cli ONLY connects to Chrome instances launched with remote debugging enabled.** Your regular Chrome tabs are NOT accessible - you must launch a separate debug Chrome instance.

This is a Chrome DevTools Protocol limitation, not a cdp-cli limitation.

## Launching Debug Chrome

### macOS
```bash
cdp-cli launch
```

### Windows (manual launch required)

`cdp-cli launch` is **macOS only**. On Windows, launch Chrome manually:

```powershell
# Close any existing Chrome first, then:
Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--remote-debugging-port=9223','--user-data-dir=C:\temp\chrome-debug'
```

**Important:** Use a separate `--user-data-dir` to avoid conflicts with your main Chrome profile.

## Quick Reference

| Task | Command |
|------|---------|
| List open tabs | `cdp-cli tabs` |
| Console errors | `cdp-cli console "PageTitle" --type error` |
| All console logs | `cdp-cli console "PageTitle" --tail 50` |
| Network requests | `cdp-cli network "PageTitle" --duration 10` |
| Screenshot | `cdp-cli screenshot "PageTitle" --output debug.jpg` |
| DOM snapshot | `cdp-cli snapshot "PageTitle"` |
| Run JavaScript | `cdp-cli eval "PageTitle" "document.title"` |

## Page Matching

**The `<page>` parameter matches against PAGE TITLE, not URL.**

```bash
# First, check what tabs are available:
cdp-cli tabs

# Output shows title, use a substring to match:
# {"id":"ABC123","title":"Submit Your Listing – In Links We Trust","url":"https://..."}

# Match by title substring:
cdp-cli console "Submit"        # ✓ Matches title
cdp-cli console "inlinkswetrust.com"  # ✗ Won't work - URL not in title
```

## Custom Port Configuration

Default port is **9223**. To use a different port:

```bash
# Global flag BEFORE the command
cdp-cli --cdp-url http://localhost:9222 tabs
cdp-cli --cdp-url http://localhost:9222 console "PageTitle" --type error
```

**Note:** Use `--cdp-url`, not `--port`. The flag must come before the subcommand.

## Common Workflows

### Debug Form Submission (Windows)

```powershell
# 1. Close existing Chrome instances

# 2. Launch debug Chrome
Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--remote-debugging-port=9223','--user-data-dir=C:\temp\chrome-debug'

# 3. Navigate to the page manually in Chrome

# 4. Check available tabs
cdp-cli tabs

# 5. Monitor console errors (use title from step 4)
cdp-cli console "Submit" --type error --duration 60

# 6. In another terminal, monitor network
cdp-cli network "Submit" --duration 60

# 7. Submit the form and watch for errors
```

### Debug Form Submission (macOS)

```bash
# 1. Launch Chrome with debugging
cdp-cli launch

# 2. Navigate to the page manually in Chrome

# 3. Start monitoring console errors
cdp-cli console "PageTitle" --type error --duration 60

# 4. In another terminal, monitor network failures
cdp-cli network "PageTitle" --duration 60

# 5. Submit the form and watch for errors
```

### Capture Debug Screenshot

```bash
cdp-cli screenshot "PageTitle" --output ./debug-screenshot.jpg
```

## Command Details

### Console Monitoring

```bash
# Basic (last 10 messages)
cdp-cli console "PageTitle"

# Filter by type
cdp-cli console "PageTitle" --type error      # Errors only
cdp-cli console "PageTitle" --type warning    # Warnings only
cdp-cli console "PageTitle" --type log        # Logs only

# More messages
cdp-cli console "PageTitle" --tail 50

# Live monitoring (duration in seconds)
cdp-cli console "PageTitle" --duration 60

# Verbose output (includes timestamps, locations)
cdp-cli console "PageTitle" --verbose
```

### Network Monitoring

```bash
# Basic (5 second capture)
cdp-cli network "PageTitle" --duration 5

# Longer capture
cdp-cli network "PageTitle" --duration 30

# Filter failures (4xx/5xx) - pipe to grep
cdp-cli network "PageTitle" --duration 10 | grep '"status":[45]'

# Filter by request type
cdp-cli network "PageTitle" --type fetch
cdp-cli network "PageTitle" --type xhr
cdp-cli network "PageTitle" --type document
```

### Screenshots

```bash
# JPEG (smaller file)
cdp-cli screenshot "PageTitle" --output screenshot.jpg

# PNG (lossless)
cdp-cli screenshot "PageTitle" --output screenshot.png

# Full page
cdp-cli screenshot "PageTitle" --output full.jpg --full-page
```

### JavaScript Execution

```bash
# Get page title
cdp-cli eval "PageTitle" "document.title"

# Get element text
cdp-cli eval "PageTitle" "document.querySelector('h1').textContent"

# Check localStorage
cdp-cli eval "PageTitle" "localStorage.getItem('token')"

# Count elements
cdp-cli eval "PageTitle" "document.querySelectorAll('a').length"
```

### DOM Snapshot

```bash
# Accessibility tree (good for understanding page structure)
cdp-cli snapshot "PageTitle"

# HTML source
cdp-cli snapshot "PageTitle" --html
```

## Output Format

cdp-cli outputs **NDJSON** (newline-delimited JSON) - one JSON object per line. This is:
- Token-efficient (minimal output by default)
- Grep-compatible for filtering
- Easy to parse programmatically

Example console output:
```json
{"type":"error","text":"Uncaught TypeError: Cannot read property 'x' of undefined","url":"app.js","line":42}
{"type":"log","text":"Form submitted"}
```

## Troubleshooting

**"Cannot connect to Chrome"**
- Ensure Chrome was launched with `--remote-debugging-port=9223`
- On Windows: Use the PowerShell command above (cdp-cli launch is macOS only)
- Check no other Chrome instance is using port 9223

**"Page not found: 'yoursite.com'"**
- cdp-cli matches by **page title**, not URL
- Run `cdp-cli tabs` to see available titles
- Use a substring from the title: `cdp-cli console "Submit"` not `cdp-cli console "example.com"`

**"Unknown argument: port"**
- Use `--cdp-url http://localhost:PORT` before the subcommand
- Example: `cdp-cli --cdp-url http://localhost:9222 tabs`

**Regular Chrome tabs not visible**
- This is expected! CDP only works with debug-launched Chrome
- Close regular Chrome and launch with `--remote-debugging-port`

## Sub-Agent Usage

For complex debugging sessions, spawn a sub-agent:

```
Task tool:
  subagent_type: general-purpose
  model: haiku

Prompt:
---
Debug the web application issue.

**Problem**: [DESCRIBE ISSUE]
**Page Title**: [TITLE FROM cdp-cli tabs]

**Steps**:
1. On Windows: Launch Chrome with: Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--remote-debugging-port=9223','--user-data-dir=C:\temp\chrome-debug'
2. Run: cdp-cli tabs (to get page title)
3. Run: cdp-cli console "[title]" --type error --duration 30
4. Run: cdp-cli network "[title]" --duration 30
5. Analyze output for root cause

**Return**: Summary of errors found and recommended fixes.
---
```
