import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseNTriples, readOntology, generateTypes } from './index.js';


/**
 * Reads an RDF file, generates TypeScript types, and writes a sibling `.generated.ts` file.
 * The output path is derived by replacing the RDF extension with `.generated.ts`.
 */
export async function generate(inputPath: string): Promise<void> {
    const content = await readFile(inputPath, 'utf-8');
    const triples = [];
    for await (const t of parseNTriples(content)) {
        triples.push(t);
    }
    const ontology = readOntology(triples);
    const source = generateTypes(ontology, path.basename(inputPath));

    const outPath = inputPath.replace(/\.(nt|n3|ttl|rdf)$/, '.generated.ts');
    await writeFile(outPath, source, 'utf-8');
    console.log(`[gen] ${path.basename(inputPath)} → ${path.basename(outPath)}`);
}
