const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const packageDirs = ['.', 'backend', 'frontend', 'workers'];
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
];
const blockedSpecPatterns = [
  /^git[+:]/i,
  /^github:/i,
  /^https?:/i,
  /^file:/i,
  /^link:/i,
  /^\*$/,
  /^latest$/i,
];
const allowedRegistryHosts = new Set(['registry.npmjs.org']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function validatePackageJson(packageJsonPath, failures) {
  const manifest = readJson(packageJsonPath);

  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies || Array.isArray(dependencies)) {
      continue;
    }

    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== 'string') {
        continue;
      }

      if (blockedSpecPatterns.some((pattern) => pattern.test(spec))) {
        failures.push(`${relativePath(packageJsonPath)} uses blocked ${field} source ${name}@${spec}`);
      }
    }
  }
}

function validatePackageLock(lockfilePath, failures) {
  const lockfile = readJson(lockfilePath);
  const packages = lockfile.packages || {};

  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!metadata.resolved || metadata.link) {
      continue;
    }

    let resolvedUrl;
    try {
      resolvedUrl = new URL(metadata.resolved);
    } catch (_error) {
      failures.push(`${relativePath(lockfilePath)} has non-URL resolved source for ${packagePath}`);
      continue;
    }

    if (resolvedUrl.protocol !== 'https:' || !allowedRegistryHosts.has(resolvedUrl.hostname)) {
      failures.push(
        `${relativePath(lockfilePath)} resolves ${packagePath} from ${metadata.resolved}`,
      );
    }
  }
}

function main() {
  const failures = [];

  for (const packageDir of packageDirs) {
    const absoluteDir = path.join(repoRoot, packageDir);
    const packageJsonPath = path.join(absoluteDir, 'package.json');
    const lockfilePath = path.join(absoluteDir, 'package-lock.json');

    if (!fs.existsSync(packageJsonPath) || !fs.existsSync(lockfilePath)) {
      failures.push(`${packageDir} must contain package.json and package-lock.json`);
      continue;
    }

    validatePackageJson(packageJsonPath, failures);
    validatePackageLock(lockfilePath, failures);
  }

  if (failures.length > 0) {
    console.error('npm supply-chain policy violations:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('npm supply-chain policy check passed.');
}

main();
