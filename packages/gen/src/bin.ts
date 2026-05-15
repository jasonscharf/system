#!/usr/bin/env node
/* c8 ignore file */
/**
 * CLI entry point for the Tern RDF-to-TypeScript code generator.
 *
 * Modes:
 *   tern-codegen --config <tern-gen.json>   -- merged multi-file generation
 *   tern-codegen <path/to/file.nt>          -- single-file generation (legacy)
 *   tern-codegen --watch <glob>             -- watch single files and regenerate
 */
import { generate, generateFromConfig } from './generate.js';


const [,, ...args] = process.argv;

if (args[0] === '--config') {
    const configPath = args[1];
    if (!configPath) {
        console.error('Usage: tern-codegen --config <tern-gen.json>');
        process.exit(1);
    }
    await generateFromConfig(configPath);
} else {
    const watchMode = args[0] === '--watch';
    const targets   = watchMode ? args.slice(1) : args;

    if (targets.length === 0) {
        console.error('Usage: tern-codegen [--config <tern-gen.json>] | [--watch] <file.nt> ...');
        process.exit(1);
    }

    if (watchMode) {
        const { default: chokidar } = await import('chokidar');
        const watcher = chokidar.watch(targets, { ignoreInitial: false });
        watcher.on('add', generate);
        watcher.on('change', generate);
        console.log(`[codegen] Watching ${targets.join(', ')} ...`);
    } else {
        for (const t of targets) {
            await generate(t);
        }
    }
}
