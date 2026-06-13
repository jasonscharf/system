import { EntitySchema } from "@jasonscharf/entities";
import {
    CONVOS_NS,
    isDismissedIRI,
    isReadIRI,
    NotificationClassIRI,
    notifTypeIRI,
    notifUserIRI,
    payloadIRI,
    sourceIriIRI,
    templateKeyIRI,
} from "../constants.js";

export const NotificationSchema = new EntitySchema({
    typeIRI: NotificationClassIRI,
    ns: CONVOS_NS,
    properties: {
        notifUser: notifUserIRI,
        notifType: notifTypeIRI,
        sourceIri: sourceIriIRI,
        templateKey: templateKeyIRI,
        payload: payloadIRI,
        isRead: isReadIRI,
        isDismissed: isDismissedIRI,
    },
    defaults: {
        isRead: false,
        isDismissed: false,
    },
});
