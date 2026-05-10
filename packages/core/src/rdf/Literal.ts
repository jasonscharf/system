import type { IRI } from '../semantics/IRI.js';


export interface Literal {
    readonly termType: 'Literal';
    readonly value: string;
    readonly datatype: IRI;
    readonly language?: string;
}

export function literal(value: string, datatype: IRI, language?: string): Literal {
    return { termType: 'Literal', value, datatype, language };
}
