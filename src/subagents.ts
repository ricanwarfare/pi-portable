import * as sdk from '@earendil-works/pi-coding-agent';
import registerExtension, { createDefaultChildSessionFactory, setChildSessionFactory, registerSubagentCapabilityCeiling } from '../vendor/pi-subagents/bundle.ts';
import { registerWeb } from './web.ts';

export const subagentTools = ['subagent', 'subagents_enable', 'bg_wait', 'contact_supervisor', 'subagent_supervisor'];
const builtinAgents = ['scout', 'researcher', 'evidence-auditor', 'worker', 'reviewer', 'oracle', 'delegate'];

export default async function portableSubagents(pi) {
  try { await registerSubagents(pi, JSON.parse(process.env.PI_PORTABLE_NETWORK), process.env.PI_PORTABLE_TOOLS.split(',')); }
  catch (error) {
    console.error('Pi Portable could not initialize bundled subagents.');
    process.exit(1);
  }
}

export async function registerSubagents(pi, config, allowed) {
  const settings = config.subagents ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(name => name !== 'enabled') || settings.enabled !== undefined && typeof settings.enabled !== 'boolean') throw new Error('Invalid subagents configuration');
  if (settings.enabled !== true) return;
  const baseTools = allowed.filter(name => !subagentTools.includes(name));
  const model = `portable/${config.model}`;
  const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => sdk });
  setChildSessionFactory({
    async create(launch) {
      if (launch.machine) throw new Error('External subagent machines are disabled in Pi Portable');
      const requested = (launch.tools ?? baseTools).map(name => name === 'bash' ? 'powershell' : name);
      const tools = [...new Set(requested.filter(name => baseTools.includes(name) || name === 'contact_supervisor'))];
      const hooks = [...launch.hooks, { name: 'portable:child-policy', factory(api) {
        api.on('tool_call', event => !tools.includes(event.toolName) ? { block: true, reason: 'Tool is outside the portable profile' } : undefined);
        api.on('before_agent_start', (_, ctx) => { if (ctx.model?.provider !== 'portable') throw new Error('Only the configured portable model is permitted'); });
      } }];
      if (config.web?.enabled === true) hooks.push({ name: 'portable:child-web', factory: api => registerWeb(api, config, tools) });
      return factory.create({ ...launch, model, tools, hooks, parentProviderRegistry: undefined,
        projectTrusted: false, ambientExtensions: false, extensionPaths: [], requiredExtensions: [],
        builtinMcpTools: [], noSkills: true, noContextFiles: true });
    },
    dispose: () => factory.dispose(),
  });
  let ceiling;
  pi.on('session_start', (_, ctx) => {
    ceiling?.dispose();
    ceiling = registerSubagentCapabilityCeiling({ sessionId: ctx.sessionManager.getSessionId(), source: 'pi-portable',
      ceiling: { allowedTools: [...baseTools, 'contact_supervisor'], allowedAgents: builtinAgents, denyExtensions: true } });
  });
  pi.on('session_shutdown', () => ceiling?.dispose());
  registerExtension({ ...pi, registerTool(definition) {
    if (!subagentTools.includes(definition.name)) throw new Error(`Unexpected subagent tool ${definition.name}`);
    pi.registerTool({ ...definition, ...(definition.name === 'subagent' ? { description: 'Delegate to bundled agents with the same portable model and tool profile. Single: {agent,task,async:false}. Parallel: {tasks:[{agent,task},...],async:false}. Sequential: {chain:[{agent,task},...],async:false}; each step receives previous results. Maximum 8 children per call. Discover roles with {action:"list"}. Detached runners, JavaScript workflows, worktrees and external agents are disabled.' } : {}), async execute(id, params, signal, update, ctx) {
      if (definition.name === 'subagent') {
        if (params.async === true) throw new Error('Detached Windows runners are disabled; use async: false');
        if (params.model && params.model !== model && params.model !== config.model && params.model !== 'inherit') throw new Error('Subagents must use the configured portable model');
        if (params.worktree || params.options?.isolation === 'worktree') throw new Error('Automatic worktrees are disabled in Pi Portable');
        if (params.workflow || params.script || params.workflowScript || params.workflowScriptPath) throw new Error('JavaScript workflows are disabled in Pi Portable');
        if (params.tasks || params.chain) {
          if (params.tasks && params.chain || params.agent || params.task) throw new Error('Choose one subagent execution mode');
          const steps = params.tasks ?? params.chain;
          if (!Array.isArray(steps) || !steps.length || steps.length > 8) throw new Error('Use 1 to 8 subagent steps');
          for (const step of steps) {
            if (!step || typeof step.agent !== 'string' || typeof step.task !== 'string' || Object.keys(step).some(key => !['agent', 'task'].includes(key)))
              throw new Error('Portable steps accept only agent and task');
          }
          const run = (step, index, previous = '') => definition.execute(`${id}-${index}`, { agent: step.agent,
            task: previous ? `${step.task}\n\nPrevious step result:\n${previous}` : step.task, async: false, output: false,
            [Symbol.for('pi-portable.foreground-batch')]: true }, signal, undefined, ctx);
          let results;
          if (params.tasks) results = await Promise.all(steps.map((step, index) => run(step, index)));
          else {
            results = [];
            for (const [index, step] of steps.entries()) {
              if (signal?.aborted) throw new Error('Subagent chain cancelled');
              const result = await run(step, index, results.at(-1)?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n'));
              results.push(result);
              if (result.isError) break;
            }
          }
          return { content: results.flatMap(result => result.content), isError: results.some(result => result.isError), details: { mode: params.tasks ? 'parallel' : 'chain', results: results.map(result => result.details) } };
        }
        return definition.execute(id, { ...params, async: false, output: false }, signal, update, ctx);
      }
      return definition.execute(id, params, signal, update, ctx);
    } });
  } });
}
