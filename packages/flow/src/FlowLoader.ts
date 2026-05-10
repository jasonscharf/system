import { FlowApp } from './FlowApp.js';
import type { FlowComponent } from './FlowComponent.js';
import type { FlowComponentOptions } from './FlowComponent.js';
import type { ScheduleMode } from './types.js';


// ── Schema ────────────────────────────────────────────────────────────────────

export interface FlowProgramSpec {
    name?: string;
    version?: string;
    mode?: ScheduleMode;
    components: ComponentSpec[];
    connections: ConnectionSpec[];
}

export interface ComponentSpec {
    id: string;
    name?: string;
    type: string;
    config?: Record<string, unknown>;
}

export interface ConnectionSpec {
    from: string;  // "componentId.portName"
    to: string;    // "componentId.portName"
}

export type ModuleResolver = (uri: string) => Promise<{
    default: new (options: FlowComponentOptions) => FlowComponent;
}>;

export interface LoadOptions {
    /** Override the default dynamic import() resolver for component types. */
    moduleResolver?: ModuleResolver;
    /** Base URL for resolving relative module URIs. */
    baseUrl?: string;
}


// ── Minimal YAML subset parser ────────────────────────────────────────────────

type YamlScalar = string | number | boolean | null;
interface YamlObject { [key: string]: YamlValue }
interface YamlArray extends Array<YamlValue> {}
type YamlValue = YamlScalar | YamlObject | YamlArray;

function parseScalar(raw: string): YamlValue {
    const t = raw.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null' || t === '~' || t === '') return null;
    if (t === '[]') return [];
    if (t === '{}') return {};
    if (/^-?\d+$/.test(t)) return Number(t);
    if (/^-?\d*\.\d+$/.test(t)) return Number(t);
    if ((t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}

interface ParsedLine {
    indent: number;
    raw: string;
}

function stripComments(text: string): ParsedLine[] {
    return text
        .split('\n')
        .map(line => line.replace(/(^|\s)#.*$/, '').trimEnd())
        .map(line => ({ indent: line.length - line.trimStart().length, raw: line }))
        .filter(l => l.raw.trim() !== '');
}

function parseBlock(lines: ParsedLine[], start: number, baseIndent: number): { value: YamlValue; next: number } {
    if (start >= lines.length) return { value: null, next: start };

    const first = lines[start];

    // Sequence (list)
    if (first.raw.trimStart().startsWith('- ') || first.raw.trimStart() === '-') {
        const arr: YamlArray = [];
        let i = start;
        while (i < lines.length && lines[i].indent === baseIndent &&
               (lines[i].raw.trimStart().startsWith('- ') || lines[i].raw.trimStart() === '-')) {
            const itemContent = lines[i].raw.trimStart().slice(2).trimStart();
            if (itemContent === '') {
                // Multi-line item — parse the indented block below
                const childIndent = i + 1 < lines.length ? lines[i + 1].indent : baseIndent + 2;
                const { value, next } = parseBlock(lines, i + 1, childIndent);
                arr.push(value);
                i = next;
            } else if (itemContent.includes(': ') || itemContent.endsWith(':')) {
                // Inline mapping-start on the dash line + possibly more keys below
                const childIndent = lines[i].indent + 2;
                const syntheticLines: ParsedLine[] = [
                    { indent: childIndent, raw: ' '.repeat(childIndent) + itemContent },
                ];
                let j = i + 1;
                while (j < lines.length && lines[j].indent >= childIndent) {
                    syntheticLines.push(lines[j]);
                    j++;
                }
                const { value } = parseBlock(syntheticLines, 0, childIndent);
                arr.push(value);
                i = j;
            } else {
                arr.push(parseScalar(itemContent));
                i++;
            }
        }
        return { value: arr, next: i };
    }

    // Mapping
    if (first.raw.includes(': ') || first.raw.trimStart().endsWith(':')) {
        const obj: YamlObject = {};
        let i = start;
        while (i < lines.length && lines[i].indent === baseIndent) {
            const line = lines[i].raw.trimStart();
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) break;
            const key = line.slice(0, colonIdx).trim();
            const afterColon = line.slice(colonIdx + 1).trimStart();
            if (afterColon === '' || afterColon === undefined) {
                // Value is on next indented lines
                const childIndent = i + 1 < lines.length ? lines[i + 1].indent : baseIndent + 2;
                if (i + 1 < lines.length && lines[i + 1].indent > baseIndent) {
                    const { value, next } = parseBlock(lines, i + 1, childIndent);
                    obj[key] = value;
                    i = next;
                } else {
                    obj[key] = null;
                    i++;
                }
            } else {
                obj[key] = parseScalar(afterColon);
                i++;
            }
        }
        return { value: obj, next: i };
    }

    return { value: parseScalar(first.raw.trim()), next: start + 1 };
}

function parseYaml(text: string): YamlValue {
    const lines = stripComments(text);
    if (lines.length === 0) return null;
    const baseIndent = lines[0].indent;
    return parseBlock(lines, 0, baseIndent).value;
}


// ── Default module resolver ───────────────────────────────────────────────────

const defaultModuleResolver: ModuleResolver = async (uri) => {
    // Lazily import the module at the given URI
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return import(/* @vite-ignore */ uri) as any;
};


// ── FlowLoader ────────────────────────────────────────────────────────────────

export class FlowLoader {
    static async fromJSON(json: string, options: LoadOptions = {}): Promise<FlowApp> {
        const spec = JSON.parse(json) as FlowProgramSpec;
        return FlowLoader._build(spec, options);
    }

    static async fromYAML(yaml: string, options: LoadOptions = {}): Promise<FlowApp> {
        const parsed = parseYaml(yaml);
        return FlowLoader._build(parsed as unknown as FlowProgramSpec, options);
    }

    static async fromRDF(_rdf: string, _options: LoadOptions = {}): Promise<FlowApp> {
        // RDF loading is handled via @system/core's hydration pipeline.
        // This stub reserves the API surface; a full implementation would
        // parse Turtle/N-Quads and reconstruct the FlowProgramSpec from the
        // flow: ontology quads.
        throw new Error('RDF loading not yet implemented — use fromJSON or fromYAML');
    }

    private static async _build(spec: FlowProgramSpec, options: LoadOptions): Promise<FlowApp> {
        const resolver = options.moduleResolver ?? defaultModuleResolver;
        const app = new FlowApp({ mode: spec.mode ?? 'push' });

        const componentMap = new Map<string, FlowComponent>();

        for (const cSpec of spec.components ?? []) {
            const mod = await resolver(cSpec.type);
            const Cls = mod.default;
            const component = new Cls({
                name: cSpec.name ?? cSpec.id,
                context: app.context,
            });
            componentMap.set(cSpec.id, component);
            app.addComponent(component);
        }

        for (const conn of spec.connections ?? []) {
            const [fromId, fromPort] = conn.from.split('.');
            const [toId, toPort] = conn.to.split('.');
            const fromComp = componentMap.get(fromId);
            const toComp = componentMap.get(toId);
            if (!fromComp || !toComp) {
                throw new Error(`Unknown component in connection: ${conn.from} → ${conn.to}`);
            }
            const outPort = fromComp.ports.get(fromPort);
            const inPort = toComp.ports.get(toPort);
            if (!outPort || !inPort) {
                throw new Error(`Unknown port in connection: ${conn.from} → ${conn.to}`);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            app.connect(outPort as any, inPort as any);
        }

        return app;
    }
}
