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

const MEMORY_FILE = path.join(__dirname, '..', 'project-memory.mv2');

function retrieveContext(query) {
  if (!query) {
    console.error('Usage: node mem-recall.js <query>');
    console.error('Example: node mem-recall.js "how does auth work"');
    process.exit(1);
  }

  // Check if Gemini API key is available in environment
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const semanticFlags = hasGemini ? ' --mode sem --embedding-model gemini' : '';

  try {
    const cmd = `memvid find "${MEMORY_FILE}" --query "${query.replace(/"/g, '\\"')}" --json${semanticFlags}`;

    const output = execSync(cmd, {
      encoding: 'utf8',
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results = JSON.parse(output);

    if (!results.hits || results.hits.length === 0) {
      // Fall back to lexical search if semantic returns nothing
      if (hasGemini) {
        console.log('No semantic matches. Trying lexical search...\n');
        const lexCmd = `memvid find "${MEMORY_FILE}" --query "${query.replace(/"/g, '\\"')}" --json --mode lex`;
        const lexOutput = execSync(lexCmd, {
          encoding: 'utf8',
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
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

    displayResults(query, results, hasGemini ? 'semantic' : 'lexical');
  } catch (error) {
    // Try non-JSON output as fallback
    try {
      const fallbackCmd = `memvid find "${MEMORY_FILE}" --query "${query.replace(/"/g, '\\"')}"`;
      execSync(fallbackCmd, { stdio: 'inherit', shell: true });
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
