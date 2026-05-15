import type { ShaclNodeShape, ShaclPropertyShape } from '@system/gen';


export interface ValidationViolation {
    /** TypeScript property name (or RDF IRI path if not in the property map). */
    property: string;
    /** The value that failed validation (may be undefined for missing required fields). */
    value: unknown;
    /** Human-readable description of the constraint that was violated. */
    message: string;
    severity: 'violation' | 'warning';
}

export interface ValidationResult {
    valid: boolean;
    violations: ValidationViolation[];
}

/**
 * Validates a typed entity object against a SHACL NodeShape.
 *
 * @param entity      Plain TypeScript object (e.g. a User or Project).
 * @param shape       The ShaclNodeShape to validate against.
 * @param propertyMap Maps TypeScript property names → RDF IRI paths so the
 *                    validator can match object keys to shape path constraints.
 *
 * Supported constraints (per SHACL 1.0):
 *   sh:minCount  — property must be present (count >= minCount)
 *   sh:maxCount  — property must not exceed this many values
 *   sh:pattern   — string values must match the regex
 *   sh:datatype  — coarse datatype check (string/boolean/number/Date)
 */
export function validate(
    entity: Record<string, unknown>,
    shape: ShaclNodeShape,
    propertyMap: Record<string, string>,
): ValidationResult {
    const violations: ValidationViolation[] = [];

    // Invert the map so we can resolve IRI path → property name for messages
    const iriToName = Object.fromEntries(
        Object.entries(propertyMap).map(([name, iri]) => [iri, name]),
    );

    for (const propShape of shape.properties) {
        const propName = iriToName[propShape.path] ?? propShape.path;
        const raw      = entity[propName];
        const values   = Array.isArray(raw) ? raw : (raw !== undefined ? [raw] : []);
        const count    = values.length;

        // sh:minCount
        if ((propShape.minCount ?? 0) > 0 && count < propShape.minCount!) {
            violations.push({
                property: propName,
                value:    raw,
                message:  propShape.message ?? `${propName} is required (minCount ${propShape.minCount}).`,
                severity: 'violation',
            });
        }

        // sh:maxCount
        if (propShape.maxCount !== undefined && count > propShape.maxCount) {
            violations.push({
                property: propName,
                value:    raw,
                message:  `${propName} must have at most ${propShape.maxCount} value(s) (got ${count}).`,
                severity: 'violation',
            });
        }

        if (count === 0) { continue; }

        for (const v of values) {
            // sh:pattern (strings only)
            if (propShape.pattern && typeof v === 'string') {
                if (!new RegExp(propShape.pattern).test(v)) {
                    violations.push({
                        property: propName,
                        value:    v,
                        message:  propShape.message ?? `${propName} does not match pattern ${propShape.pattern}.`,
                        severity: 'violation',
                    });
                }
            }

            // sh:datatype — lightweight coercion check
            if (propShape.datatype) {
                const violation = checkDatatype(propName, v, propShape);
                if (violation) { violations.push(violation); }
            }
        }
    }

    return { valid: violations.length === 0, violations };
}

function checkDatatype(
    propName: string,
    value: unknown,
    ps: ShaclPropertyShape,
): ValidationViolation | null {
    const xsd = 'http://www.w3.org/2001/XMLSchema#';
    const dt   = ps.datatype!;

    let ok = true;
    if (dt === `${xsd}string`)   { ok = typeof value === 'string'; }
    if (dt === `${xsd}boolean`)  { ok = typeof value === 'boolean'; }
    if (dt === `${xsd}integer` || dt === `${xsd}decimal` || dt === `${xsd}float` || dt === `${xsd}double`) {
        ok = typeof value === 'number';
    }
    if (dt === `${xsd}dateTime` || dt === `${xsd}date`) {
        ok = value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)));
    }

    if (!ok) {
        return {
            property: propName,
            value,
            message:  ps.message ?? `${propName} has wrong datatype (expected ${dt.replace(xsd, 'xsd:')}).`,
            severity: 'violation',
        };
    }

    return null;
}
