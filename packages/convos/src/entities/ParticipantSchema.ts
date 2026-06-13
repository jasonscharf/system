import { EntitySchema } from "@jasonscharf/entities";
import {
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
    properties: {
        conversation: conversationRefIRI,
        participantUser: participantUserIRI,
        role: roleIRI,
        joinedAt: joinedAtIRI,
    },
});
