import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';


interface RunningApp {
    id: string;
    name: string;
    file: string;
    stop: () => Promise<void>;
}

const _running = new Map<string, RunningApp>();
let _nextId = 1;


export async function flowRun(args: string[]): Promise<void> {
    const file = args[0];
    if (!file) {
        console.error('Usage: flow run <file>');
        process.exit(1);
    }

    const absPath = resolve(process.cwd(), file);
    const text = await readFile(absPath, 'utf8');
    const ext = extname(absPath).toLowerCase();

    // Lazy import so the flow package is only loaded when the command is used
    const { FlowLoader } = await import('@jasonscharf/flow');

    let app;
    if (ext === '.json') {
        app = await FlowLoader.fromJSON(text, { baseUrl: absPath });
    } else if (ext === '.yaml' || ext === '.yml') {
        app = await FlowLoader.fromYAML(text, { baseUrl: absPath });
    } else if (ext === '.ttl' || ext === '.nt' || ext === '.nq') {
        app = await FlowLoader.fromRDF(text, { baseUrl: absPath });
    } else {
        console.error(`Unsupported file type: ${ext}. Use .json, .yaml/.yml, or .ttl/.nt/.nq`);
        process.exit(1);
    }

    const id = String(_nextId++);
    const name = (app as { name?: string }).name ?? file;

    await app.start();

    const entry: RunningApp = {
        id,
        name,
        file: absPath,
        stop: () => app.stop(),
    };
    _running.set(id, entry);

    console.log(`[flow] Started app #${id} "${name}" from ${file}`);
    console.log('[flow] Press Ctrl+C to stop.');

    process.once('SIGINT', async () => {
        console.log(`\n[flow] Stopping app #${id}…`);
        await app.stop();
        _running.delete(id);
        process.exit(0);
    });

    // Keep the process alive until the app stops
    await new Promise<void>(r => {
        const check = setInterval(() => {
            if (!_running.has(id)) { clearInterval(check); r(); }
        }, 500);
    });
}


export function flowList(_args: string[]): void {
    if (_running.size === 0) {
        console.log('[flow] No running apps.');
        return;
    }
    console.log('[flow] Running apps:');
    for (const app of _running.values()) {
        console.log(`  #${app.id}  ${app.name}  (${app.file})`);
    }
}


export async function flowStop(args: string[]): Promise<void> {
    const id = args[0];
    if (!id) {
        console.error('Usage: flow stop <id>');
        process.exit(1);
    }
    const app = _running.get(id);
    if (!app) {
        console.error(`[flow] No running app with id ${id}`);
        process.exit(1);
    }
    await app.stop();
    _running.delete(id);
    console.log(`[flow] Stopped app #${id} "${app.name}"`);
}


export async function flowCommand(args: string[]): Promise<void> {
    const sub = args[0];
    const rest = args.slice(1);

    switch (sub) {
        case 'run':  return flowRun(rest);
        case 'list': return flowList(rest);
        case 'stop': return flowStop(rest);
        default:
            console.log('Usage: sandbox flow <run|list|stop> [args...]');
            console.log('');
            console.log('Commands:');
            console.log('  run <file>    Load and run a flow program (.json, .yaml, .ttl)');
            console.log('  list          List running flow apps');
            console.log('  stop <id>     Stop a running flow app by id');
    }
}
