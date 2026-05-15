import type { ShaclShapes, ShaclNodeShape } from './ShaclReader.js';


function renderNodeShape(shape: ShaclNodeShape): string {
    const props = shape.properties.map(ps => {
        const pairs: string[] = [
            `path: ${JSON.stringify(ps.path)}`,
        ];
        if (ps.minCount  !== undefined) { pairs.push(`minCount: ${ps.minCount}`); }
        if (ps.maxCount  !== undefined) { pairs.push(`maxCount: ${ps.maxCount}`); }
        if (ps.datatype)                { pairs.push(`datatype: ${JSON.stringify(ps.datatype)}`); }
        if (ps.classConstraint)         { pairs.push(`classConstraint: ${JSON.stringify(ps.classConstraint)}`); }
        if (ps.pattern)                 { pairs.push(`pattern: ${JSON.stringify(ps.pattern)}`); }
        if (ps.message)                 { pairs.push(`message: ${JSON.stringify(ps.message)}`); }
        return `            { ${pairs.join(', ')} },`;
    }).join('\n');

    return [
        `        {`,
        `            iri:         ${JSON.stringify(shape.iri)},`,
        `            targetClass: ${JSON.stringify(shape.targetClass)},`,
        `            closed:      ${shape.closed ?? false},`,
        `            properties: [`,
        props,
        `            ],`,
        `        }`,
    ].join('\n');
}

/**
 * Generates a TypeScript module containing the SHACL shapes as runtime data.
 * The shapes can be imported and passed to ShaclValidator.validate().
 *
 * Also emits a propertyMap for each shape — mapping TypeScript property names
 * to their RDF IRI paths — so the validator can match typed objects to shapes.
 */
export function generateShapesDescriptor(shapes: ShaclShapes): string {
    const shapeList = [...shapes.nodeShapes.values()];

    const shapeEntries = shapeList.map(shape =>
        `    [${JSON.stringify(shape.iri)},\n${renderNodeShape(shape)},\n    ]`
    ).join(',\n');

    const lines: string[] = [
        `// auto-generated shapes descriptor — do not edit by hand`,
        `import type { ShaclShapes, ShaclNodeShape } from '@system/gen';`,
        ``,
        `const list: ShaclNodeShape[] = [`,
        ...shapeList.map(shape => renderNodeShape(shape) + ','),
        `];`,
        ``,
        `export const shapes: ShaclShapes = {`,
        `    nodeShapes:    new Map(list.map(s => [s.iri, s])),`,
        `    byTargetClass: new Map(list.map(s => [s.targetClass, s])),`,
        `};`,
    ];

    return lines.join('\n') + '\n';
}
