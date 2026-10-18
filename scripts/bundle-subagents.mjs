import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isBuiltin } from 'node:module';

const target = 'vendor/pi-subagents';
const packageRoot = resolve('node_modules/pi-subagents');
mkdirSync(target, { recursive: true });
cpSync(packageRoot, `${target}/upstream`, { recursive: true });
// These are read-only resources for upstream's worker/require-based paths.
for (const name of ['acorn', 'yaml', 'jiti', 'undici', '@js-temporal/polyfill', 'jsbi'])
  cpSync(`node_modules/${name}`, `${target}/upstream/node_modules/${name}`, { recursive: true });
const sdkModules = ['@earendil-works/pi-ai', '@earendil-works/pi-tui', '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core'];
const result = await build({
  entryPoints: ['src/subagents-entry.ts'], outfile: `${target}/bundle.ts`,
  bundle: true, platform: 'node', format: 'esm', target: 'es2022', metafile: true, minify: true, legalComments: 'inline',
  external: sdkModules,
  plugins: [{ name: 'portable-boundaries', setup(builder) {
    builder.onLoad({ filter: /pi-subagents[\\/].*\.js$/ }, ({ path }) => {
      let source = readFileSync(path, 'utf8');
      if (path === join(packageRoot, 'src/agents/agents.js')) {
        source = source.replaceAll('const projectTrusted = options.projectTrusted !== false;', 'const projectTrusted = false;');
        source = source.replace('function getProjectAgentSettingsPath(cwd) {', 'function getProjectAgentSettingsPath(cwd) { return null;');
        source = source.replace('function extraUserAgentDirs() {', 'function extraUserAgentDirs() { return [];');
        source = source.replaceAll('path.join(os.homedir(), ".agents")', 'path.join(getAgentDir(), "disabled-host-agents")');
        source = source.replace('function collectPackageSubagentPaths(cwd, options) {', 'function collectPackageSubagentPaths(cwd, options) { return { agents: [], chains: [], watchPaths: [], settingsErrors: {} };');
        const defaults = 'function applySubagentDefaults(agents, defaultModel, defaultProvider, defaultThinking, defaultExtensions, defaultSubagentOnlyExtensions) {';
        if (!source.includes(defaults)) throw new Error('Upstream agent defaults boundary changed');
        source = source.replace(defaults, defaults + '\nfor (const agent of agents) if (agent.tools) agent.tools = agent.tools.map(name => name === "bash" ? "powershell" : name);');
      }
      if (path.endsWith('async-execution.js')) {
        source = source.replace('export function isAsyncAvailable() {', 'export function isAsyncAvailable() { return false;');
        const signature = 'function spawnRunner(cfg, suffix, cwd, initialStatus, initialStatusPath, launchParentSessionId, onProcessTerminal, onBeforeProceed, requestedCwd = cwd) {';
        if (!source.includes(signature)) throw new Error('Upstream runner boundary changed');
        source = source.replace(signature, signature + '\nreturn { error: "Detached subagent runners are disabled in Pi Portable Windows; use async: false." };');
      }
      if (path.endsWith('host-command.js')) {
        source = source.replace('export async function executeWorkflowHostCommand(input) {', 'export async function executeWorkflowHostCommand(input) {\nif (!process.env.PI_PORTABLE_TOOLS.split(",").includes("powershell")) throw new Error("Workflow host commands require the full portable profile");');
      }
      if (path.endsWith('subagent-executor.js')) {
        const boundary = 'if (deps.state.subagentInProgress === true)';
        if (!source.includes(boundary)) throw new Error('Upstream foreground dispatch boundary changed');
        source = source.replace(boundary, 'if (requestParams[Symbol.for("pi-portable.foreground-batch")] === true) return execute(id, requestParams, signal, onUpdate, ctx).then(withAggregatedToolUsage);\n        ' + boundary);
      }
      // Bundling must retain each original module's asset-relative paths.
      const name = relative(packageRoot, path).replaceAll('\\', '/');
      if (source.includes('import.meta.url')) {
        source = source.replaceAll('import.meta.url', '__portableModuleUrl');
        source = `const __portableModuleUrl = new URL(${JSON.stringify(`./upstream/${name}`)}, import.meta.url).href;\n${source}`;
      }
      return { contents: source, loader: 'js', resolveDir: resolve(path, '..') };
    });
  } }],
});
for (const output of Object.values(result.metafile.outputs))
  for (const entry of output.imports)
    if (entry.external && !isBuiltin(entry.path) && !sdkModules.includes(entry.path)) throw new Error(`Unbundled module: ${entry.path}`);
function hashes(path, prefix = '') {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = `${prefix}${entry.name}`;
    return entry.isDirectory() ? Object.entries(hashes(join(path, entry.name), `${name}/`)) : [[name, createHash('sha256').update(readFileSync(join(path, entry.name))).digest('hex')]];
  }));
}
writeFileSync('subagents-release.json', JSON.stringify({
  name: 'pi-subagents', version: '0.79.1', sourceCommit: '95683a4427e1e4af8de03f1a9ca03ec4c2799b73',
  url: 'https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.79.1.tgz',
  integrity: 'sha512-7r+Dz2G9ewTuRrgmLnXGfK+nc14ZjVC+sWkw2WaL40MbYmlHeIxmfTMxDRvVSlK+CptKUArV6PtXAQtWZzCUVQ==',
  adaptations: ['Preserve original asset-relative module URLs', 'Disable ambient project/user/package agents and project settings', 'Map role bash requests to native PowerShell before profile intersection', 'Disable detached runners', 'Require full profile for workflow host commands', 'Permit adapter-owned foreground batches through the single-dispatch guard using a non-JSON Symbol'],
  dependencies: ['acorn', 'yaml', 'jiti', 'undici', '@js-temporal/polyfill', 'jsbi'].map(name => { const pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`)); return { name, version: pkg.version, license: pkg.license }; }),
  files: hashes(target),
}, null, 2) + '\n');
console.log(`Bundled pi-subagents 0.79.1 (${Object.keys(hashes(target)).length} checked files).`);
