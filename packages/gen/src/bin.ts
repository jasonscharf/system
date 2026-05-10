#!/usr/bin/env node
/* c8 ignore file */
/**
 * CLI entry point for the Tern RDF-to-TypeScript code generator.
 *
 * Usage:
 *   tern-codegen <path/to/file.nt>    -- generate once
 *   tern-codegen --watch <glob>       -- watch and regenerate on change
 */
import { generate } from './generate.js';


const [,, ...args] = process.argv;
const watchMode = args[0] === '--watch';
const targets = watchMode ? args.slice(1) : args;

if (targets.length === 0) {
    console.error('Usage: tern-codegen [--watch] <file.nt> [file2.nt ...]');
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
