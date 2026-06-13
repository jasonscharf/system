import { EntitySchema } from "@jasonscharf/entities";
import {
    assignedToIRI,
    CONVOS_GRAPH,
    CONVOS_NS,
    ConversationClassIRI,
    convoCreatedByIRI,
    convoInboxIRI,
    statusIRI,
    subjectIriIRI,
    titleIRI,
} from "../constants.js";

export const ConversationSchema = new EntitySchema({
    typeIRI: ConversationClassIRI,
    ns: CONVOS_NS,
    graphIri: CONVOS_GRAPH,
    properties: {
        subjectIri: subjectIriIRI,
        title: titleIRI,
        status: statusIRI,
        // Relationship pointers are stored as the target's IRI string, matching
        // how auth models sessionUser/identityOf — equality lookups go through the
        // literal path, so reads and writes stay consistent.
        inbox: convoInboxIRI,
        assignedTo: assignedToIRI,
        createdBy: convoCreatedByIRI,
    },
});
