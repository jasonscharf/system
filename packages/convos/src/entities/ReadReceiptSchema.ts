import { EntitySchema } from "@jasonscharf/entities";
import {
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
    // Stored IRI segment is "receipt", not the lowercased "readreceipt".
    idSegment: "receipt",
    properties: {
        receiptConversation: receiptConversationIRI,
        receiptUser: receiptUserIRI,
        lastReadMessage: lastReadMessageIRI,
        lastReadAt: lastReadAtIRI,
    },
});
