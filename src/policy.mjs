import { createGuard } from './network.mjs';

export default function portablePolicy(pi) {
  try {
    const config = JSON.parse(process.env.PI_PORTABLE_NETWORK);
    // Pi reports extension initialization errors and continues, so fail closed here.
    globalThis.fetch = createGuard(config, { fetch: globalThis.fetch.bind(globalThis), report: message => console.error(message) });
  } catch {
    console.error('Pi Portable transport policy is invalid. Check portable.json, proxy and CA settings.');
    process.exit(1);
  }
  const allowed = process.env.PI_PORTABLE_TOOLS.split(',');
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
