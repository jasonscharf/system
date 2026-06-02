import { errResult } from "@jasonscharf/core";
import type { PayloadSchemaRegistry } from "../registry/PayloadSchemaRegistry.js";
import type { TernMiddlewareFn } from "./TernRouter.js";

/**
 * Middleware factory that validates TernRequest.payload against any SHACL
 * shape registered in the supplied PayloadSchemaRegistry.
 *
 * Mount this as global middleware on a TernRouter:
 *
 *   const reg = new PayloadSchemaRegistry();
 *   reg.register(CREATE_USER, UserShape, userPropertyMap);
 *
 *   router.use(payloadValidation(reg));
 *   router.handle(CREATE_USER, handleCreateUser);
 *
 * If no shape is registered for the request type the middleware is a no-op.
 * If validation fails the middleware sets ctx.result to an error result and
 * does not call next(), short-circuiting the handler chain.
 */
export function payloadValidation(registry: PayloadSchemaRegistry): TernMiddlewareFn {
    return async (ctx, next) => {
        const typeIri = ctx.request.type.iri;

        if (!registry.hasShape(typeIri)) {
            await next();
            return;
        }

        const payload = ctx.request.payload;

        if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
            ctx.result = errResult(
                ctx.request.id,
                ctx.request.type,
                `Payload validation failed: payload must be an object for "${typeIri}".`,
            );
            return;
        }

        const result = registry.validate(typeIri, payload as Record<string, unknown>);

        if (result && !result.valid) {
            const summary = result.violations.map((v) => v.message).join("; ");
            ctx.result = errResult(
                ctx.request.id,
                ctx.request.type,
                `Payload validation failed: ${summary}`,
            );
            return;
        }

        await next();
    };
}
