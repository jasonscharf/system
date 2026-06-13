import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_NS,
    contentIRI,
    editedAtIRI,
    editedByIRI,
    MessageRevisionClassIRI,
    messageRefIRI,
    revisionIRI,
} from "../constants.js";

export const MessageRevisionSchema = new EntitySchema({
    typeIRI: MessageRevisionClassIRI,
    ns: CONVOS_NS,
    // Stored IRI segment is "revision", not the lowercased "messagerevision".
    idSegment: "revision",
    properties: {
        messageRef: messageRefIRI,
        content: contentIRI,
        revision: revisionIRI,
        editedBy: editedByIRI,
        editedAt: editedAtIRI,
    },
});
