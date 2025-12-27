# Terminal Enhancement Plan: Modern Terminal Features

## Goal
Upgrade the terminal to be on par with modern terminals like Kitty and Ghostty, within the constraints of browser-based xterm.js in a Tauri app.

## Current State
- xterm.js v5.5.0 with addons: fit, web-links, serialize, webgl (installed but NOT loaded)
- Actor pattern PTY backend with portable-pty
- Grid-based layout (1-12 terminals, resizable panels)
- Buffer manager for performance optimization
- Claude Code integration, session persistence, auto-naming
- Hardcoded dark theme only

---

## Feature Tiers

### P0: Critical (High Impact, Essential UX)

#### 1. Search/Find in Terminal
**Impact:** Users cannot find text in scrollback - fundamental missing feature

**Implementation:**
- Install `@xterm/addon-search`
- Add search UI overlay (Ctrl+F / Cmd+F)
- Search highlighting with next/prev navigation
- Regex support toggle

**Files:**
- `ui/package.json` - add @xterm/addon-search
- `ui/src/hooks/useXterm.ts` - load SearchAddon
- `ui/src/components/TerminalSearch.tsx` - new search overlay component
- `ui/src/components/Terminal.tsx` - integrate search UI

**Complexity:** Low

#### 2. Enable WebGL Rendering
**Impact:** Significant performance boost for large scrollback

**Implementation:**
- Load WebGLAddon in useXterm (already installed)
- Fallback to canvas if WebGL unavailable
- Add performance monitoring

**Files:**
- `ui/src/hooks/useXterm.ts` - load WebGLAddon with try/catch fallback

**Complexity:** Low

#### 3. Keyboard Navigation Between Panes
**Impact:** Power users need keyboard-driven workflow

**Implementation:**
- Ctrl+Alt+Arrow keys to navigate between terminals
- Focus ring indicator on active terminal
- Track active terminal in store

**Shortcuts:**
| Shortcut | Action |
|----------|--------|
| Ctrl+Alt+← | Focus left terminal |
| Ctrl+Alt+→ | Focus right terminal |
| Ctrl+Alt+↑ | Focus terminal above |
| Ctrl+Alt+↓ | Focus terminal below |
| Ctrl+Shift+[ | Previous terminal |
| Ctrl+Shift+] | Next terminal |

**Files:**
- `ui/src/components/TerminalGrid.tsx` - keyboard event handler
- `ui/src/stores/useTerminalStore.ts` - track focused terminal
- `ui/src/components/Terminal.tsx` - focus ring styling

**Complexity:** Medium

---

### P1: High Value (Significant UX Improvement)

#### 4. Theme System
**Impact:** Users expect theme customization

**Implementation:**
- Extract terminal colors to theme configuration
- Built-in themes: Dracula, Nord, Monokai, Solarized, One Dark
- Theme selector in settings
- Persist theme preference

**Files:**
- `ui/src/lib/terminal-themes.ts` - new file with theme definitions
- `ui/src/hooks/useXterm.ts` - apply theme from config
- `ui/src/stores/useSettingsStore.ts` - add terminalTheme setting
- `ui/src/components/settings/TerminalSettings.tsx` - theme selector UI

**Complexity:** Medium

#### 5. Configurable Font & Scrollback
**Impact:** Personalization and accessibility

**Settings to expose:**
- Font family (dropdown: JetBrains Mono, Fira Code, SF Mono, Cascadia Code)
- Font size (12-20px slider)
- Line height (1.0-1.5)
- Scrollback lines (1000-100000)
- Cursor style (block, underline, bar)
- Cursor blink (on/off)

**Files:**
- `ui/src/stores/useSettingsStore.ts` - terminal config settings
- `ui/src/hooks/useXterm.ts` - apply settings to xterm options
- `ui/src/components/settings/TerminalSettings.tsx` - settings UI

**Complexity:** Medium

#### 6. Copy Mode (Vim-style Selection)
**Impact:** Keyboard-driven text selection without mouse

**Implementation:**
- Ctrl+Shift+X to enter copy mode
- hjkl navigation, v for selection, y to yank
- Visual indicator when in copy mode
- Escape to exit

**Files:**
- `ui/src/hooks/useCopyMode.ts` - new hook for copy mode state machine
- `ui/src/components/Terminal.tsx` - integrate copy mode
- `ui/src/components/CopyModeIndicator.tsx` - visual overlay

**Complexity:** High

#### 7. Tabs Interface (Alternative to Grid)
**Impact:** Traditional terminal UX option

**Implementation:**
- Toggle between grid view and tabs view
- Tab bar with close buttons, drag reorder
- Keyboard shortcuts: Ctrl+Tab, Ctrl+Shift+Tab
- Tab context menu (close, close others, duplicate)

**Files:**
- `ui/src/components/TerminalTabs.tsx` - new tab bar component
- `ui/src/components/TerminalContainer.tsx` - switch between grid/tabs
- `ui/src/stores/useTerminalStore.ts` - add viewMode: 'grid' | 'tabs'

**Complexity:** Medium

---

### P2: Nice to Have (Polish & Advanced Features)

#### 8. Quick Terminal Dropdown (Quake-style)
**Impact:** Fast access without window switching

**Implementation:**
- Global hotkey (configurable, default: Ctrl+`)
- Slide-down animation from top
- Separate from main terminal grid
- Auto-hide on blur (optional)

**Files:**
- `ui/src/components/QuickTerminal.tsx` - dropdown terminal component
- `ui/src/hooks/useGlobalHotkey.ts` - global hotkey registration
- Backend: Register global shortcut via Tauri

**Complexity:** High (requires Tauri global shortcut)

#### 9. Broadcast Input to Multiple Terminals
**Impact:** Useful for multi-server operations

**Implementation:**
- Toggle broadcast mode in UI
- Select which terminals receive broadcast
- Visual indicator on broadcasting terminals
- Keyboard shortcut to toggle

**Files:**
- `ui/src/stores/useTerminalStore.ts` - broadcast state
- `ui/src/components/TerminalHeader.tsx` - broadcast toggle
- `ui/src/hooks/useXterm.ts` - duplicate input to selected terminals

**Complexity:** Medium

#### 10. Shell Integration (Command Markers)
**Impact:** Navigate between commands, see exit codes

**Implementation:**
- Detect shell prompt patterns via ANSI parsing
- Mark command boundaries in scrollback
- Show exit code badges (✓/✗)
- Cmd+↑/↓ to jump between commands

**Limitations:** Approximate detection only (no true shell integration protocol)

**Files:**
- `ui/src/hooks/useShellIntegration.ts` - prompt detection
- `ui/src/components/Terminal.tsx` - command markers UI

**Complexity:** High

#### 11. Command Palette
**Impact:** Discoverable keyboard-driven actions

**Implementation:**
- Ctrl+Shift+P to open palette
- Fuzzy search all terminal actions
- Show keyboard shortcuts
- Recent commands history

**Files:**
- `ui/src/components/CommandPalette.tsx` - palette UI
- `ui/src/lib/terminal-commands.ts` - command registry

**Complexity:** Medium

#### 12. Enhanced Hyperlinks (OSC 8)
**Impact:** Better link handling from CLI tools

**Implementation:**
- Parse OSC 8 escape sequences
- Custom link handler with preview
- Right-click context menu for links
- Copy link, open in browser options

**Files:**
- `ui/src/hooks/useXterm.ts` - custom linkHandler
- `ui/src/components/LinkContextMenu.tsx` - context menu

**Complexity:** Low

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. ✅ Enable WebGL rendering
2. ✅ Add Search/Find functionality
3. ✅ Keyboard navigation between panes

### Phase 2: Customization (Week 2)
4. Theme system with built-in themes
5. Configurable fonts and scrollback
6. Terminal settings UI panel

### Phase 3: Power Features (Week 3)
7. Copy mode (vim-style)
8. Tabs interface option
9. Broadcast input mode

### Phase 4: Polish (Week 4)
10. Quick terminal dropdown
11. Command palette
12. Enhanced hyperlinks

---

## New Dependencies

```json
{
  "@xterm/addon-search": "^0.15.0"
}
```

(WebGL addon already installed)

---

## Settings Schema Addition

```typescript
interface TerminalSettings {
  // Appearance
  theme: 'default' | 'dracula' | 'nord' | 'monokai' | 'solarized-dark' | 'one-dark';
  fontFamily: 'JetBrains Mono' | 'Fira Code' | 'SF Mono' | 'Cascadia Code';
  fontSize: number; // 12-20
  lineHeight: number; // 1.0-1.5
  
  // Behavior
  scrollbackLines: number; // 1000-100000
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  
  // Layout
  viewMode: 'grid' | 'tabs';
  
  // Features
  enableWebGL: boolean;
  enableCopyMode: boolean;
  enableBroadcast: boolean;
}
```

---

## Key Files Summary

| File | Changes |
|------|---------|
| `ui/src/hooks/useXterm.ts` | WebGL, search, themes, settings |
| `ui/src/components/TerminalGrid.tsx` | Keyboard nav, view mode |
| `ui/src/components/Terminal.tsx` | Focus ring, copy mode, search |
| `ui/src/stores/useTerminalStore.ts` | Focus tracking, broadcast |
| `ui/src/stores/useSettingsStore.ts` | Terminal settings |
| `ui/src/lib/terminal-themes.ts` | Theme definitions (new) |
| `ui/src/components/TerminalSearch.tsx` | Search overlay (new) |
| `ui/src/components/TerminalTabs.tsx` | Tab bar (new) |
| `ui/src/hooks/useCopyMode.ts` | Copy mode logic (new) |

---

## What We Cannot Achieve (Browser Limitations)

❌ **Kitty Graphics Protocol** - Requires pixel-level drawing  
❌ **Native GPU Rendering** - Browser sandbox limits GPU access  
❌ **True Shell Integration** - No FinalTerm/iTerm2 protocol in web  
❌ **Native Font Ligature Detection** - Browser text rendering limitation  
❌ **Platform-Native UI** - Cannot use OS widgets from web context  

---

## Success Metrics

- Search: Find text in 10K line scrollback < 100ms
- WebGL: Smooth 60fps scrolling with 50K line buffer
- Keyboard nav: Switch panes in < 50ms
- Theme switch: Apply instantly without terminal restart
- Copy mode: Full vim navigation working
