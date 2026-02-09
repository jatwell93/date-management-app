#!/bin/bash
# Pre-commit hook for secrets scanning
# Task 6.4: Run git-secrets before commit to prevent secrets from being committed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running secrets scan...${NC}"

# Check if git-secrets is installed
if ! command -v git-secrets &> /dev/null; then
    echo -e "${RED}Error: git-secrets is not installed!${NC}"
    echo ""
    echo "Please install git-secrets to enable secrets scanning:"
    echo ""
    echo "  macOS (Homebrew):    brew install git-secrets"
    echo "  Ubuntu/Debian:       sudo apt-get install git-secrets"
    echo "  Manual install:      https://github.com/awslabs/git-secrets"
    echo ""
    echo "After installation, run:"
    echo "  git secrets --install"
    echo "  git secrets --register-aws"
    echo ""
    echo -e "${YELLOW}Bypassing secrets scan (git-secrets not installed)${NC}"
    exit 0
fi

# Run git-secrets scan on staged files
if git secrets --scan; then
    echo -e "${GREEN}✓ No secrets detected${NC}"
    exit 0
else
    echo -e "${RED}✗ Secrets detected in staged files!${NC}"
    echo ""
    echo "Please remove the secrets from your staged files before committing."
    echo ""
    echo "To remove secrets:"
    echo "  1. Edit the files to remove sensitive data"
    echo "  2. Use environment variables instead: process.env.SECRET_NAME"
    echo "  3. Add secrets to .env (.env files are gitignored)"
    echo "  4. Use a secrets management service (AWS Secrets Manager, Doppler, etc.)"
    echo ""
    echo "To bypass this check (NOT RECOMMENDED):"
    echo "  git commit --no-verify"
    echo ""
    exit 1
fi
