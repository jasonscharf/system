import type { IRI } from "@jasonscharf/core";
import type { ID } from "./types.js";

export interface FlowNode {
    readonly id: ID;
    readonly iri?: IRI;
}
