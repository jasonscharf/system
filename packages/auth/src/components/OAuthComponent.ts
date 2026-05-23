import { randomBytes } from "node:crypto";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";
import type { IOAuthProvider } from "../oauth/types.js";
import type { OAuthProvider } from "../types.js";

export interface OAuthInitRequest {
    provider: OAuthProvider;
    redirectUri: string;
    /** Caller-supplied correlation id — echoed back in the result. */
    requestId?: string;
}

export interface OAuthInitResult {
    authUrl: string;
    state: string;
    provider: OAuthProvider;
    requestId?: string;
}

export interface OAuthComponentOptions extends FlowComponentOptions {
    providers: IOAuthProvider[];
}

/**
 * Pure FBP component that converts an OAuth init request into a provider
 * redirect URL.  No I/O — fully synchronous and side-effect free.
 */
export class OAuthComponent extends FlowComponent {
    readonly initIn: FlowPort<OAuthInitRequest>;
    readonly redirectOut: FlowPort<OAuthInitResult>;

    private readonly _providers: Map<OAuthProvider, IOAuthProvider>;

    constructor(options: OAuthComponentOptions) {
        super(options);
        this.initIn = this.addPort<OAuthInitRequest>("initIn", "in");
        this.redirectOut = this.addPort<OAuthInitResult>("redirectOut", "out");
        this._providers = new Map(options.providers.map((p) => [p.name, p]));
    }

    override step(): void {
        let req: OAuthInitRequest | undefined;
        while ((req = this.initIn.read()) !== undefined) {
            const provider = this._providers.get(req.provider);
            if (!provider) {
                continue;
            }

            const state = randomBytes(16).toString("hex");
            const authUrl = provider.getAuthUrl(req.redirectUri, state);

            this.redirectOut.put({
                authUrl,
                state,
                provider: req.provider,
                requestId: req.requestId,
            });
        }
    }
}
