#!/usr/bin/env node
/**
 * Pre-Launch Security Scanner (#1, #2)
 * Verifies that no hardcoded API keys, private credentials, or server secrets
 * exist in git-tracked frontend or configuration files.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN_PATTERNS = [
  { name: 'Hardcoded Google API Key', regex: /AIzaSy[A-Za-z0-9_-]{33}/ },
  { name: 'Client-exposed Gemini API Key', regex: /EXPO_PUBLIC_GEMINI_API_KEY/ },
  { name: 'Client-exposed n8n API Key', regex: /EXPO_PUBLIC_N8N_API_KEY/ },
  { name: 'RSA / PEM Private Key', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

const IGNORED_FILES = new Set([
  '.env',
  '.env.local',
  '.env.example',
  'scripts/audit-keys.js',
  'scripts/generate-pdf.js',
]);

function runAudit() {
  const trackedRaw = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  const files = trackedRaw
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);

  const violations = [];

  for (const relPath of files) {
    if (IGNORED_FILES.has(relPath)) continue;
    if (/\.(png|jpg|jpeg|gif|webp|wav|mp3|ttf|otf|ico|pdf)$/i.test(relPath)) continue;

    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;

    const content = fs.readFileSync(absPath, 'utf8');
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.regex.test(content)) {
        violations.push({ file: relPath, rule: rule.name });
      }
    }
  }

  if (violations.length > 0) {
    console.error('❌ SECRET AUDIT FAILED — Found exposed credentials:');
    for (const v of violations) {
      console.error(`   - [${v.rule}] in ${v.file}`);
    }
    process.exit(1);
  }

  console.log(`✅ SECRET AUDIT PASSED: Scanned ${files.length} tracked files. Zero hardcoded API keys or frontend secrets found.`);
}

runAudit();

