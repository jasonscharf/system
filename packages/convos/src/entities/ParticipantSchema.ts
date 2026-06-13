import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_GRAPH,
    CONVOS_NS,
    conversationRefIRI,
    joinedAtIRI,
    ParticipantClassIRI,
    participantUserIRI,
    roleIRI,
} from "../constants.js";

export const ParticipantSchema = new EntitySchema({
    typeIRI: ParticipantClassIRI,
    ns: CONVOS_NS,
    graphIri: CONVOS_GRAPH,
    properties: {
        conversation: conversationRefIRI,
        participantUser: participantUserIRI,
        role: roleIRI,
        joinedAt: joinedAtIRI,
    },
});
