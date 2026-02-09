#!/bin/bash
# Setup script for git-secrets
# Task 6.1 & 6.2: Install and configure git-secrets with project patterns

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   git-secrets Setup for Date Mgmt App${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if git-secrets is installed
if ! command -v git-secrets &> /dev/null; then
    echo -e "${RED}Error: git-secrets is not installed!${NC}"
    echo ""
    echo "Please install git-secrets first:"
    echo ""
    echo -e "${YELLOW}macOS (Homebrew):${NC}"
    echo "  brew install git-secrets"
    echo ""
    echo -e "${YELLOW}Ubuntu/Debian:${NC}"
    echo "  sudo apt-get install git-secrets"
    echo ""
    echo -e "${YELLOW}Windows (Git for Windows with bash):${NC}"
    echo "  1. Clone: git clone https://github.com/awslabs/git-secrets.git"
    echo "  2. cd git-secrets"
    echo "  3. sudo make install"
    echo ""
    echo -e "${YELLOW}Manual installation:${NC}"
    echo "  https://github.com/awslabs/git-secrets#installing-git-secrets"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ git-secrets is installed${NC}"
echo ""

# Initialize git-secrets in the repository
echo -e "${YELLOW}Initializing git-secrets in repository...${NC}"
if git secrets --install --force; then
    echo -e "${GREEN}✓ git-secrets hooks installed${NC}"
else
    echo -e "${RED}✗ Failed to install git-secrets hooks${NC}"
    exit 1
fi
echo ""

# Register AWS provider patterns
echo -e "${YELLOW}Registering AWS patterns...${NC}"
git secrets --register-aws
echo -e "${GREEN}✓ AWS patterns registered${NC}"
echo ""

# Add custom patterns
echo -e "${YELLOW}Adding custom secret patterns...${NC}"

# API Keys & Tokens
git secrets --add 'password\s*[:=]\s*["\047]?.{8,}["\047]?'
git secrets --add 'api[_-]?key\s*[:=]\s*["\047]?.{16,}["\047]?'
git secrets --add 'secret[_-]?key\s*[:=]\s*["\047]?.{16,}["\047]?'
git secrets --add 'token\s*[:=]\s*["\047]?.{16,}["\047]?'
git secrets --add 'jwt[_-]?secret\s*[:=]\s*["\047]?.{16,}["\047]?'

# Database connection strings with credentials
git secrets --add 'database[_-]?url\s*[:=]\s*["\047]?.*\:\/\/.*\:.*\@'

# Service-specific patterns
git secrets --add 'AKIA[0-9A-Z]{16}'  # AWS Access Key ID
git secrets --add 'sk-[a-zA-Z0-9]{32,}'  # OpenAI API Key
git secrets --add 'ghp_[a-zA-Z0-9]{36,}'  # GitHub Personal Access Token
git secrets --add 'gho_[a-zA-Z0-9]{36,}'  # GitHub OAuth Token
git secrets --add 'github_pat_[a-zA-Z0-9_]{82}'  # GitHub Fine-grained PAT

# Private keys
git secrets --add '-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----'

# Cloudflare R2 patterns
git secrets --add 'r2[_-]?access[_-]?key[_-]?id\s*[:=]\s*["\047]?[a-f0-9]{32}["\047]?'
git secrets --add 'r2[_-]?secret[_-]?access[_-]?key\s*[:=]\s*["\047]?.{40,}["\047]?'

# Neon Database patterns
git secrets --add 'neon[_-]?api[_-]?key\s*[:=]\s*["\047]?[a-zA-Z0-9_-]{32,}["\047]?'

echo -e "${GREEN}✓ Custom patterns added${NC}"
echo ""

# Add allowed exceptions
echo -e "${YELLOW}Configuring allowed patterns (exceptions)...${NC}"

git secrets --add --allowed '.env.example'
git secrets --add --allowed 'your-secret-key-here'
git secrets --add --allowed 'your_access_key_id'
git secrets --add --allowed 'your_secret_access_key'
git secrets --add --allowed 'change-in-production'
git secrets --add --allowed 'example.com'
git secrets --add --allowed 'localhost'
git secrets --add --allowed 'test-api-key'
git secrets --add --allowed 'mock-token'
git secrets --add --allowed 'fake-password'

echo -e "${GREEN}✓ Allowed patterns configured${NC}"
echo ""

# Install pre-commit hook
echo -e "${YELLOW}Installing pre-commit hook...${NC}"
if [ -f "scripts/pre-commit-secrets.sh" ]; then
    cp scripts/pre-commit-secrets.sh .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo -e "${GREEN}✓ Pre-commit hook installed${NC}"
else
    echo -e "${RED}✗ scripts/pre-commit-secrets.sh not found${NC}"
fi
echo ""

# Test the configuration
echo -e "${YELLOW}Testing secrets scan...${NC}"
if git secrets --scan; then
    echo -e "${GREEN}✓ No secrets detected in current state${NC}"
else
    echo -e "${RED}✗ Secrets detected! Please review and remove them.${NC}"
fi
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "git-secrets is now configured for this repository."
echo ""
echo "Usage:"
echo "  • Scan staged files:     git secrets --scan"
echo "  • Scan all history:      git secrets --scan-history"
echo "  • Scan via npm:          npm run secrets-scan"
echo "  • Pre-commit hook:       Automatically runs on 'git commit'"
echo ""
echo -e "${YELLOW}Note:${NC} The pre-commit hook will block commits containing secrets."
echo "To bypass (NOT RECOMMENDED): git commit --no-verify"
echo ""
