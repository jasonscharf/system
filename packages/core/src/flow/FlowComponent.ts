import { IRI } from "../semantics/IRI.js";
import { ID } from "../types.js";
import { randomUInt8Array, uuidv4Binary } from "../util/random.js";
import { FlowNode } from "./FlowNode.js";


/**
 * A component is an executable member of an application graph.
 * Components send and receive messages between themselves using ports.
 * 
 * Components do not interact directly with other components unless they manage them in their own
 * hierarchy.
 * 
 * For example, network server components may have encoder/decoder children that are interacted with.
 * However, nothing adjacent in the graph is interacted with.
 * 
 * In this regard, components are considered to be "black box" and loosely coupled by design.
 */
export class FlowComponent<TConfigType extends FlowComponentConfig = {}> implements FlowNode {
    readonly id: ID;
    readonly iri?: IRI;
    readonly name: string;
    private readonly _config: TConfigType;

    constructor(config: FlowComponentConfig) {
        const { id, name } = config;
        this.id = id || uuidv4Binary();
        this.name = name || "";

        this._config = Object.assign({}, DEFAULT_FLOW_COMPONENT_CONFIG) as TConfigType;
    }
}

export interface FlowComponentConfig {
    id?: ID;
    name?: string;
}

export const DEFAULT_FLOW_COMPONENT_CONFIG: FlowComponentConfig = {
}
