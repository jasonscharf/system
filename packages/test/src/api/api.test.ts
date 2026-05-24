import { describe, it } from "vitest";

// Side-effect import — executes the module (covers packages/api/src/index.ts)
import "@system/api";

describe("api", () => {
    it("loads without error", () => {
        // coverage provided by the top-level import
    });
});
