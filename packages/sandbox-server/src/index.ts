/**
 * Sandbox server — a minimal Tern application loaded from config.
 *
 * Boot sequence:
 *   1. Open the SQLite triple store (seeded with well-known namespaces).
 *   2. Load app config from  config/app.yaml, which references:
 *        config/extensions/core.yaml   — ping handler (YAML format)
 *        config/extensions/data.ttl    — triple-store handlers (Turtle/RDF)
 *   3. TernApp merges extension configs, builds the HandlerRegistry.
 *   4. The FBP pipeline is wired: WS → decode → route → encode → WS.
 *   5. Handlers are imported lazily on first request.
 *
 * To add a new message type:
 *   - Write a handler module in src/handlers/
 *   - Register it in one of the extension configs (or app.yaml user overrides)
 *   - No code changes to this file needed.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FlowApp } from '@system/flow';
import { WebSocketServer } from '@system/flow';
import { TernApp } from '@system/app';
import { createDataContext, TripleStore } from '@system/data';
import { MessageDecoder } from './components/MessageDecoder.js';
import { MessageEncoder } from './components/MessageEncoder.js';
import { MessageRouter } from './components/MessageRouter.js';


const PORT    = Number(process.env['PORT']       ?? 8080);
const DB_PATH = process.env['TERN_DB_PATH']      ?? ':memory:';
const CONFIG  = resolve(fileURLToPath(new URL('../config/app.yaml', import.meta.url)));

async function main(): Promise<void> {
    // ── Data layer ────────────────────────────────────────────────────────────
    const knex  = await createDataContext({ client: 'sqlite', filename: DB_PATH });
    const store = new TripleStore(knex);

    await store.ensureNamespace('tern', 'http://tern.dev/ns/');
    await store.ensureNamespace('rdf',  'http://www.w3.org/1999/02/22-rdf-syntax-ns#');
    await store.ensureNamespace('rdfs', 'http://www.w3.org/2000/01/rdf-schema#');

    // ── Application config ────────────────────────────────────────────────────
    // Loads config/app.yaml → merges core.yaml (YAML) + data.ttl (Turtle/RDF)
    const ternApp = await TernApp.fromYAML(CONFIG, { context: { store } });

    console.log(`[sandbox-server] Loaded config: ${ternApp.config.name} v${ternApp.config.version ?? '?'}`);
    console.log(`[sandbox-server] Registered types: ${ternApp.registry.registeredTypes.join(', ')}`);

    // ── FBP pipeline ──────────────────────────────────────────────────────────
    const flowApp = new FlowApp({ mode: 'push' });

    const wsServer = new WebSocketServer({ name: 'ws',      context: flowApp.context, port: PORT });
    const decoder  = new MessageDecoder({ name: 'decoder',  context: flowApp.context });
    const router   = new MessageRouter({
        name:           'router',
        context:         flowApp.context,
        dispatcher:      ternApp.registry,   // HandlerRegistry implements Dispatcher
        handlerContext:  { store },           // passed to every handler as ctx.store
    });
    const encoder  = new MessageEncoder({ name: 'encoder',  context: flowApp.context });

    flowApp
        .addComponent(wsServer)
        .addComponent(decoder)
        .addComponent(router)
        .addComponent(encoder)
        .connect(wsServer.received, decoder.in)
        .connect(decoder.out,       router.in)
        .connect(router.out,        encoder.in)
        .connect(encoder.out,       wsServer.send);

    await flowApp.start();
    flowApp.scheduler.start();

    console.log(`[sandbox-server] Listening on ws://127.0.0.1:${PORT}`);
    console.log(`[sandbox-server] DB: ${DB_PATH}`);

    process.once('SIGINT', async () => {
        console.log('\n[sandbox-server] Shutting down…');
        await flowApp.stop();
        await knex.destroy();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('[sandbox-server] Fatal:', err);
    process.exit(1);
});
