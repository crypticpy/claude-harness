/**
 * Project Personality Types
 */

export interface ProjectPersonality {
  projectId: string;
  name: string;
  stack: StackInfo;
  patterns: Pattern[];
  conventions: Convention[];
  gotchas: Gotcha[];
  keyFiles: KeyFile[];
  extractedAt: number;
  configHash?: string;
}

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  stateManagement?: string;
  testing?: string;
  styling?: string;
  database?: string;
  packageManager?: string;
  runtimeVersions?: Record<string, string>;
  // Enhanced detection fields
  projectType?: ProjectType;
  mlStack?: MLStackInfo;
  monorepoType?: MonorepoType;
  isHybridStack?: boolean;
  hybridDetails?: string;
}

/**
 * High-level project type classification
 */
export type ProjectType =
  | 'ml-ai'           // Machine learning / AI project
  | 'data-science'    // Data analysis / visualization
  | 'web-fullstack'   // Full-stack web app
  | 'web-frontend'    // Frontend only
  | 'web-backend'     // Backend/API only
  | 'static-site'     // Static HTML/CSS (no build)
  | 'desktop-app'     // Electron/Tauri desktop
  | 'mobile-app'      // React Native/Flutter
  | 'cli-tool'        // Command line tool
  | 'library'         // Reusable library/package
  | 'monorepo'        // Multi-package workspace
  | 'unknown';

/**
 * ML/AI specific stack information
 */
export interface MLStackInfo {
  frameworks: string[];  // tensorflow, pytorch, jax, etc.
  dataLibs: string[];    // pandas, numpy, scipy, etc.
  visualization: string[]; // matplotlib, plotly, seaborn
  notebooks: boolean;    // .ipynb files present
  modelDirs: string[];   // models/, training/, etc.
}

/**
 * Monorepo workspace type
 */
export type MonorepoType =
  | 'lerna'
  | 'pnpm-workspace'
  | 'npm-workspaces'
  | 'yarn-workspaces'
  | 'turborepo'
  | 'nx'
  | 'cargo-workspace'
  | 'none';

export interface Pattern {
  name: string;
  description: string;
  location?: string;
  example?: string;
}

export interface Convention {
  category: 'naming' | 'structure' | 'imports' | 'testing' | 'comments' | 'other';
  rule: string;
  example?: string;
}

export interface Gotcha {
  issue: string;
  prevention: string;
  source?: string;
}

export interface KeyFile {
  path: string;
  purpose: string;
  importance: 'critical' | 'important' | 'reference';
}

export interface ExtractionOptions {
  includeExamples?: boolean;
  maxPatterns?: number;
  maxGotchas?: number;
  parseClaudeMd?: boolean;
  detectVersions?: boolean;
}

export interface CacheValidityResult {
  isValid: boolean;
  reason?: string;
  newHash?: string;
}
