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
    projectType?: ProjectType;
    mlStack?: MLStackInfo;
    monorepoType?: MonorepoType;
    isHybridStack?: boolean;
    hybridDetails?: string;
}
/**
 * High-level project type classification
 */
export type ProjectType = 'ml-ai' | 'data-science' | 'web-fullstack' | 'web-frontend' | 'web-backend' | 'static-site' | 'desktop-app' | 'mobile-app' | 'cli-tool' | 'library' | 'monorepo' | 'unknown';
/**
 * ML/AI specific stack information
 */
export interface MLStackInfo {
    frameworks: string[];
    dataLibs: string[];
    visualization: string[];
    notebooks: boolean;
    modelDirs: string[];
}
/**
 * Monorepo workspace type
 */
export type MonorepoType = 'lerna' | 'pnpm-workspace' | 'npm-workspaces' | 'yarn-workspaces' | 'turborepo' | 'nx' | 'cargo-workspace' | 'none';
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
//# sourceMappingURL=types.d.ts.map