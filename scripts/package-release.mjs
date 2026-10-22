// Reuse a verified Linux runtime when a registry is unavailable. Never copy native
// macOS dependencies. BASE_LOCK_FILE may allow additions of portable JS/WASM only.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const target = path.resolve(process.argv[2] || '.local/deploy/image-release');
if (existsSync(target)) throw new Error('Use a new output directory; existing artifacts are never overwritten.');
if (!existsSync('.next-build/standalone/server.js')) throw new Error('Build with NEXT_DIST_DIR=.next-build first.');
const current = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const base = process.env.BASE_LOCK_FILE ? JSON.parse(readFileSync(process.env.BASE_LOCK_FILE, 'utf8')) : current;
for (const [name, dep] of Object.entries(base.packages)) {
  if (!name || dep.dev) continue;
  assert.equal(current.packages[name]?.version, dep.version, 'Existing dependency changed; use a full Linux build: ' + name);
}
const added = Object.keys(current.packages).filter(name => name && !base.packages[name] && !current.packages[name].dev);
for (const name of added) {
  const dep = current.packages[name];
  assert.ok(!dep.hasInstallScript && !dep.os && !dep.cpu, 'Platform-specific addition requires a full Linux build: ' + name);
  for (const file of readdirSync(name, { recursive: true })) {
    assert.ok(!/\.(node|dylib|so|exe|dll)$/.test(String(file)), 'Native module cannot be copied from this host: ' + name);
  }
}
mkdirSync(target, { recursive: true });
cpSync('.next-build/standalone/.next-build', path.join(target, 'build'), { recursive: true, verbatimSymlinks: true });
cpSync('.next-build/static', path.join(target, 'build/static'), { recursive: true, verbatimSymlinks: true });
cpSync('.next-build/standalone/server.js', path.join(target, 'server.js'));
for (const item of ['src', 'scripts', 'migrations', 'public', 'package.json', 'package-lock.json', 'tsconfig.json']) cpSync(item, path.join(target, item), { recursive: true, verbatimSymlinks: true });
mkdirSync(path.join(target, 'portable-modules'));
for (const name of added) {
  const destination = path.join(target, 'portable-modules', name.replace(/^node_modules\//, ''));
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(name, destination, { recursive: true, verbatimSymlinks: true });
}
writeFileSync(path.join(target, 'base-dependencies.json'), JSON.stringify(base.packages[''].dependencies));
cpSync('deploy/Dockerfile.cached-runtime', path.join(target, 'Dockerfile'));
console.log('Packaged release with ' + added.length + ' portable dependency additions. No data or credentials included.');
