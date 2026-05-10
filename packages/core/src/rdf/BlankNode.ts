export interface BlankNode {
    readonly termType: 'BlankNode';
    readonly id: string;
}

export function blankNode(id: string): BlankNode {
    return { termType: 'BlankNode', id };
}
