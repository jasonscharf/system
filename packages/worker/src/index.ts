import { IRI } from "@jasonscharf/core";

console.log("--- Worker start ---");

setInterval(() => {
    const _foo = new IRI("http://foo");
    console.log(`Hello from worker!`);
}, 2000);
