import { webScope } from './web-network.mjs';
import extension from '../vendor/pi-agent-web-access/bundle.ts';

export async function registerWeb(pi, config, allowed) {
  if (config.web?.enabled !== true) return;
  extension({ ...pi, registerTool(definition) {
    if (!['web_search', 'fetch_content'].includes(definition.name)) throw new Error('Unexpected web extension tool');
    if (!allowed.includes(definition.name)) allowed.push(definition.name);
    pi.registerTool({ ...definition, execute(id, params, signal, onUpdate, ctx) {
      const options = definition.name === 'web_search' ? { ...params, provider: params.provider ?? config.web.provider ?? 'auto' } : params;
      return webScope.run(true, () => definition.execute(id, options, signal, onUpdate, ctx));
    } });
  } });
}
