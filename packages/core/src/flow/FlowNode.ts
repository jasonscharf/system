import { IRI } from "../semantics/IRI.js";
import { ID } from "../types.js";


/**
 * Represent a node in a Flow graph, including low level, non-executable data nodes.
 */
export interface FlowNode {
    id: ID;
    iri?: IRI;
}
