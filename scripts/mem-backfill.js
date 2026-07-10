#!/usr/bin/env node
/**
 * mem-backfill.js - Reconstruct memory.jsonl from an existing local Memvid index.
 *
 * Usage:
 *   node scripts/mem-backfill.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: envPath, override: true });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.MEMVID_TOKEN;
if (apiKey) {
  process.env.GEMINI_API_KEY = apiKey;
  process.env.GOOGLE_API_KEY = apiKey;
}

const MEMORY_FILE =
  process.env.MEMORY_FILE_PATH || path.join(__dirname, '..', 'project-memory.mv2');
const MEMORY_JSONL = process.env.MEMORY_JSONL_PATH || path.join(__dirname, '..', 'memory.jsonl');

function escapeForShell(value) {
  return String(value).replace(/"/g, '\\"');
}

function ensureMemvidAvailable(env) {
  try {
    execSync('memvid --version', {
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch (error) {
    console.error('❌ memvid is not available in PATH for this Node process.');
    console.error('   Install or expose memvid, then retry.');
    console.error('   Example check: memvid --version');
    console.error(`   Details: ${error.message}`);
    process.exit(1);
  }
}

function parseFrameCount(statsOutput) {
  const match = statsOutput.match(/Frames:\s+(\d+)\s+total/i);
  if (!match) {
    throw new Error('Could not parse frame count from memvid stats output');
  }

  return Number.parseInt(match[1], 10);
}

function toIsoTimestamp(timestamp) {
  if (typeof timestamp === 'number') {
    const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    return new Date(milliseconds).toISOString();
  }

  const parsed = Date.parse(String(timestamp));
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }

  return new Date(parsed).toISOString();
}

function stripGeneratedKindPrefix(message, kind) {
  const prefix = `[${kind}] `;
  if (message.startsWith(prefix)) {
    return message.slice(prefix.length);
  }

  return message;
}

function frameToRecord(result) {
  const frame = result.frame || result;
  const kind = String(frame.kind || 'GENERAL').toUpperCase();
  const message = frame.metadata?.caption || frame.search_text || result.content || '';

  return {
    ts: toIsoTimestamp(frame.timestamp),
    kind,
    title: frame.title || 'Untitled',
    message: stripGeneratedKindPrefix(message, kind),
  };
}

function backfillMemoryJsonl() {
  const cleanEnv = { ...process.env };
  ensureMemvidAvailable(cleanEnv);

  const stats = execSync(`memvid stats "${escapeForShell(MEMORY_FILE)}"`, {
    env: cleanEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const frameCount = parseFrameCount(stats);
  const records = [];

  for (let frameId = 0; frameId < frameCount; frameId += 1) {
    const output = execSync(
      `memvid view "${escapeForShell(MEMORY_FILE)}" --frame-id ${frameId} --json`,
      {
        env: cleanEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    records.push(frameToRecord(JSON.parse(output)));
  }

  fs.writeFileSync(MEMORY_JSONL, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  console.log(`Backfilled ${records.length} memories into ${MEMORY_JSONL}`);
}

try {
  backfillMemoryJsonl();
} catch (error) {
  console.error('❌ Memory backfill failed:', error.message);
  process.exit(1);
}
