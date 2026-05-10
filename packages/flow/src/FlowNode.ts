import type { IRI } from '@system/core';
import type { ID } from './types.js';


export interface FlowNode {
    readonly id: ID;
    readonly iri?: IRI;
}
