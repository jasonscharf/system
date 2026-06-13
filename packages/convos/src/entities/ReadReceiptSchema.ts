import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_GRAPH,
    CONVOS_NS,
    lastReadAtIRI,
    lastReadMessageIRI,
    ReadReceiptClassIRI,
    receiptConversationIRI,
    receiptUserIRI,
} from "../constants.js";

export const ReadReceiptSchema = new EntitySchema({
    typeIRI: ReadReceiptClassIRI,
    ns: CONVOS_NS,
    graphIri: CONVOS_GRAPH,
    // Stored IRI segment is "receipt", not the lowercased "readreceipt".
    idSegment: "receipt",
    properties: {
        receiptConversation: receiptConversationIRI,
        receiptUser: receiptUserIRI,
        lastReadMessage: lastReadMessageIRI,
        lastReadAt: lastReadAtIRI,
    },
});
