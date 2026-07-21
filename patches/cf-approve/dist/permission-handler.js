import { PermissionRequestInputSchema, } from "./types.js";
import { checkFastDecision } from "./fast-decisions.js";
import { getCachedDecision, setCachedDecision } from "./cache.js";
import { queryLLM } from "./llm-client.js";
import { logDecision } from "./logger.js";
/**
 * Handle a permission request from Claude Code.
 * Returns PermissionRequestOutput for allow/deny, or null for passthrough.
 * Passthrough means: exit 0 with no output, letting Claude show its native dialog.
 */
export async function handlePermissionRequest(rawInput) {
    // Parse and validate input
    let input;
    try {
        input = PermissionRequestInputSchema.parse(rawInput);
    }
    catch (error) {
        // Invalid input, deny
        return createDenyResponse("Invalid permission request input");
    }
    const { tool_name: toolName, tool_input: toolInput, cwd, session_id: sessionId, } = input;
    // Tier 1: Check fast decisions (hardcoded patterns)
    const fastResult = checkFastDecision(toolName, toolInput);
    if (fastResult.decision === "allow") {
        logDecision({
            toolName,
            decision: "allow",
            reason: fastResult.reason || "Fast allow",
            decisionSource: "fast",
            sessionId,
            cwd,
        });
        return createAllowResponse();
    }
    if (fastResult.decision === "deny") {
        logDecision({
            toolName,
            decision: "deny",
            reason: fastResult.reason || "Fast deny",
            decisionSource: "fast",
            sessionId,
            cwd,
        });
        return createDenyResponse(fastResult.reason || "Blocked by security pattern");
    }
    // Handle fast passthrough (e.g., AskUserQuestion - user must see and respond)
    if (fastResult.decision === "passthrough") {
        logDecision({
            toolName,
            decision: "passthrough",
            reason: fastResult.reason || "Fast passthrough",
            decisionSource: "fast",
            sessionId,
            cwd,
        });
        return null; // Signal passthrough - exit 0 with no output
    }
    // Tier 2: Check cache (note: passthrough decisions are never cached)
    const cached = getCachedDecision(toolName, toolInput, cwd);
    if (cached) {
        logDecision({
            toolName,
            decision: cached.decision,
            reason: `Cached: ${cached.reason}`,
            decisionSource: "cache",
            sessionId,
            cwd,
        });
        if (cached.decision === "allow") {
            return createAllowResponse();
        }
        else {
            return createDenyResponse(cached.reason);
        }
    }
    // Tier 3: Query LLM (returns allow/deny only - passthrough is handled by fast-decisions)
    const llmResult = await queryLLM(toolName, toolInput, cwd);
    // An LLM failure is not a verdict: never cache it, and fall through to
    // the native permission dialog instead of blocking the command.
    if (llmResult.isError) {
        logDecision({
            toolName,
            decision: "passthrough",
            reason: llmResult.reason,
            decisionSource: "llm",
            sessionId,
            cwd,
        });
        return null;
    }
    // Cache the result
    setCachedDecision(toolName, toolInput, llmResult.decision, llmResult.reason, cwd);
    logDecision({
        toolName,
        decision: llmResult.decision,
        reason: llmResult.reason,
        decisionSource: "llm",
        sessionId,
        cwd,
    });
    if (llmResult.decision === "allow") {
        return createAllowResponse();
    }
    else {
        return createDenyResponse(llmResult.reason);
    }
}
function createAllowResponse() {
    return {
        hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
                behavior: "allow",
            },
        },
    };
}
function createDenyResponse(message) {
    return {
        hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
                behavior: "deny",
                message,
            },
        },
    };
}
//# sourceMappingURL=permission-handler.js.map