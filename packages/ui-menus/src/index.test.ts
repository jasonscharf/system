import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import * as reactApi from "./react/index.js";
import { MenuItemSchema, MenuSchema } from "./schemas.generated.js";

// Smoke test for the public barrels: the runtime values resolve (including the
// generated IRI constants and, on the ./schemas entry, the EntitySchemas), and
// the React surface is wired.
describe("@jasonscharf/ui-menus public surface", () => {
    it("test runtime barrel exposes assembly, registry, and generated IRIs", () => {
        expect(typeof api.assembleMenu).toBe("function");
        expect(typeof api.MenuRegistry).toBe("function");

        // Generated IRI constants resolve on the browser-safe barrel.
        expect(api.MenuIRI.value).toBe("urn:sys:ui:Menu");
        expect(api.MenuItemIRI.value).toBe("urn:sys:ui:MenuItem");
        expect(api.messageIRI.value).toBe("urn:sys:ui:message");
    });

    it("test schemas entry exposes the generated EntitySchemas", () => {
        expect(MenuSchema.typeIRI.value).toBe("urn:sys:ui:Menu");
        expect(MenuItemSchema.typeIRI.value).toBe("urn:sys:ui:MenuItem");
        expect(MenuItemSchema.idSegment).toBe("item");
    });

    it("test react barrel exposes the menu view + provider", () => {
        expect(typeof reactApi.MenuView).toBe("function");
        expect(typeof reactApi.MenuProvider).toBe("function");
        expect(typeof reactApi.useMenus).toBe("function");
    });
});
