/**
 * This script reloads containers when relevant changes are detected.
 * This is as opposed to having in-container tooling perform these duties
 */
import chokidar from 'chokidar';
import { exec } from 'child_process';


let restarting = false;

export function restartRoles() {
    if (restarting) {
        return;
    }

    restarting = true;

    console.log(`♻️ Restarting ${roleName}...`);

    exec('yarn compose restart worker api', (err, stdout, stderr) => {
        if (err) {
            console.log(`Error: ${err}`)
        }

        console.log(stdout, stderr)
        restarting = false;
    });
};

// Note: Role 'test' uses vitest's watch implementation at the moment
const watcher = chokidar.watch(
    [
        'packages/api/dist',
        'packages/core/dist',
        'packages/worker/dist'
    ],
    {
        ignoreInitial: true
    }
);

watcher.on('all', (event, path) => {
    const match = path.match(/^packages\/([^\/]+)\//);

    const packageName = match && match.length > 0 ? match[1] : '(unknown)';
    console.log(`🔄 ${event}: ${path} in package ${packageName}`);

    restartRoles();
});
