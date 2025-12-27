---
name: crawl-cli
description: "Web crawler with auto-discovery and markdown output. Crawl websites, extract content as markdown/json/html/txt, discover llms.txt/sitemap.xml files. Use when fetching documentation, crawling sites for content, or extracting web content."
---

# Web Crawler CLI (crawl-cli)

**Version:** 1.0.1 | **Package:** `crawl-cli-tool`

Lightweight CLI for web crawling with auto-discovery. Zero project dependencies - uses globally installed `crawl-cli`.

---

## DEFAULT OPERATIONAL PROTOCOL

**When user requests a website crawl, ALWAYS use this pattern:**

```bash
crawl-cli <url> --discover -m 100 -O ".claude/skills/crawl-cli/<domain>/" -v
```

| Setting | Value | Reason |
|---------|-------|--------|
| `--discover` | Always | Fast sitemap-based parallel crawl |
| `-O` | `.claude/skills/crawl-cli/<domain>/` | Each page as separate .md file |
| `-m 100` | Default limit | Prevent runaway crawls |
| `-v` | Verbose | Show progress |

**Example:**
```bash
# User asks: "crawl https://docs.anthropic.com"
crawl-cli https://docs.anthropic.com --discover -m 100 -O ".claude/skills/crawl-cli/docs.anthropic.com/" -v
```

**Only deviate from this pattern if user explicitly requests:**
- Recursive mode (`-d 2+`) for non-sitemap crawling
- Single file output (`-o`) instead of directory
- Different output location
- Different page limit

---

## Prerequisites

```bash
# One-time global install
npm install -g crawl-cli-tool
```

## Quick Reference

| Task | Command |
|------|---------|
| Crawl single page | `crawl-cli <url>` |
| Recursive crawl (depth 2) | `crawl-cli <url> -d 2` |
| Save to single file | `crawl-cli <url> -o output.md` |
| Each URL as separate file | `crawl-cli <url> -d 2 -O ./docs/` |
| JSON format | `crawl-cli <url> -f json` |
| HTML format | `crawl-cli <url> -f html` |
| Discover files | `crawl-cli discover <url>` |
| Pipe to another tool | `crawl-cli <url> -q -f json \| jq '.'` |

---

## Output Destinations

### Single File (`-o`)

All crawled pages combined into one file:

```bash
# Single page to file
crawl-cli https://example.com/page -o ./articles/page.md

# Multiple pages (depth 2) to one file
crawl-cli https://docs.example.com -d 2 -o ./all-docs.md

# Append to existing file
crawl-cli https://another.com -o ./all-docs.md --append
```

### Directory - Each URL as Separate File (`-O`)

Each crawled URL becomes its own file:

```bash
# Crawl docs site, each page as separate file
crawl-cli https://docs.anthropic.com -d 2 -O ./anthropic-docs/

# Result:
# anthropic-docs/
# ├── _index.md           # Auto-generated index with links
# ├── docs_anthropic_com.md
# ├── getting-started.md
# ├── api_reference.md
# └── guides_setup.md
```

```bash
# Same in JSON format
crawl-cli https://docs.example.com -d 2 -O ./docs/ -f json

# Skip index file generation
crawl-cli https://docs.example.com -d 2 -O ./docs/ --no-index

# See all files created
crawl-cli https://docs.example.com -d 2 -O ./docs/ -v
```

### stdout (Default)

```bash
# Print to console
crawl-cli https://example.com

# Quiet mode for piping (no spinner/progress)
crawl-cli https://example.com -q -f json | jq '.[] | .title'
```

---

## Output Formats (`-f`)

| Format | Flag | Description |
|--------|------|-------------|
| **Markdown** | `-f md` | Clean markdown with headers, links (default) |
| **JSON** | `-f json` | Structured data: `{url, title, description, markdown}` |
| **HTML** | `-f html` | Styled HTML document ready for browser |
| **Plain Text** | `-f txt` | Stripped text, no formatting |

```bash
# Markdown (default)
crawl-cli https://example.com -f md

# JSON
crawl-cli https://example.com -f json

# HTML
crawl-cli https://example.com -f html -o page.html

# Plain text
crawl-cli https://example.com -f txt
```

---

## Common Workflows

### Crawl Documentation Site to Individual Files

```bash
# Best for large doc sites - each page as separate file
crawl-cli https://docs.anthropic.com -d 2 -m 100 -O ./anthropic-docs/
```

### Crawl Documentation to Single File

```bash
# All docs in one file (good for smaller sites)
crawl-cli https://docs.example.com -d 2 -o all-docs.md
```

### Extract Single Page

```bash
# Get one page without discovery
crawl-cli https://example.com/article --no-discover -o article.md
```

### Discover Available Files

```bash
# Check what discovery files exist
crawl-cli discover https://example.com
```

### Crawl from Sitemap

```bash
# Use sitemap directly
crawl-cli https://example.com/sitemap.xml -m 100 -O ./site-content/
```

### JSON for Processing

```bash
# JSON output for programmatic use
crawl-cli https://example.com -f json -o data.json

# Pipe JSON to jq
crawl-cli https://example.com -q -f json | jq '.[] | {title, url}'
```

---

## All Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --depth <n>` | Max crawl depth | 1 |
| `-m, --max-pages <n>` | Max pages to crawl | 100 |
| `-c, --concurrent <n>` | Concurrent requests | 5 |
| `-o, --output <file>` | Output to single file (combined) | stdout |
| `-O, --output-dir <folder>` | Output to directory (each URL separate) | - |
| `-f, --format <type>` | Format: `md`, `json`, `html`, `txt` | md |
| `--json` | Shorthand for `-f json` | - |
| `--append` | Append to file instead of overwrite | false |
| `--no-index` | Skip index file for directory output | false |
| `--discover` | Force auto-discovery ON | - |
| `--no-discover` | Force auto-discovery OFF | - |
| `-t, --timeout <ms>` | Page timeout | 30000 |
| `-v, --verbose` | Verbose output | false |
| `-q, --quiet` | Minimal output (for piping) | false |

---

## Crawl Modes: Sitemap vs Recursive

**IMPORTANT:** There are two very different crawl modes with different speed characteristics:

### 1. Sitemap Mode (FAST)
When auto-discovery finds a sitemap, it crawls all sitemap URLs in parallel batches.
- **Speed:** Fast (~2-5 sec per batch of 5 pages)
- **Triggered by:** `--discover` flag OR default when `depth=1`

```bash
# Fast - uses sitemap if available
crawl-cli https://example.com --discover -m 100 -O ./output/
```

### 2. Recursive Mode (SLOW)
When using `-d 2` or higher, it follows links page-by-page, extracting and crawling discovered links.
- **Speed:** Slow (~2-5 sec PER PAGE, sequential by depth level)
- **Triggered by:** `-d 2` or higher (auto-discovery OFF by default)

```bash
# Slow - recursive link following, 3 levels deep
crawl-cli https://example.com -d 3 -m 100 -O ./output/
```

### Recommendation
**Always try `--discover` first** for large sites. Only use `-d 2+` when you need to crawl pages not in the sitemap.

---

## Auto-Discovery Flags

| Flag | Effect |
|------|--------|
| `--discover` | Force auto-discovery ON (use sitemap if found) |
| `--no-discover` | Force auto-discovery OFF |
| _(neither)_ | ON if depth=1, OFF if depth > 1 |

### Discovery Priority Order

When enabled, the tool checks for these files in order:

1. **llms.txt** - AI assistant instructions (highest priority)
2. **llms-full.txt** - Full llms.txt variant
3. **sitemap.xml** - Site structure map
4. **robots.txt** - Crawling rules (for sitemap references)
5. **.well-known/ai.txt** - Well-known AI file
6. **.well-known/llms.txt** - Well-known llms variant
7. **.well-known/sitemap.xml** - Well-known sitemap

If a sitemap is found, all URLs from the sitemap are crawled (up to `-m` limit).

---

## Output Examples

### Markdown File

```markdown
# Page Title

**URL:** https://example.com/page
**Description:** Page description

---

[Content in markdown format...]
```

### JSON Output

```json
[
  {
    "url": "https://example.com/page",
    "title": "Page Title",
    "description": "Page description",
    "markdown": "# Content..."
  }
]
```

### Directory Index (`_index.md`)

```markdown
# Crawl Index

15 pages crawled

- [Getting Started](./getting-started.md) - https://docs.example.com/getting-started
- [API Reference](./api_reference.md) - https://docs.example.com/api/reference
...
```

---

## Tips

1. **Large doc sites**: Use `-O` for separate files, easier to navigate
2. **Small sites**: Use `-o` for single combined file
3. **Slow sites**: Increase timeout with `-t 60000`
4. **Debugging**: Use `-v` for verbose output
5. **Pipelines**: Use `-q -f json` for clean JSON piping
6. **Limit scope**: Use `-m 50` to limit pages, `-d 1` for shallow crawl

---

## Troubleshooting

**Crawl hangs / stuck at "Crawling..."**

Likely caused by stuck headless browser processes from previous failed crawls:

```powershell
# Kill all stuck browser processes (Windows)
powershell -Command "Stop-Process -Name 'chrome-headless-shell' -Force -ErrorAction SilentlyContinue"

# Then clean reinstall if needed
npm uninstall -g crawl-cli-tool
npm cache clean --force
npm install -g crawl-cli-tool
```

**"Chromium not found"**
```bash
npx playwright install chromium
```

**"Timeout waiting for page"**
```bash
crawl-cli <url> -t 60000  # 60 second timeout
```

**"Too many pages"**
```bash
crawl-cli <url> -m 20 -d 1  # Limit to 20 pages, depth 1
```

**HTTP 500 errors on some pages**

Some pages may return server errors - these are skipped automatically. Check verbose output (`-v`) to see which pages failed.
