# Implementation Plan: Integrate Auto-Claude UI into Forge Project

Created: 2025-12-19
Status: PENDING APPROVAL

## Summary

Integrate the existing Auto-Claude React UI (currently Electron-based) into the Forge project, adapting it to work with Tauri instead of Electron. The forge-tauri crate already has comprehensive IPC handlers; we need to create the Tauri binary, copy/adapt the UI, and wire up the communication layer.

## Scope

### In Scope
- Copy Auto-Claude UI React renderer code into Forge project
- Create Tauri configuration (`tauri.conf.json`) for forge-tauri crate
- Create `main.rs` binary entry point for the Tauri application
- Create Tauri IPC adapter layer to replace Electron's preload APIs
- Configure build scripts for Vite + Tauri development workflow
- Test basic integration (app launches, IPC works)

### Out of Scope
- Full feature parity with Electron Auto-Claude (will iterate later)
- Electron main process logic migration (not needed - Rust backend replaces it)
- Terminal emulation migration (forge-tauri already has `portable-pty`)
- Production packaging and distribution
- Auto-update mechanisms

## Prerequisites

- Node.js v22+ installed (currently v22.21.1 on system)
- pnpm package manager installed (package.json requires pnpm@10.26.1)
- Tauri CLI installed (`cargo install tauri-cli`)
- All forge crates build successfully (`cargo build`)

## Implementation Phases

### Phase 1: Install Tauri CLI and Verify Environment

**Objective**: Ensure Tauri development tools are available

**Steps**:
1. Verify Tauri CLI is installed: `cargo tauri --version`
2. If not installed: `cargo install tauri-cli --version ^2`
3. Verify pnpm is available or install it: `npm install -g pnpm@latest`

**Verification**:
- [ ] `cargo tauri --version` shows 2.x
- [ ] `pnpm --version` shows 10.x

---

### Phase 2: Set Up UI Directory Structure

**Objective**: Create the frontend directory within forge-project

**New Files to Create**:
- `ui/` directory at project root for the React frontend

**Steps**:
1. Create `forge-project/ui/` directory
2. Copy React renderer code from Auto-Claude:
   - `auto-claude-ui/src/renderer/` → `ui/src/`
   - `auto-claude-ui/src/shared/` → `ui/src/shared/`
3. Create new `ui/package.json` (simplified from Auto-Claude, removing Electron deps)
4. Create `ui/vite.config.ts` (standard Vite config for Tauri)
5. Create `ui/tsconfig.json` (adapted from Auto-Claude)
6. Create `ui/postcss.config.js` (same as Auto-Claude)
7. Create `ui/index.html` (adapted from renderer/index.html)

**Verification**:
- [ ] `cd ui && pnpm install` succeeds
- [ ] `pnpm run build` produces `dist/` output

---

### Phase 3: Create Tauri IPC Bridge

**Objective**: Replace Electron's preload API with Tauri's invoke system

**New Files to Create**:
- `ui/src/lib/tauri-api.ts` - Tauri invoke wrapper functions
- `ui/src/lib/ipc-adapter.ts` - Adapter to maintain existing store interfaces

**Files to Modify**:
- Stores that call `window.electronAPI.*` → use new tauri-api

**Steps**:
1. Create `ui/src/lib/tauri-api.ts` with type-safe invoke wrappers:
   ```typescript
   import { invoke } from '@tauri-apps/api/core';

   export const projectApi = {
     list: () => invoke<Project[]>('project_list'),
     add: (path: string) => invoke<Project>('project_add', { path }),
     // ... other commands matching forge-tauri IPC
   };
   ```
2. Create adapter layer that matches the existing store interface
3. Update imports in stores to use new tauri-api instead of window.electronAPI
4. Handle differences in error handling (Tauri vs Electron patterns)

**Key Mappings (Electron → Tauri)**:
| Electron Channel | Tauri Command |
|------------------|---------------|
| `project:add` | `project_add` |
| `project:list` | `project_list` |
| `task:create` | `task_create` |
| `terminal:create` | `terminal_create` |
| etc. | (see forge-tauri/src/ipc/) |

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] All invoke calls have matching Rust commands

---

### Phase 4: Create Tauri Binary

**Objective**: Add main.rs binary and tauri.conf.json to forge-tauri crate

**Files to Create**:
- `crates/forge-tauri/src/main.rs`
- `crates/forge-tauri/tauri.conf.json`
- `crates/forge-tauri/build.rs`
- `crates/forge-tauri/icons/` (placeholder icons)

**Files to Modify**:
- `crates/forge-tauri/Cargo.toml` - Add binary target and tauri dependency

**Steps**:
1. Update `Cargo.toml` to add:
   ```toml
   [[bin]]
   name = "forge-app"
   path = "src/main.rs"

   [dependencies]
   tauri = { version = "2", features = ["devtools"] }
   tauri-plugin-shell = "2"
   ```

2. Create `main.rs`:
   ```rust
   #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

   use forge_tauri::{commands, state::AppState};

   fn main() {
       tauri::Builder::default()
           .plugin(tauri_plugin_shell::init())
           .setup(|app| {
               // Initialize AppState
               // Register IPC commands
               Ok(())
           })
           .run(tauri::generate_context!())
           .expect("error running tauri application");
   }
   ```

3. Create `tauri.conf.json`:
   ```json
   {
     "$schema": "https://schema.tauri.app/config/2",
     "productName": "Forge",
     "version": "0.1.0",
     "identifier": "com.forge.app",
     "build": {
       "frontendDist": "../../ui/dist",
       "devUrl": "http://localhost:5173",
       "beforeDevCommand": "cd ../../ui && pnpm dev",
       "beforeBuildCommand": "cd ../../ui && pnpm build"
     },
     "app": {
       "windows": [{ "title": "Forge", "width": 1200, "height": 800 }]
     }
   }
   ```

4. Create `build.rs`:
   ```rust
   fn main() {
       tauri_build::build()
   }
   ```

5. Create placeholder icons in `icons/`

**Verification**:
- [ ] `cargo build --package forge-tauri` succeeds with binary
- [ ] Binary exists at `target/debug/forge-app`

---

### Phase 5: Wire Up Commands Registration

**Objective**: Register all IPC handlers with Tauri's invoke system

**Files to Modify**:
- `crates/forge-tauri/src/main.rs` - Add all command handlers
- `crates/forge-tauri/src/commands.rs` - Add `#[tauri::command]` attributes

**Steps**:
1. Add `#[tauri::command]` macro to each public command function in `commands.rs`
2. Create command handler registration in `main.rs`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       commands::project_list,
       commands::project_add,
       // ... all other commands
   ])
   ```
3. Ensure all IPC functions in `ipc/*.rs` modules are exported and registered

**Verification**:
- [ ] All IPC handlers compile with Tauri macros
- [ ] No duplicate command registrations

---

### Phase 6: Integration Testing

**Objective**: Verify the app launches and basic IPC works

**Steps**:
1. Start the development server: `cd ui && pnpm dev`
2. In another terminal, run: `cargo tauri dev --manifest-path crates/forge-tauri/Cargo.toml`
3. Verify:
   - Window opens with React UI
   - Console shows no IPC errors
   - Can list/add projects (basic IPC working)

**Verification**:
- [ ] `cargo tauri dev` launches successfully
- [ ] React UI renders in Tauri window
- [ ] At least one IPC call (e.g., project list) works

---

## Testing Strategy

- **Unit tests**: Existing forge-tauri tests continue to pass
- **Integration tests**: Manual testing of IPC round-trips
- **Visual testing**: UI renders correctly in Tauri webview

## Rollback Plan

If integration fails:
1. Delete `ui/` directory
2. Revert changes to `crates/forge-tauri/Cargo.toml`
3. Delete `tauri.conf.json`, `main.rs`, `build.rs`
4. All forge crates remain functional as libraries

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Electron-specific code in UI | High | Medium | Create adapter layer for Electron APIs |
| Tauri 2.x API differences | Medium | Low | Consult Tauri 2 migration guide |
| node-pty dependency in UI | High | High | UI uses xterm.js, backend uses portable-pty |
| React 19 compatibility | Low | Medium | Tauri webview supports modern React |

## Open Questions

1. **Should we keep both Electron and Tauri support?** - Recommend Tauri-only for simplicity
2. **How to handle terminal sessions?** - Forge-tauri has portable-pty, needs WebSocket or event-based streaming to xterm.js
3. **What about the Python auto-claude backend?** - Not needed; Rust orchestrator replaces it

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
