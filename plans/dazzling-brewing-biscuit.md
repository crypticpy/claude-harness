# Bill Text Rendering Fix Plan

## Problem Summary

Bill text is not displaying in the Bills page detail view. The "Bill Text" section shows an empty `html-container` div even though the API correctly returns HTML content.

**Root Cause:** The `sanitizeHtml` utility using DOMPurify is stripping ALL content from legislative HTML because:
1. Texas legislature bills contain full HTML document structure (`<html>`, `<head>`, `<body>` tags)
2. DOMPurify by default strips document-level structural tags
3. The current config has `FORBID_TAGS: ["meta"]` and `KEEP_CONTENT: false`
4. The combination results in an empty string being returned

## Evidence

- **Database**: Bill 239 has 50,002 characters of text in `legislation_text.text_content`
- **API Response**: Returns `latest_text.text` field with full HTML content (confirmed via network request)
- **Frontend**: `BillTextViewer` receives data, detects HTML, calls `sanitizeHtml()`, renders empty `<div class="html-container"></div>`
- **Browser Console**: No errors (sanitizer silently returns empty string)

## Files to Modify

1. **`src/utils/htmlSanitizer.js`** - Fix sanitization config for legislative HTML
2. **`src/components/bills/BillTextViewer.jsx`** - Add fallback handling and improve rendering

## Implementation Plan

### Step 1: Fix HTML Sanitizer for Legislative Content

Modify `src/utils/htmlSanitizer.js` to handle full HTML documents:

```javascript
// Add WHOLE_DOCUMENT option to preserve body content
// Use FORCE_BODY to ensure content ends up in body
// Change KEEP_CONTENT to true so content inside stripped tags is preserved
const DEFAULT_CONFIG = {
  WHOLE_DOCUMENT: false,  // We only want body content, not full doc
  FORCE_BODY: true,       // Force content into body context
  ALLOWED_TAGS: false,    // DOMPurify defaults
  ALLOWED_ATTR: false,    // DOMPurify defaults
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link"],
  // Remove "meta" from FORBID_TAGS - they're harmless and used for line numbers
  FORBID_ATTR: [...],
  KEEP_CONTENT: true,     // CRITICAL: Keep content when tags are stripped
};
```

### Step 2: Add Content Extraction Preprocessing

Before sanitizing, extract just the `<body>` content if the HTML is a full document:

```javascript
export const sanitizeHtml = (dirty) => {
  let input = typeof dirty === "string" ? dirty : "";

  // If input is a full HTML document, extract body content first
  if (input.toLowerCase().includes('<body')) {
    const bodyMatch = input.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      input = bodyMatch[1];
    }
  }

  const clean = DOMPurify.sanitize(input, DEFAULT_CONFIG);
  // ... rest of function
};
```

### Step 3: Add Fallback in BillTextViewer

Add defensive handling in `BillTextViewer.jsx` for cases where sanitization returns empty:

```javascript
// After sanitization, check if result is empty
const sanitizedHtml = sanitizeHtml(text);
const hasContent = sanitizedHtml && sanitizedHtml.trim().length > 0;

if (isHTML) {
  if (!hasContent) {
    // Fallback: Display as formatted plain text
    // Strip HTML tags and display content
    const plainText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return (
      <div className="billtext-plain whitespace-pre-line">
        {formatExtractedText(plainText)}
      </div>
    );
  }

  return (
    <div
      className="html-container"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
```

### Step 4: Add CSS for Legislative HTML Tables

The Texas legislature HTML uses tables for formatting. Add styles in `BillTextViewer.css`:

```css
.html-container table {
  width: 100%;
  border-collapse: collapse;
}

.html-container td {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10pt;
  padding: 2px 4px;
  vertical-align: top;
}

/* Underline styling for amendments */
.html-container u {
  text-decoration: underline;
}
```

## Testing Checklist

- [ ] Bill 239 (HTML text from Texas) displays content correctly
- [ ] PDF bills still render correctly (binary detection works)
- [ ] Plain text bills render correctly
- [ ] Sanitization still blocks XSS (script tags, event handlers)
- [ ] No console errors during rendering
- [ ] Responsive layout works on mobile

## Risk Assessment

- **Low risk**: Changes are isolated to the bill text rendering component
- **Security**: DOMPurify still provides XSS protection; we're just fixing config to not strip safe content
- **Backwards compatible**: Existing PDF and plain text rendering paths unchanged
