import type { ValidationViolation } from '@system/gen';


export class EntityValidationError extends Error {
    readonly violations: ValidationViolation[];

    constructor(violations: ValidationViolation[]) {
        const summary = violations.map(v => `  • ${v.property}: ${v.message}`).join('\n');
        super(`Entity validation failed:\n${summary}`);
        this.name = 'EntityValidationError';
        this.violations = violations;
    }
}
