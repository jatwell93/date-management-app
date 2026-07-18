#!/usr/bin/env node
/**
 * mem-recall.js - Retrieve relevant project memories for AI context
 *
 * Usage:
 *   node scripts/mem-recall.js <query>
 *
 * Examples:
 *   node scripts/mem-recall.js "how does authentication work"
 *   node scripts/mem-recall.js "expired items"
 *   node scripts/mem-recall.js "database patterns"
 *
 * Output is formatted for easy consumption by AI agents.
 */

const { execSync } = require('child_process');
const path = require('path');

// Recall runs offline lexical search (`--mode lex`) and needs no credentials, so we do
// NOT load .env by default. Only when an explicit remote/embedding mode is requested
// (MEM_RECALL_REMOTE=1) do we pull a key from the existing environment — never from .env.
const REMOTE_MODE = process.env.MEM_RECALL_REMOTE === '1';
if (REMOTE_MODE) {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.MEMVID_TOKEN;
  if (apiKey) {
    process.env.GEMINI_API_KEY = apiKey;
    process.env.GOOGLE_API_KEY = apiKey;
  } else {
    console.warn('[WARN] MEM_RECALL_REMOTE=1 set but no Gemini/Google key in environment');
  }
}

const MEMORY_FILE = path.join(__dirname, '..', 'project-memory.mv2');

function escapeForShell(value) {
  return String(value).replace(/"/g, '\\"');
}

function ensureMemvidAvailable(env) {
  try {
    execSync('memvid --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      env,
    });
  } catch (error) {
    console.error('❌ memvid is not available in PATH for this Node process.');
    console.error('   Install or expose memvid, then retry.');
    console.error('   Example check: memvid --version');
    console.error(`   Details: ${error.message}`);
    process.exit(1);
  }
}

// Helper to safely execute memvid with proper path resolution
function runMemvid(args, env) {
  return execSync(`memvid ${args.map((arg) => `"${escapeForShell(arg)}"`).join(' ')}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    shell: true,
  });
}

function retrieveContext(query) {
  if (!query) {
    console.error('Usage: node mem-recall.js <query>');
    console.error('Example: node mem-recall.js "how does auth work"');
    process.exit(1);
  }

  const searchFlags = ['--mode', 'lex'];

  try {
    // Create clean env (keep API keys for remote providers)
    const cleanEnv = { ...process.env };

    ensureMemvidAvailable(cleanEnv);

    const args = ['find', MEMORY_FILE, '--query', query, '--json', ...searchFlags];

    const output = runMemvid(args, cleanEnv);

    const results = JSON.parse(output);

    if (!results.hits || results.hits.length === 0) {
      console.log('No project memories found for this query.');
      console.log('Add memories with: node scripts/mem-log.js <kind> <title> <message>');
      return;
    }

    displayResults(query, results, 'lexical');
  } catch (error) {
    // Try non-JSON output as fallback
    try {
      const cleanEnv = { ...process.env };
      const fallbackArgs = ['find', MEMORY_FILE, '--query', query];
      runMemvid(fallbackArgs, cleanEnv);
    } catch (fallbackError) {
      console.error('❌ Retrieval failed:', error.message);
      process.exit(1);
    }
  }
}

function displayResults(query, results, mode) {
  console.log('### RELEVANT PROJECT MEMORY ###\n');
  console.log(`Query: "${query}" (${mode} search)`);
  console.log(
    `Found: ${results.hits.length} result(s) in ${results.metadata?.elapsed_ms || 0}ms\n`,
  );
  console.log('---\n');

  results.hits.forEach((hit, i) => {
    const title = hit.title || 'Untitled';
    // Extract kind from tags or text
    const tags = hit.metadata?.tags || [];
    const kindTag = ['fix', 'pattern', 'decision', 'feature', 'error', 'architecture'].find((k) =>
      tags.includes(k),
    );
    const kind = kindTag || 'general';

    // Extract the actual content (first line before metadata)
    const fullText = hit.text || '';
    const contentLine = fullText.split('\n')[0] || '';

    console.log(`${i + 1}. [${kind.toUpperCase()}] ${title}`);
    console.log(`   ${contentLine.trim()}`);
    if (hit.metadata?.tags) {
      console.log(`   Tags: ${hit.metadata.tags.slice(0, 5).join(', ')}`);
    }
    console.log('');
  });

  console.log('---');
  console.log('Use this context to ground your response in project-specific patterns.');
}

// Parse CLI arguments
const query = process.argv.slice(2).join(' ');

if (query) {
  retrieveContext(query);
} else {
  console.log('Memory Recall - Retrieve project knowledge for AI context\n');
  console.log('Usage: node scripts/mem-recall.js <query>\n');
  console.log('Examples:');
  console.log('  node scripts/mem-recall.js "authentication flow"');
  console.log('  node scripts/mem-recall.js "database migrations"');
  console.log('  node scripts/mem-recall.js "styling patterns"');
}
