import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_NS,
    InboxClassIRI,
    inboxCreatedByIRI,
    inboxNameIRI,
    subjectIriIRI,
} from "../constants.js";

export const InboxSchema = new EntitySchema({
    typeIRI: InboxClassIRI,
    ns: CONVOS_NS,
    properties: {
        subjectIri: subjectIriIRI,
        name: inboxNameIRI,
        createdBy: inboxCreatedByIRI,
    },
});
