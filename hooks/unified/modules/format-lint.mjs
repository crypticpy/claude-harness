/**
 * Format & Lint Module
 * Auto-formats files after Write/Edit based on file extension
 */

import { execSync } from 'child_process';
import { extname } from 'path';

export async function formatFile(event, config) {
    try {
        if (!config.formatting?.enabled) return;

        const filePath = event.tool_input?.file_path;
        if (!filePath) return;

        const ext = extname(filePath);
        const formatter = config.formatting.extensions[ext];

        if (formatter) {
            try {
                execSync(`${formatter} "${filePath}" 2>/dev/null`, { timeout: 5000 });
            } catch (e) {
                // Silent failure - formatting is best-effort
            }
        }
    } catch (err) {
        // Silent
    }
}
