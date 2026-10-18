import { createGuard } from './network.mjs';
import { createWebGuard, webScope } from './web-network.mjs';
import { registerWeb } from './web.ts';

export default async function portablePolicy(pi) {
  const allowed = process.env.PI_PORTABLE_TOOLS.split(',');
  try {
    const config = JSON.parse(process.env.PI_PORTABLE_NETWORK);
    const subagents = config.subagents ?? {};
    if (!subagents || typeof subagents !== 'object' || Array.isArray(subagents) || Object.keys(subagents).some(key => key !== 'enabled') || subagents.enabled !== undefined && typeof subagents.enabled !== 'boolean') throw new Error('Invalid subagents configuration');
    // Pi reports extension initialization errors and continues, so fail closed here.
    const transport = globalThis.fetch.bind(globalThis);
    const modelFetch = createGuard(config, { fetch: transport, report: message => console.error(message) });
    const webFetch = createWebGuard(config, { fetch: transport });
    globalThis.fetch = (input, init) => webScope.getStore() ? webFetch(input, init) : modelFetch(input, init);
    await registerWeb(pi, config, allowed);
  } catch {
    console.error('Pi Portable transport policy is invalid. Check portable.json, proxy, CA and web settings.');
    process.exit(1);
  }
  const enforce = () => pi.setActiveTools(allowed);
  pi.on('session_start', enforce);
  pi.on('before_agent_start', (_, ctx) => {
    enforce();
    if (ctx.model?.provider !== 'portable') throw new Error('Use the configured portable provider');
  });
  pi.on('tool_call', event => {
    if (!allowed.includes(event.toolName)) return { block: true, reason: 'Tool is disabled by the launch profile' };
  });
}
