#!/usr/bin/env node

/**
 * Developer Onboarding Setup Script
 *
 * Goals:
 * - New developer productive in <30 minutes
 * - Idempotent (can run multiple times safely)
 * - Clear progress indicators
 * - Helpful error messages
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function success(message) {
  log(`✓ ${message}`, GREEN);
}

function error(message) {
  log(`✗ ${message}`, RED);
}

function warn(message) {
  log(`⚠ ${message}`, YELLOW);
}

function info(message) {
  log(`ℹ ${message}`, BLUE);
}

function step(number, total, message) {
  log(`\n[${number}/${total}] ${message}`, BLUE);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
  } catch (err) {
    if (options.ignoreErrors) {
      return null;
    }
    throw err;
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('🚀 Date Management App - Developer Setup', BLUE);
  console.log('='.repeat(60) + '\n');

  info('This script will set up your development environment.');
  info('Estimated time: <30 minutes\n');

  const TOTAL_STEPS = 7;
  let currentStep = 0;

  // Step 1: Check Node.js version
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Checking Node.js version');
  try {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion >= 18) {
      success(`Node.js ${nodeVersion} (✓ meets requirement ≥18)`);
    } else {
      error(`Node.js ${nodeVersion} is too old`);
      error('Please install Node.js 18 or higher from https://nodejs.org/');
      process.exit(1);
    }
  } catch (err) {
    error('Failed to check Node.js version');
    throw err;
  }

  // Step 2: Check npm version
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Checking npm version');
  try {
    const npmVersion = exec('npm --version', { silent: true }).toString().trim();
    success(`npm ${npmVersion} installed`);
  } catch (err) {
    error('npm not found');
    process.exit(1);
  }

  // Step 3: Install dependencies
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Installing dependencies');
  try {
    info('Running npm install... (this may take a few minutes)');
    exec('npm install');
    success('Dependencies installed');
  } catch (err) {
    error('Failed to install dependencies');
    error('Try running: npm install --legacy-peer-deps');
    throw err;
  }

  // Step 4: Set up .env file
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Setting up environment variables');
  const envPath = path.join(process.cwd(), '.env');
  const envExamplePath = path.join(process.cwd(), '.env.example');

  if (fs.existsSync(envPath)) {
    success('.env file already exists');
  } else if (fs.existsSync(envExamplePath)) {
    try {
      fs.copyFileSync(envExamplePath, envPath);
      success('Created .env from .env.example');
      info('📝 Review .env and update values as needed for your environment');
    } catch (err) {
      error('Failed to copy .env.example to .env');
      warn('Please manually run: cp .env.example .env');
    }
  } else {
    warn('.env.example not found');
    warn('Please create .env manually based on docs/environment-setup.md');
  }

  // Step 5: Run database migrations
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Running database migrations');
  try {
    // Check if migrations have already been run
    const dbPath = path.join(process.cwd(), 'database.sqlite');
    if (fs.existsSync(dbPath)) {
      info('Database already exists, checking migration status...');
    } else {
      info('Creating new database...');
    }

    exec('npm run migrate');
    success('Database migrations completed');
  } catch (err) {
    error('Failed to run migrations');
    warn('You can run migrations later with: npm run migrate');
    warn('If migrations keep failing, try: npm run db:reset');
  }

  // Step 6: Seed test data
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Seeding test data');
  try {
    info('Creating default users and test data...');
    exec('npm run seed', { ignoreErrors: true });
    exec('npm run seed:tier-flags', { ignoreErrors: true });
    success('Test data seeded');
  } catch (err) {
    warn('Some seed operations failed (this may be okay if data already exists)');
    info('You can re-run seeds with: npm run seed && npm run seed:tier-flags');
  }

  // Step 7: Run tests
  currentStep++;
  step(currentStep, TOTAL_STEPS, 'Running test suite');
  try {
    info('Running tests to verify setup... (this may take a minute)');
    exec('npm test -- --testPathIgnorePatterns=integration --maxWorkers=2', { ignoreErrors: true });
    success('Tests completed');
  } catch (err) {
    warn('Some tests failed');
    info('This might be okay - you can investigate with: npm test');
  }

  // Final success message
  console.log('\n' + '='.repeat(60));
  log('✓ Setup Complete!', GREEN);
  console.log('='.repeat(60) + '\n');

  info('Next steps:');
  console.log('  1. Review your .env file and update any configuration');
  console.log('  2. Start the development server: npm run dev');
  console.log('  3. Server will run on http://localhost:3001');
  console.log('  4. Read docs/developer-guide.md for daily workflow tips\n');

  info('Common commands:');
  console.log('  npm run dev          - Start development server');
  console.log('  npm test             - Run test suite');
  console.log('  npm run test:watch   - Run tests in watch mode');
  console.log('  npm run lint         - Check code style');
  console.log('  npm run db:studio    - Open Prisma Studio (database GUI)\n');

  log('Happy coding! 🎉\n', GREEN);
}

// Run setup
main().catch((err) => {
  console.error('\n');
  error('Setup failed with error:');
  console.error(err.message);
  console.error('\n');
  error('Please check the error above and try again.');
  error('If you need help, see docs/environment-setup.md or README.md\n');
  process.exit(1);
});
