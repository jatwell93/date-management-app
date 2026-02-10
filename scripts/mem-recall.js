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

const { execSync, execFileSync } = require('child_process');
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

// Helper to safely execute memvid with proper path resolution
function runMemvid(args, env) {
  try {
    // Use shell: true to properly resolve memvid from PATH (handles npm global installs)
    // Arguments are passed as array which prevents shell injection
    const output = execSync(`memvid ${args.map(arg => `"${arg}"`).join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: true,
    });
    return output;
  } catch (error) {
    throw error;
  }
}

function retrieveContext(query) {
  if (!query) {
    console.error('Usage: node mem-recall.js <query>');
    console.error('Example: node mem-recall.js "how does auth work"');
    process.exit(1);
  }

  // Check if API key is available in environment (for potential future use)
  const hasApiKey = !!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY;
  const semanticFlags = ['--mode', 'lex'];

  // Cross-platform environment variable prefix is no longer needed because we pass
  // environment variables directly via the `env` option when spawning the process.

  try {
    // Create clean env (keep API keys for remote providers)
    const cleanEnv = { ...process.env };

    const args = ['find', MEMORY_FILE, '--query', query, '--json', ...semanticFlags];

    const output = runMemvid(args, cleanEnv);

    const results = JSON.parse(output);

    if (!results.hits || results.hits.length === 0) {
      // Fall back to lexical search if semantic returns nothing
      if (hasApiKey) {
        console.log('No semantic matches. Trying lexical search...\n');
        const lexArgs = ['find', MEMORY_FILE, '--query', query, '--json', '--mode', 'lex'];
        const lexOutput = runMemvid(lexArgs, cleanEnv);
        const lexResults = JSON.parse(lexOutput);
        if (lexResults.hits && lexResults.hits.length > 0) {
          displayResults(query, lexResults, 'lexical');
          return;
        }
      }
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
