import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isBuiltin } from 'node:module';

const target = 'vendor/pi-agent-web-access';
mkdirSync(target, { recursive: true });
cpSync('node_modules/pi-agent-web-access', `${target}/upstream`, { recursive: true });
const result = await build({
  entryPoints: ['node_modules/pi-agent-web-access/dist/index.mjs'],
  bundle: true, platform: 'node', format: 'esm', target: 'es2022',
  outfile: `${target}/bundle.ts`, metafile: true, legalComments: 'inline',
  external: ['@earendil-works/pi-ai', '@earendil-works/pi-tui'],
  plugins: [{ name: 'portable-state', setup(builder) {
    builder.onLoad({ filter: /pi-agent-web-access[\\/]dist[\\/]index\.mjs$/ }, ({ path }) => {
      const original = readFileSync(path, 'utf8');
      const needle = 'join(homedir(), ".pi")';
      const usage = 'join(homedir(), ".pi", "exa-usage.json")';
      if (!original.includes(needle) || !original.includes(usage)) throw new Error('Upstream usage path changed; review adaptation');
      return { contents: original.replace(usage, 'join(process.env.PI_PORTABLE_WEB_STATE, "exa-usage.json")').replace(needle, 'process.env.PI_PORTABLE_WEB_STATE'), loader: 'js' };
    });
    // HTML extraction does not need native canvas support or target-side native modules.
    builder.onResolve({ filter: /^canvas$/ }, () => ({ path: 'canvas', namespace: 'no-canvas' }));
    builder.onLoad({ filter: /.*/, namespace: 'no-canvas' }, () => ({ contents: 'export default null;', loader: 'js' }));
  } }],
});
for (const output of Object.values(result.metafile.outputs))
  for (const entry of output.imports)
    if (entry.external && !isBuiltin(entry.path) && !['@earendil-works/pi-ai', '@earendil-works/pi-tui'].includes(entry.path))
      throw new Error(`Unbundled runtime dependency: ${entry.path}`);
const packages = new Set();
for (const path of Object.keys(result.metafile.inputs)) {
  const match = path.replaceAll('\\', '/').match(/^(node_modules\/(?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}
const dependencies = [];
for (const path of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const output = join(target, 'licenses', pkg.name.replaceAll('/', '__'));
  mkdirSync(output, { recursive: true });
  cpSync(join(path, 'package.json'), join(output, 'package.json'));
  const files = readdirSync(path).filter(name => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(name));
  for (const name of files) cpSync(join(path, name), join(output, name));
  dependencies.push({ name: pkg.name, version: pkg.version, license: pkg.license, notices: files });
}
function hashes(path, prefix = '') {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = `${prefix}${entry.name}`;
    return entry.isDirectory() ? Object.entries(hashes(join(path, entry.name), `${name}/`)) : [[name, createHash('sha256').update(readFileSync(join(path, entry.name))).digest('hex')]];
  }));
}
if (!existsSync(`${target}/LICENSE`)) throw new Error('Retain the upstream repository license before bundling');
writeFileSync('web-access-release.json', JSON.stringify({
  name: 'pi-agent-web-access', version: '1.1.2',
  url: 'https://registry.npmjs.org/pi-agent-web-access/-/pi-agent-web-access-1.1.2.tgz',
  integrity: 'sha512-EX4Ni5u9xocW29RyyLqg25Xbd6nsyBj2ikIuunf8ZOyAARnDwkL12F9qpJEvDG1oZS93lqZnwKgQQigRZyI8qg==',
  sourceCommit: 'c4bd7b9d459bc510283b91202449abb4c2f7bfc6',
  adaptations: ['Redirect Exa usage ledger to PI_PORTABLE_WEB_STATE', 'Disable optional native canvas'],
  dependencies, files: hashes(target),
}, null, 2) + '\n');
console.log(`Bundled pi-agent-web-access 1.1.2 and ${dependencies.length - 1} runtime dependencies.`);
