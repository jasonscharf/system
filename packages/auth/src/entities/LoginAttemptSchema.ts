import {
    attemptUserIRI,
    authRedirectUrlIRI,
    claimIRI,
    errorCodeIRI,
    ipAddressIRI,
    LoginAttemptIRI,
    nonceIRI,
    providerIRI,
    statusIRI,
    userAgentIRI,
    utmCampaignIRI,
    utmMediumIRI,
    utmSourceIRI,
} from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_GRAPH, AUTH_NS } from "../constants.js";

export const LoginAttemptSchema = new EntitySchema({
    typeIRI: LoginAttemptIRI,
    ns: AUTH_NS,
    graphIri: AUTH_GRAPH,
    properties: {
        provider: providerIRI,
        status: statusIRI,
        nonce: nonceIRI,
        errorCode: errorCodeIRI,
        ipAddress: ipAddressIRI,
        userAgent: userAgentIRI,
        claim: claimIRI,
        utmSource: utmSourceIRI,
        utmMedium: utmMediumIRI,
        utmCampaign: utmCampaignIRI,
        authRedirectUrl: authRedirectUrlIRI,
        attemptUser: attemptUserIRI,
    },
    defaults: {
        status: "pending",
    },
});
