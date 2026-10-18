import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export default function portableSettings(pi, { launch = spawn, write = writeFileSync } = {}) {
  const open = async (_args, ctx) => {
    if (ctx.mode !== 'tui') { ctx.ui.notify('Portable settings require the interactive terminal app.', 'warning'); return; }
    await ctx.waitForIdle();
    const result = await new Promise((resolve, reject) => {
      const child = launch(process.env.PI_PORTABLE_LAUNCHER, ['--settings', '--portable-home', process.env.PI_PORTABLE_HOME,
        '--portable-config', process.env.PI_PORTABLE_CONFIG, '--project', ctx.cwd], { stdio: 'inherit' });
      child.on('error', reject); child.on('exit', code => resolve(code));
    });
    if (result === 2) return;
    if (result !== 0) { ctx.ui.notify('Settings could not be saved. Check the launcher message.', 'error'); return; }
    write(process.env.PI_PORTABLE_RESTART, 'settings-saved', { flag: 'wx' });
    ctx.shutdown();
  };
  pi.registerCommand('portable', { description: 'Remember provider, model, API key, project, web and delegation preferences', handler: open });
  pi.registerCommand('web', { description: 'Open persistent web-access settings', handler: open });
  pi.registerCommand('delegation', { description: 'Open persistent delegation settings', handler: open });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode === 'tui') ctx.ui.notify('Type /portable to configure your model, remembered key, web access and delegation.', 'info');
  });
}
