// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it } from "vitest";
import {
    Aside,
    Button,
    Div,
    Footer,
    H1,
    H2,
    Header,
    Hr,
    Li,
    Main,
    Nav,
    P,
    Section,
    Span,
    Ul,
} from "./primitives.js";

// All tests run under react-native-web (Platform.OS === "web"), so they
// exercise the HTML branch. The native branch is plain RNW primitives and
// needs no separate test harness.

describe("Div", () => {
    it("test renders a div with className", () => {
        render(
            <Div className="my-class" testID="el">
                content
            </Div>,
        );
        const el = screen.getByTestId("el");
        expect(el.tagName.toLowerCase()).toBe("div");
        expect(el.className).toBe("my-class");
    });

    it("test testID maps to data-testid", () => {
        render(<Div testID="probe">x</Div>);
        expect(document.querySelector('[data-testid="probe"]')).not.toBeNull();
    });

    it("test data prop maps to data-* attributes", () => {
        render(
            <Div testID="d" data={{ region: "main", depth: 2, empty: true }}>
                x
            </Div>,
        );
        const el = screen.getByTestId("d");
        expect(el.getAttribute("data-region")).toBe("main");
        expect(el.getAttribute("data-depth")).toBe("2");
        expect(el.getAttribute("data-empty")).toBe("true");
    });

    it("test className absent means no class attribute", () => {
        render(<Div testID="bare">x</Div>);
        expect(screen.getByTestId("bare").getAttribute("class")).toBeNull();
    });
});

describe("Button", () => {
    it("test renders a button with default type=button", () => {
        render(<Button testID="btn">Click</Button>);
        const btn = screen.getByTestId("btn");
        expect(btn.tagName.toLowerCase()).toBe("button");
        expect(btn.getAttribute("type")).toBe("button");
    });

    it("test onClick fires on click", () => {
        const calls: number[] = [];
        render(
            <Button testID="btn" onClick={() => calls.push(1)}>
                Go
            </Button>,
        );
        screen.getByTestId("btn").click();
        expect(calls).toHaveLength(1);
    });

    it("test className applied to button", () => {
        render(
            <Button className="nav-link" testID="btn">
                x
            </Button>,
        );
        expect(screen.getByTestId("btn").className).toBe("nav-link");
    });

    it("test disabled prop forwarded", () => {
        render(
            <Button testID="btn" disabled>
                x
            </Button>,
        );
        expect((screen.getByTestId("btn") as HTMLButtonElement).disabled).toBe(true);
    });
});

describe("Nav", () => {
    it("test renders a nav landmark", () => {
        render(
            <Nav aria-label="Primary" testID="nav">
                links
            </Nav>,
        );
        const el = screen.getByRole("navigation", { name: "Primary" });
        expect(el.tagName.toLowerCase()).toBe("nav");
    });
});

describe("Span", () => {
    it("test renders a span with className", () => {
        render(
            <Span className="label" testID="sp">
                text
            </Span>,
        );
        const el = screen.getByTestId("sp");
        expect(el.tagName.toLowerCase()).toBe("span");
        expect(el.className).toBe("label");
    });
});

describe("headings", () => {
    it("test H1 renders h1 with correct role", () => {
        render(<H1 className="hero">Title</H1>);
        const el = screen.getByRole("heading", { level: 1, name: "Title" });
        expect(el.tagName.toLowerCase()).toBe("h1");
        expect(el.className).toBe("hero");
    });

    it("test H2 renders h2", () => {
        render(<H2 testID="h2">Sub</H2>);
        expect(screen.getByTestId("h2").tagName.toLowerCase()).toBe("h2");
    });
});

describe("P and Hr", () => {
    it("test P renders a paragraph", () => {
        render(
            <P className="hint" testID="p">
                text
            </P>,
        );
        const el = screen.getByTestId("p");
        expect(el.tagName.toLowerCase()).toBe("p");
        expect(el.className).toBe("hint");
    });

    it("test Hr renders an hr element", () => {
        render(<Hr className="divider" testID="hr" />);
        const el = screen.getByTestId("hr");
        expect(el.tagName.toLowerCase()).toBe("hr");
        expect(el.className).toBe("divider");
    });
});

describe("list primitives", () => {
    it("test Ul and Li render list structure", () => {
        render(
            <Ul testID="list">
                <Li testID="item">A</Li>
            </Ul>,
        );
        expect(screen.getByTestId("list").tagName.toLowerCase()).toBe("ul");
        expect(screen.getByTestId("item").tagName.toLowerCase()).toBe("li");
    });
});

describe("landmark primitives", () => {
    it("test Header renders header", () => {
        render(<Header testID="hdr">top</Header>);
        expect(screen.getByTestId("hdr").tagName.toLowerCase()).toBe("header");
    });

    it("test Footer renders footer", () => {
        render(<Footer testID="ftr">bottom</Footer>);
        expect(screen.getByTestId("ftr").tagName.toLowerCase()).toBe("footer");
    });

    it("test Aside renders aside", () => {
        render(<Aside testID="aside">side</Aside>);
        expect(screen.getByTestId("aside").tagName.toLowerCase()).toBe("aside");
    });

    it("test Main renders main", () => {
        render(<Main testID="main">content</Main>);
        expect(screen.getByTestId("main").tagName.toLowerCase()).toBe("main");
    });

    it("test Section renders section", () => {
        render(<Section testID="sec">section</Section>);
        expect(screen.getByTestId("sec").tagName.toLowerCase()).toBe("section");
    });
});
