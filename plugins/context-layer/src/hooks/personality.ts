#!/usr/bin/env node
/**
 * Personality Hook CLI Entry Point
 *
 * Reads JSON from stdin, invokes the personality hook handler,
 * and writes JSON result to stdout.
 *
 * Usage:
 *   echo '{"session_id":"test","prompt":"hello"}' | node personality.js
 *
 * Exit codes:
 *   0 - Success (even if no context injected)
 *   1 - Fatal error
 */

import { handleUserPromptSubmit, type HookInput, type HookOutput } from './personality-hook';

async function main(): Promise<void> {
  let input: HookInput;

  try {
    // Read all input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputText = Buffer.concat(chunks).toString('utf-8');

    if (!inputText.trim()) {
      // No input - exit silently with success
      outputResult({ continue: true });
      process.exit(0);
    }

    input = JSON.parse(inputText) as HookInput;
  } catch (parseError) {
    // Invalid JSON input - log error in debug mode, exit with success
    if (process.env.DEBUG) {
      console.error('[PersonalityHook] Failed to parse input:', parseError);
    }
    outputResult({ continue: true });
    process.exit(0);
  }

  try {
    // Validate required fields
    if (!input.session_id || typeof input.prompt !== 'string') {
      if (process.env.DEBUG) {
        console.error('[PersonalityHook] Missing required fields: session_id or prompt');
      }
      outputResult({ continue: true });
      process.exit(0);
    }

    // Execute the hook handler
    const result = await handleUserPromptSubmit(input);
    outputResult(result);
    process.exit(0);
  } catch (error) {
    // Handler error - log in debug mode, return continue: true to not block user
    if (process.env.DEBUG) {
      console.error('[PersonalityHook] Handler error:', error);
    }
    outputResult({ continue: true });
    process.exit(0);
  }
}

/**
 * Output the hook result as JSON to stdout
 */
function outputResult(result: HookOutput): void {
  // Only output if there's a result to inject
  if (result.result) {
    console.log(result.result);
  }
  // Note: For Claude Code hooks, we output the context injection text directly,
  // not the full JSON object. The hook system expects plain text output
  // that gets injected into the context.
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  if (process.env.DEBUG) {
    console.error('[PersonalityHook] Uncaught exception:', error);
  }
  process.exit(0); // Exit cleanly to not block user
});

process.on('unhandledRejection', (reason) => {
  if (process.env.DEBUG) {
    console.error('[PersonalityHook] Unhandled rejection:', reason);
  }
  process.exit(0); // Exit cleanly to not block user
});

// Run main
main().catch((error) => {
  if (process.env.DEBUG) {
    console.error('[PersonalityHook] Fatal error:', error);
  }
  process.exit(0); // Exit cleanly to not block user
});
