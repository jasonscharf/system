import { EntitySchema } from "@jasonscharf/entities";
import {
    authorIRI,
    CONVOS_NS,
    contentIRI,
    contentTypeIRI,
    conversationRefIRI,
    isDeletedIRI,
    MessageClassIRI,
    replyToIRI,
    revisionCountIRI,
} from "../constants.js";

export const MessageSchema = new EntitySchema({
    typeIRI: MessageClassIRI,
    ns: CONVOS_NS,
    properties: {
        conversation: conversationRefIRI,
        replyTo: replyToIRI,
        author: authorIRI,
        content: contentIRI,
        contentType: contentTypeIRI,
        isDeleted: isDeletedIRI,
        revisionCount: revisionCountIRI,
    },
    defaults: {
        isDeleted: false,
        revisionCount: 0,
    },
});
