/**
 * An opaque, JSON-serializable principal resolved at WebSocket upgrade time.
 *
 * The flow package never interprets the contents — it only carries them. Hosts
 * supply a concrete shape (for example the result of auth's validateToken).
 * Because principals are stamped onto the connection map and may be read by
 * downstream components, every field MUST survive a JSON round-trip: no classes,
 * tuples, functions, or other non-serializable constructs.
 */
export type WsPrincipal = {
    readonly [key: string]: unknown;
};

/**
 * Connection metadata captured at upgrade and held in the server's connection
 * map. Components reading the `received` port can resolve a connectionId to this
 * record (and thus to its principal) via WebSocketServer.getConnection().
 *
 * This shape is JSON-serializable so it can ride alongside WsMessage if a host
 * chooses to forward it across a transport.
 */
export interface WsConnection {
    /** Server-assigned connection identifier (matches WsMessage.connectionId). */
    readonly connectionId: string;
    /**
     * The principal resolved by WebSocketServerOptions.authenticate, or null
     * when no authenticate callback was configured (open server).
     */
    readonly principal: WsPrincipal | null;
    /** The Origin header presented at upgrade, or null when absent. */
    readonly origin: string | null;
    /** The remote address of the client, or null when unavailable. */
    readonly remoteAddress: string | null;
}
