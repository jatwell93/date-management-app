#!/usr/bin/env node
/**
 * mem-rebuild.js - Rebuild local Memvid index from committed JSONL memory log.
 *
 * Usage:
 *   node scripts/mem-rebuild.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { runMemvid } = require('./memvid-exec');

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

function ensureMemvidAvailable(env) {
  try {
    execFileSync('memvid', ['--version'], {
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: true,
      windowsHide: true,
    });
  } catch (error) {
    console.error('❌ memvid is not available in PATH for this Node process.');
    console.error('   Install or expose memvid, then retry.');
    console.error('   Example check: memvid --version');
    console.error(`   Details: ${error.message}`);
    process.exit(1);
  }
}

function readRecords() {
  if (!fs.existsSync(MEMORY_JSONL)) {
    console.error(`❌ Missing memory source file: ${MEMORY_JSONL}`);
    process.exit(1);
  }

  return fs
    .readFileSync(MEMORY_JSONL, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on memory.jsonl line ${index + 1}: ${error.message}`);
      }
    });
}

function backupExistingMemoryFile() {
  if (!fs.existsSync(MEMORY_FILE)) {
    return null;
  }

  const backupPath = `${MEMORY_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(MEMORY_FILE, backupPath);
  return backupPath;
}

function toMemvidTimestamp(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'number') {
    return String(value < 1_000_000_000_000 ? Math.floor(value) : Math.floor(value / 1000));
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    return String(value);
  }

  return String(Math.floor(parsed / 1000));
}

function rebuildMemory() {
  const cleanEnv = { ...process.env };
  ensureMemvidAvailable(cleanEnv);

  const records = readRecords();
  const backupPath = backupExistingMemoryFile();
  if (backupPath) {
    console.log(`Moved existing local index to ${backupPath}`);
  }

  // MEMORY_FILE is an absolute path and MEMORY_FILE_PATH can point anywhere, so
  // it goes through the quoting helper as well: a home directory containing a
  // space would otherwise split it into two arguments.
  runMemvid(['create', MEMORY_FILE], {
    env: cleanEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  records.forEach((record, index) => {
    const kind = String(record.kind || '').toUpperCase();
    const title = String(record.title || 'Untitled');
    const message = String(record.message || '');
    const memvidTimestamp = toMemvidTimestamp(record.ts);
    try {
      const args = ['put', MEMORY_FILE, '--title', title, '--kind', kind.toLowerCase()];
      if (memvidTimestamp) {
        args.push('--timestamp', memvidTimestamp);
      }

      // See scripts/memvid-exec.js. This call is where the unquoted-argv bug was
      // fatal rather than merely warned about: the rebuild throws on the first
      // failing record, so a single multi-word title stopped the whole index
      // being rebuilt — `npm run mem:rebuild` died on record 1 of 285,
      // "Project Overview".
      runMemvid(args, {
        env: cleanEnv,
        stdio: ['pipe', 'inherit', 'inherit'],
        input: `[${kind}] ${message}`,
      });
    } catch (error) {
      throw new Error(`Failed to rebuild memory record ${index + 1} (${title}): ${error.message}`);
    }
  });

  console.log(`Rebuilt ${records.length} memories into ${MEMORY_FILE}`);
}

try {
  rebuildMemory();
} catch (error) {
  console.error('❌ Memory rebuild failed:', error.message);
  process.exit(1);
}
