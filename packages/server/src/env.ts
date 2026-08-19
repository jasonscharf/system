/**
 * Centralized point for environment-level settings for system-based apps.
 * Consumers of this package should extend this object and continue the usage pattern.
 *
 * This env block contains default values that are overriden by process environment values,
 * configuration, and secrets, and in that order.
 *
 * This is to avoid spreading configurable values through the app, and instaed to have them in one
 * centralized location.
 *
 * NOTE: Secrets MUST come from the proper vault mechanisms, i.e. AWS/Azure/Google secrets
 * management facilities.
 *
 * This is server-side code only.
 */
"use server";

import { exists } from "@jasonscharf/core";

// NOTE: Adding a key here means it will get pulled from `process.env` if present
export const defaults = {
    SYS_MODE: "dev",
    // Threshold for the platform logger (see PinoLogger). "debug" locally when
    // chasing something, "info" everywhere else. This is a config VALUE, not an
    // environment branch: the logger is identical at every level.
    SYS_LOG_LEVEL: "info",
} as Record<string, string>;

const allowedModes = ["test", "dev", "staging", "staging-dev", "staging-production", "production"];

export function isTest() {
    return env.SYS_MODE === "test";
}
export function isDev() {
    return env.SYS_MODE === "dev";
}
export function isStagingDev() {
    return env.SYS_MODE === "staging-dev";
}
export function isStaging() {
    return env.SYS_MODE === "staging";
}
export function isProduction() {
    return env.SYS_MODE === "production";
}
export function isStagingOrProduction() {
    return isStaging() || isProduction();
}

// Copy `source` values over the keys already present in `target`, but only when the
// source actually has a value. Keys absent from `source` keep their existing `target`
// value (the default), so an unset process variable never clobbers a default.
export function copyEnvBlock(
    source: Record<string, string>,
    target: Record<string, string | null | undefined>,
) {
    Object.keys(target).forEach((key) => {
        if (exists(source[key])) {
            target[key] = source[key];
        }
    });
}

// Start from the defaults, then let matching process.env values override them.
// Only keys declared in `defaults` are pulled from process.env.
export const env = (<typeof defaults>Object.assign({}, defaults)) as Record<string, string>;
copyEnvBlock(process.env as Record<string, string>, env);

if (allowedModes.indexOf(env.SYS_MODE) < 0) {
    throw new Error(`Unknown mode '${env.SYS_MODE}'`);
}
