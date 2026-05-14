export interface ISecretsProvider {
    /**
     * Retrieve a secret by key.  Returns null when the key does not exist in
     * this provider.  Throws on transient / auth errors so callers can decide
     * whether to retry or fall back.
     */
    get(key: string): Promise<string | null>;

    /**
     * Like get() but throws a descriptive error when the secret is absent.
     * Use this for secrets that are truly required at startup.
     */
    getRequired(key: string): Promise<string>;

    /** Called on graceful shutdown — release connections, clear cached state. */
    close?(): Promise<void>;
}
