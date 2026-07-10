#!/usr/bin/env node
/**
 * mem-log.js - Quick memory logging for agent workflows
 *
 * Usage:
 *   node scripts/mem-log.js <kind> <title> <message>
 *
 * Kinds:
 *   FIX      - Bug fixes and their solutions
 *   PATTERN  - Architectural decisions (JWT, CSS-modules, etc.)
 *   DECISION - Why we chose X over Y
 *   FEATURE  - New feature implementations
 *   ERROR    - Common errors and how to resolve them
 *
 * Examples:
 *   node scripts/mem-log.js FIX "Auth Token Bug" "Fixed JWT expiry check by adding timezone normalization"
 *   node scripts/mem-log.js PATTERN "Database Access" "All DB queries go through repository layer, never direct in controllers"
 *   node scripts/mem-log.js DECISION "State Management" "Using React Context instead of Redux for simplicity"
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
const envPath = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: envPath, override: true });

// Ensure all common Gemini/Google environment variables are set and exported
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.MEMVID_TOKEN;
if (apiKey) {
  process.env.GEMINI_API_KEY = apiKey;
  process.env.GOOGLE_API_KEY = apiKey;
  // console.log(`[DEBUG] Key found in .env (length: ${apiKey.length})`);
} else {
  console.warn('[WARN] No Gemini API key found in .env or environment');
}

const MEMORY_FILE =
  process.env.MEMORY_FILE_PATH || path.join(__dirname, '..', 'project-memory.mv2');
const MEMORY_JSONL = process.env.MEMORY_JSONL_PATH || path.join(__dirname, '..', 'memory.jsonl');

const VALID_KINDS = ['FIX', 'PATTERN', 'DECISION', 'FEATURE', 'ERROR', 'ARCHITECTURE', 'WORKFLOW'];

function ensureMemvidAvailable(env) {
  try {
    execFileSync('memvid', ['--version'], {
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: true,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      [
        'memvid is not available in PATH for this Node process.',
        'Install or expose memvid, then retry.',
        'Example check: memvid --version',
        `Details: ${error.message}`,
      ].join('\n'),
    );
  }
}

function appendMemoryJsonl(kind, title, message) {
  const record = {
    ts: new Date().toISOString(),
    kind,
    title,
    message,
  };

  fs.appendFileSync(MEMORY_JSONL, `${JSON.stringify(record)}\n`);
}

function logMemory(kind, title, message) {
  if (!kind || !title || !message) {
    console.error('Usage: node mem-log.js <kind> <title> <message>');
    console.error('Kinds:', VALID_KINDS.join(', '));
    process.exit(1);
  }

  const normalizedKind = kind.toUpperCase();
  if (!VALID_KINDS.includes(normalizedKind)) {
    console.error(`Invalid kind: ${kind}`);
    console.error('Valid kinds:', VALID_KINDS.join(', '));
    process.exit(1);
  }

  const fullMessage = `[${normalizedKind}] ${message}`;

  // Check if API key is available in environment (for potential future use)
  const hasApiKey = !!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY;

  // Prepare environment for memvid (keep API keys for remote providers)
  const cleanEnv = { ...process.env };
  if (hasApiKey && process.env.GEMINI_API_KEY) {
    cleanEnv.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    cleanEnv.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    appendMemoryJsonl(normalizedKind, title, message);
  } catch (error) {
    console.error('❌ Failed to write memory.jsonl:', error.message);
    process.exit(1);
  }

  try {
    ensureMemvidAvailable(cleanEnv);

    execFileSync(
      'memvid',
      ['put', MEMORY_FILE, '--title', title, '--kind', normalizedKind.toLowerCase()],
      {
        env: cleanEnv,
        stdio: ['pipe', 'inherit', 'inherit'],
        input: fullMessage,
        shell: true,
        windowsHide: true,
      },
    );

    console.log(`\n✅ Memory logged: [${normalizedKind}] ${title}`);
  } catch (error) {
    console.warn('⚠ Failed to update local memvid index:', error.message);
    console.warn('   Memory was preserved in memory.jsonl. Run npm run mem:rebuild later.');
  }
}

// Parse CLI arguments
const [, , kind, title, ...messageParts] = process.argv;
const message = messageParts.join(' ');

if (kind) {
  logMemory(kind, title, message);
} else {
  console.log('Memory Logger - Store project knowledge for AI agents\n');
  console.log('Usage: node scripts/mem-log.js <kind> <title> <message>\n');
  console.log('Kinds:');
  VALID_KINDS.forEach((k) => console.log(`  ${k}`));
  console.log('\nExample:');
  console.log('  node scripts/mem-log.js FIX "Auth Bug" "Added null check for user session"');
}
