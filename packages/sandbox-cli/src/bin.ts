#!/usr/bin/env node

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
    switch (command) {
        case 'flow': {
            // Lazy import so CLI starts fast even without the flow package warm
            const { flowCommand } = await import('./commands/flow.js');
            await flowCommand(args);
            break;
        }
        default:
            console.log('sandbox — Tern development sandbox');
            console.log('');
            console.log('Usage: sandbox <command> [args...]');
            console.log('');
            console.log('Commands:');
            console.log('  flow    Flow-based programming tools (run, list, stop)');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
