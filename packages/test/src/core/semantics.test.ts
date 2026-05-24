import { IRI, PrefixRegistry } from "@jasonscharf/core";

import { describe, expect, it } from "vitest";

describe("IRI", () => {
    const absoluteUri = "http://example.com";
    const absoluteIri = new IRI(absoluteUri);

    const relativeUri = "./foo";
    const relativeIri = new IRI(relativeUri);

    const urnUri = "urn:foo";
    const urnIri = new IRI(urnUri);

    describe("basics", () => {
        it("constructs from a valid URI", () => {
            expect(absoluteIri.toString()).to.eq(absoluteUri);
            expect(absoluteIri.toJSON()).to.eq(absoluteUri);
        });

        it("exposes value", () => {
            expect(absoluteIri.value).to.eq(absoluteUri);
        });

        it("recognizes relative URIs", () => {
            expect(absoluteIri.isAbsolute()).to.be.true;
            expect(relativeIri.isAbsolute()).to.be.false;
        });

        it("recognizes URNs", () => {
            expect(absoluteIri.isURN()).to.be.false;
            expect(relativeIri.isURN()).to.be.false;
            expect(urnIri.isURN()).to.be.true;
        });

        it("considers URNs absolute", () => {
            expect(urnIri.isAbsolute()).to.be.true;
        });

        it("returns urnParts for URN", () => {
            const iri = new IRI("urn:isbn:978-1476793313");
            expect(iri.urnParts).to.deep.eq({ nid: "isbn", nss: "978-1476793313" });
        });

        it("returns null urnParts for non-URN", () => {
            expect(absoluteIri.urnParts).to.be.null;
        });

        it("wraps value in angle brackets for RDF", () => {
            expect(absoluteIri.toRDF()).to.eq(`<${absoluteUri}>`);
        });

        it("checks equality", () => {
            expect(absoluteIri.equals(new IRI(absoluteUri))).to.be.true;
            expect(absoluteIri.equals(relativeIri)).to.be.false;
        });

        it("compacts to prefixed form", () => {
            const registry = new PrefixRegistry({ ex: "http://example.com/" });
            const iri = new IRI("http://example.com/Thing");
            expect(iri.toPrefixed(registry)).to.eq("ex:Thing");
        });

        it("returns null toPrefixed when no match", () => {
            const registry = new PrefixRegistry();
            expect(absoluteIri.toPrefixed(registry)).to.be.null;
        });
    });

    describe(IRI.from.name, () => {
        it("parses absolute URIs", () => {
            const iri = IRI.from(absoluteUri);
            expect(iri.isAbsolute()).to.be.true;
            expect(iri.toString()).to.eq(absoluteUri);
        });

        it("parses relative URIs", () => {
            const iri = IRI.from(relativeUri);
            expect(iri.isAbsolute()).to.be.false;
            expect(iri.toString()).to.eq(relativeUri);
        });

        it("parses URN URIs", () => {
            const iri = IRI.from(urnUri);
            expect(iri.isAbsolute()).to.be.true;
            expect(iri.toString()).to.eq(urnUri);
        });

        it("throws on empty", () => {
            expect(() => IRI.from("")).toThrow();
        });

        it("throws on whitespace", () => {
            expect(() => IRI.from("http://ex ample.com")).toThrow();
        });
    });

    describe(IRI.fromURN.name, () => {
        it("parses a valid URN", () => {
            const iri = IRI.fromURN("isbn", "978-1476793313");
            expect(iri.toString()).to.eq("urn:isbn:978-1476793313");
        });

        it("throws on whitespace NID", () => {
            expect(() => IRI.fromURN(" ", "1")).toThrow();
            expect(() => IRI.fromURN(null as unknown as string, "1")).toThrow();
            expect(() => IRI.fromURN(undefined as unknown as string, "1")).toThrow();
        });

        it("throws on whitespace leading/trailing NID", () => {
            expect(() => IRI.fromURN(" nid", "1")).toThrow();
            expect(() => IRI.fromURN("nid ", "1")).toThrow();
            expect(() => IRI.fromURN(" nid ", "1")).toThrow();
        });

        it("throws on whitespace in NID", () => {
            expect(() => IRI.fromURN("is bn", "978-1476793313")).toThrow();
        });

        it("throws on null NSS", () => {
            expect(() => IRI.fromURN("isbn", null as unknown as string)).toThrow();
        });

        it("throws on whitespace in NSS", () => {
            expect(() => IRI.fromURN("isbn", "has space")).toThrow();
        });
    });

    describe(IRI.fromPrefixed.name, () => {
        it("expands a prefixed name using a registry", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            const iri = IRI.fromPrefixed("ex:Thing", registry);
            expect(iri.toString()).to.eq("http://example.org/Thing");
        });
    });

    describe(IRI.resolve.name, () => {
        it("resolves a relative URL against a base string", () => {
            const result = IRI.resolve("foo", "http://example.com/");
            expect(result.toString()).to.eq("http://example.com/foo");
        });

        it("resolves IRI instances", () => {
            const result = IRI.resolve(new IRI("foo"), new IRI("http://example.com/"));
            expect(result.toString()).to.eq("http://example.com/foo");
        });

        it("returns a URN relative as-is", () => {
            const result = IRI.resolve("urn:isbn:978", "http://example.com/");
            expect(result.toString()).to.eq("urn:isbn:978");
        });

        it("throws on invalid URL combination", () => {
            expect(() => IRI.resolve("foo", "invalid-base")).toThrow();
        });
    });
});

describe("PrefixRegistry", () => {
    it("constructs empty with no arguments", () => {
        const registry = new PrefixRegistry();
        expect(registry.has("ex")).to.be.false;
    });

    it("constructs with initial prefixes", () => {
        const registry = new PrefixRegistry({ ex: "http://example.org/" });
        expect(registry.get("ex")).to.eq("http://example.org/");
    });

    describe("set", () => {
        it("sets a valid prefix", () => {
            const registry = new PrefixRegistry();
            registry.set("ex", "http://example.org/");
            expect(registry.get("ex")).to.eq("http://example.org/");
        });

        it("throws on invalid prefix", () => {
            const registry = new PrefixRegistry();
            expect(() => registry.set("1invalid", "http://example.org/")).toThrow();
        });

        it("throws on empty namespace", () => {
            const registry = new PrefixRegistry();
            expect(() => registry.set("ex", "")).toThrow();
        });

        it("throws on whitespace namespace", () => {
            const registry = new PrefixRegistry();
            expect(() => registry.set("ex", "http://has space/")).toThrow();
        });
    });

    describe("has / get / delete / clear", () => {
        it("has returns true for known prefix", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            expect(registry.has("ex")).to.be.true;
        });

        it("has returns false for unknown prefix", () => {
            const registry = new PrefixRegistry();
            expect(registry.has("unknown")).to.be.false;
        });

        it("get returns undefined for unknown prefix", () => {
            const registry = new PrefixRegistry();
            expect(registry.get("unknown")).to.be.undefined;
        });

        it("delete removes a prefix", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            registry.delete("ex");
            expect(registry.has("ex")).to.be.false;
        });

        it("clear removes all prefixes", () => {
            const registry = new PrefixRegistry({
                ex: "http://example.org/",
                foo: "http://foo.org/",
            });
            registry.clear();
            expect(registry.has("ex")).to.be.false;
            expect(registry.has("foo")).to.be.false;
        });
    });

    describe("expand", () => {
        it("expands a known prefixed name", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            expect(registry.expand("ex:Thing")).to.eq("http://example.org/Thing");
        });

        it("throws when no colon present", () => {
            const registry = new PrefixRegistry();
            expect(() => registry.expand("nocolon")).toThrow();
        });

        it("throws on unknown prefix", () => {
            const registry = new PrefixRegistry();
            expect(() => registry.expand("unknown:Thing")).toThrow();
        });
    });

    describe("compact", () => {
        it("compacts a matching IRI", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            expect(registry.compact("http://example.org/Thing")).to.eq("ex:Thing");
        });

        it("returns null when no prefix matches", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            expect(registry.compact("http://other.org/Thing")).to.be.null;
        });

        it("picks the longest matching namespace", () => {
            const registry = new PrefixRegistry({
                ex: "http://example.org/",
                exfoo: "http://example.org/foo/",
            });
            expect(registry.compact("http://example.org/foo/Bar")).to.eq("exfoo:Bar");
        });
    });

    describe("toJSON / clone", () => {
        it("serializes to a plain object", () => {
            const registry = new PrefixRegistry({ ex: "http://example.org/" });
            expect(registry.toJSON()).to.deep.eq({ ex: "http://example.org/" });
        });

        it("clones into an independent copy", () => {
            const original = new PrefixRegistry({ ex: "http://example.org/" });
            const clone = original.clone();
            clone.set("foo", "http://foo.org/");
            expect(original.has("foo")).to.be.false;
            expect(clone.has("foo")).to.be.true;
        });
    });
});
