import type { OntologyClass, OntologyProperty, Ontology } from './OntologyReader.js';


const XSD_PREFIX = 'http://www.w3.org/2001/XMLSchema#';

const XSD_TO_TS: Record<string, string> = {
    string: 'string',
    boolean: 'boolean',
    integer: 'number',
    decimal: 'number',
    float: 'number',
    double: 'number',
    long: 'number',
    int: 'number',
    short: 'number',
    byte: 'number',
    dateTime: 'Date',
    date: 'Date',
    anyURI: 'string',
};

function xsdToTs(rangeIRI: string | null): string {
    if (!rangeIRI) return 'unknown';
    if (rangeIRI.startsWith(XSD_PREFIX)) {
        const local = rangeIRI.slice(XSD_PREFIX.length);
        return XSD_TO_TS[local] ?? 'string';
    }
    // For object properties that reference another class, use the local name
    const hash = rangeIRI.lastIndexOf('#');
    const slash = rangeIRI.lastIndexOf('/');
    return rangeIRI.slice(Math.max(hash, slash) + 1);
}

function iriConstName(localName: string): string {
    return `${localName}IRI`;
}

function renderProperty(prop: OntologyProperty): string {
    const tsType = prop.kind === 'data' ? xsdToTs(prop.range) : xsdToTs(prop.range);
    const comment = prop.comment ? `    /** ${prop.comment} */\n` : '';
    return `${comment}    ${prop.name}?: ${tsType};`;
}

function renderClass(cls: OntologyClass): string {
    const comment = cls.comment ? `/** ${cls.comment} */\n` : '';
    const props = cls.properties.map(renderProperty).join('\n');
    return `${comment}export interface ${cls.name} {\n${props}\n}`;
}

function renderIRIConstant(iri: string, name: string): string {
    return `export const ${iriConstName(name)} = new IRI('${iri}');`;
}

/**
 * Generates a TypeScript source file from an ontology.
 * The file is self-contained and can be imported anywhere @system/core is available.
 */
export function generateTypes(ontology: Ontology, sourceFile: string): string {
    const lines: string[] = [
        `// auto-generated from ${sourceFile} — do not edit by hand`,
        `import { IRI } from '@system/core';`,
        '',
    ];

    for (const cls of ontology.classes.values()) {
        lines.push(renderClass(cls));
        lines.push('');
        lines.push(renderIRIConstant(cls.iri, cls.name));
        lines.push('');
    }

    for (const prop of ontology.properties.values()) {
        lines.push(renderIRIConstant(prop.iri, prop.name));
    }

    return lines.join('\n');
}
