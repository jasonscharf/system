import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_NS,
    grantedAtIRI,
    InboxMembershipClassIRI,
    memberInboxIRI,
    memberUserIRI,
    roleIRI,
} from "../constants.js";

export const InboxMembershipSchema = new EntitySchema({
    typeIRI: InboxMembershipClassIRI,
    ns: CONVOS_NS,
    // Stored IRI segment is "membership", not the lowercased "inboxmembership".
    idSegment: "membership",
    properties: {
        memberInbox: memberInboxIRI,
        memberUser: memberUserIRI,
        role: roleIRI,
        grantedAt: grantedAtIRI,
    },
});
