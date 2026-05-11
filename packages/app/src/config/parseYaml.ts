/**
 * Minimal YAML subset parser — the same approach used in FlowLoader but
 * extracted here so config loading does not depend on the flow package.
 *
 * Supports: scalars, mappings, sequences, nested structures, comments.
 * Does NOT support: anchors, aliases, multi-line scalars, block scalars.
 */

type YamlScalar = string | number | boolean | null;
interface YamlObject { [key: string]: YamlValue }
interface YamlArray extends Array<YamlValue> {}
export type YamlValue = YamlScalar | YamlObject | YamlArray;

function parseScalar(raw: string): YamlValue {
    const t = raw.trim();
    if (t === 'true')             { return true; }
    if (t === 'false')            { return false; }
    if (t === 'null' || t === '~' || t === '') { return null; }
    if (t === '[]')               { return []; }
    if (t === '{}')               { return {}; }
    if (/^-?\d+$/.test(t))       { return Number(t); }
    if (/^-?\d*\.\d+$/.test(t))  { return Number(t); }
    if ((t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}

interface ParsedLine { indent: number; raw: string; }

function stripComments(text: string): ParsedLine[] {
    return text
        .split('\n')
        .map(line => line.replace(/(^|\s)#.*$/, '').trimEnd())
        .map(line => ({ indent: line.length - line.trimStart().length, raw: line }))
        .filter(l => l.raw.trim() !== '');
}

function parseBlock(lines: ParsedLine[], start: number, baseIndent: number): { value: YamlValue; next: number } {
    if (start >= lines.length) { return { value: null, next: start }; }
    const first = lines[start];

    // Sequence
    if (first.raw.trimStart().startsWith('- ') || first.raw.trimStart() === '-') {
        const arr: YamlArray = [];
        let i = start;
        while (i < lines.length && lines[i].indent === baseIndent &&
               (lines[i].raw.trimStart().startsWith('- ') || lines[i].raw.trimStart() === '-')) {
            const itemContent = lines[i].raw.trimStart().slice(2).trimStart();
            if (itemContent === '') {
                const childIndent = i + 1 < lines.length ? lines[i + 1].indent : baseIndent + 2;
                const { value, next } = parseBlock(lines, i + 1, childIndent);
                arr.push(value);
                i = next;
            } else if (itemContent.includes(': ') || itemContent.endsWith(':')) {
                const childIndent = lines[i].indent + 2;
                const synth: ParsedLine[] = [{ indent: childIndent, raw: ' '.repeat(childIndent) + itemContent }];
                let j = i + 1;
                while (j < lines.length && lines[j].indent >= childIndent) { synth.push(lines[j]); j++; }
                arr.push(parseBlock(synth, 0, childIndent).value);
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
            if (colonIdx === -1) { break; }
            const key = line.slice(0, colonIdx).trim();
            const afterColon = line.slice(colonIdx + 1).trimStart();
            if (afterColon === '') {
                if (i + 1 < lines.length && lines[i + 1].indent > baseIndent) {
                    const childIndent = lines[i + 1].indent;
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

export function parseYaml(text: string): YamlValue {
    const lines = stripComments(text);
    if (lines.length === 0) { return null; }
    return parseBlock(lines, 0, lines[0].indent).value;
}
