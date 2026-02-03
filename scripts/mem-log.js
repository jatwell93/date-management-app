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

const { execSync } = require('child_process');
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

const MEMORY_FILE = path.join(__dirname, '..', 'project-memory.mv2');

const VALID_KINDS = ['FIX', 'PATTERN', 'DECISION', 'FEATURE', 'ERROR', 'ARCHITECTURE', 'WORKFLOW'];

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

  // Check if Gemini API key is available in environment
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const embeddingFlags = hasGemini ? ' --embedding --embedding-model gemini' : '';

  // Cross-platform environment variable prefix for the shell command
  const envPrefix = hasGemini 
    ? (process.platform === 'win32' 
        ? `set GEMINI_API_KEY=${process.env.GEMINI_API_KEY} && set GOOGLE_API_KEY=${process.env.GEMINI_API_KEY} && set gemini_api_key=${process.env.GEMINI_API_KEY} && ` 
        : `GEMINI_API_KEY=${process.env.GEMINI_API_KEY} GOOGLE_API_KEY=${process.env.GEMINI_API_KEY} gemini_api_key=${process.env.GEMINI_API_KEY} `)
    : '';

  try {
    // Use echo with pipe
    const cmd = `${envPrefix}echo "${fullMessage.replace(/"/g, '\\"')}" | memvid put "${MEMORY_FILE}" --title "${title}" --kind "${normalizedKind.toLowerCase()}"${embeddingFlags}`;

    execSync(cmd, {
      stdio: 'inherit',
      shell: true,
      env: process.env
    });

    console.log(`\n✅ Memory logged: [${normalizedKind}] ${title}`);
  } catch (error) {
    console.error('❌ Failed to log memory:', error.message);
    process.exit(1);
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
