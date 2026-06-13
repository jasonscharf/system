import { EntitySchema } from "@jasonscharf/entities";
import {
    authorIRI,
    CONVOS_GRAPH,
    CONVOS_NS,
    contentIRI,
    contentTypeIRI,
    conversationRefIRI,
    DraftClassIRI,
    replyToIRI,
} from "../constants.js";

export const DraftSchema = new EntitySchema({
    typeIRI: DraftClassIRI,
    ns: CONVOS_NS,
    graphIri: CONVOS_GRAPH,
    properties: {
        conversation: conversationRefIRI,
        author: authorIRI,
        replyTo: replyToIRI,
        content: contentIRI,
        contentType: contentTypeIRI,
    },
});
