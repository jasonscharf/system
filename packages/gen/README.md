# @jasonscharf/gen

Code-generation tool for the Tern platform. Converts OWL ontologies and SHACL shapes into TypeScript type definitions and runtime validation descriptors.

## CLI

```bash
# Generate types from a config file (recommended)
tern-codegen --config tern-gen.json

# Generate types from a single ontology file
tern-codegen path/to/ontology.ttl
```

## tern-gen.json

Place a `tern-gen.json` in your package root to describe what to generate:

```json
{
    "bases": [
        {
            "ontology":   "@jasonscharf/core/ontology/auth.ttl",
            "package":    "@jasonscharf/core",
            "importPath": "@jasonscharf/core"
        }
    ],
    "extensions":     ["./ontology/my-extension.ttl"],
    "shapes":         ["./ontology/my-extension.shacl.ttl"],
    "localNamespace": "http://example.com/ns/my-extension/",
    "out":            "./src/my-extension/types.generated.ts",
    "shapesOut":      "./src/my-extension/shapes.generated.ts"
}
```

| Field | Description |
|---|---|
| `bases` | Base ontologies to merge (classes/properties already defined upstream) |
| `extensions` | New ontology files defining classes and properties in this package |
| `shapes` | SHACL shape files (validation constraints, optional) |
| `localNamespace` | IRI namespace for locally-defined classes |
| `out` | Output path for TypeScript types |
| `shapesOut` | Output path for runtime shape descriptors |

## What Gets Generated

### types.generated.ts

- A TypeScript interface for every class declared in `extensions`
- **IRI constants** for every class and property — `nameIRI`, `priceIRI`, etc. These are the only way properties are referenced in application code; never construct IRI strings by hand.
- Property types inferred from SHACL `sh:datatype` / `sh:class` constraints

### shapes.generated.ts

Runtime `ShaclNodeShape` objects indexed by target class IRI, used by `EntityStore` for write-time SHACL validation:

```typescript
import { shapes } from './my-extension/shapes.generated.js';

const shape = shapes.byTargetClass.get('http://example.com/ns/my-extension/Widget');
// → ShaclNodeShape | undefined
```

## Programmatic API

```typescript
import { generate, generateFromConfig, OntologyReader, ShaclReader, ShaclValidator } from '@jasonscharf/gen';

// Full pipeline from config
await generateFromConfig('./tern-gen.json');

// Low-level: parse and read ontology
const triples  = parseTurtle(fs.readFileSync('ontology.ttl', 'utf8'));
const ontology = OntologyReader.readOntology(triples);

// Validate data against a shape at runtime
const result = ShaclValidator.validate(data, shape, propertyMap);
if (!result.valid) {
    for (const v of result.violations ?? []) {
        console.error(v.property, v.message);
    }
}
```

## Writing an Ontology

1. Create `ontology/my-extension.ttl`:

```turtle
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:   <http://example.com/ns/my-extension/> .

ex:Widget a owl:Class ;
    rdfs:label "Widget" .

ex:widgetName a owl:DatatypeProperty ;
    rdfs:domain ex:Widget ;
    rdfs:range  xsd:string ;
    rdfs:label  "widgetName" .
```

2. Create `ontology/my-extension.shacl.ttl` (optional but recommended):

```turtle
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:  <http://example.com/ns/my-extension/> .

ex:WidgetShape a sh:NodeShape ;
    sh:targetClass ex:Widget ;
    sh:property [
        sh:path     ex:widgetName ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
    ] .
```

3. Run `yarn codegen` to emit `types.generated.ts` and `shapes.generated.ts`.

## Installation

```bash
yarn add @jasonscharf/gen
```

The CLI binaries `tern-codegen` and `tern-gen` are installed automatically.

Published to GitHub Packages (`https://npm.pkg.github.com`).
