import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Inspect staged bytes, not just working files. Never print matching secrets.
const files = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean);
const forbiddenPath = /(^|\/)(\.env(?!\.example$)|\.local|\.playwright-cli|reports|backups|data|output|test-results|playwright-report)(\/|$)|\.(sqlite(?:-wal|-shm)?|db|pem|key|p12|zip|har|log)$|deploy\/(release-.*\.sh|aliyun-sh\.md|Caddyfile\.aliyun-sh|server-backup\.cron)$/;
const secretPatterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/, /\bAKIA[A-Z0-9]{16}\b/, /\bLTAI[A-Za-z0-9]{12,}\b/, /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//];
const denyFile = '.local/privacy-denylist.json';
const privateValues = existsSync(denyFile) ? JSON.parse(readFileSync(denyFile, 'utf8')) : [];
let failed = false;
for (const file of files) {
  const content = execFileSync('git', ['show', `:${file}`], { maxBuffer: 32 * 1024 * 1024 });
  const text = content.toString('utf8');
  const forbidden = forbiddenPath.test(file) || secretPatterns.some(r => r.test(text)) || privateValues.some(v => typeof v === 'string' && v.length >= 6 && content.includes(Buffer.from(v)));
  if (forbidden) { console.error(`Private content must not be committed: ${file}`); failed = true; }
}
if (failed) process.exitCode = 1;
else console.log(`Privacy check passed: ${files.length} staged files; no private paths or detected credentials.`);
