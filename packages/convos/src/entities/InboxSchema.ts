import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_GRAPH,
    CONVOS_NS,
    InboxClassIRI,
    inboxCreatedByIRI,
    inboxNameIRI,
    subjectIriIRI,
} from "../constants.js";

export const InboxSchema = new EntitySchema({
    typeIRI: InboxClassIRI,
    ns: CONVOS_NS,
    graphIri: CONVOS_GRAPH,
    properties: {
        subjectIri: subjectIriIRI,
        name: inboxNameIRI,
        createdBy: inboxCreatedByIRI,
    },
});
