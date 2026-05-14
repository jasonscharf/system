import React, { useState, useEffect, useCallback } from 'react';
import type { ShowcaseSnapshot, ShowcaseState } from '../ClientApp.js';
import { SignInPanel } from './SignIn.js';


// ── React hook ────────────────────────────────────────────────────────────────

export function useShowcase(model: ShowcaseState): ShowcaseSnapshot {
    const [snap, setSnap] = useState<ShowcaseSnapshot>(() => model.snapshot);

    useEffect(() => {
        setSnap(model.snapshot);
        return model.subscribe(() => setSnap(model.snapshot));
    }, [model]);

    return snap;
}


// ── Visual component ──────────────────────────────────────────────────────────

interface Props {
    model: ShowcaseState;
}

export function ComponentShowcaseView({ model }: Props): React.ReactElement {
    const { connected, pingRtt, stats, echoResult, echoPending } = useShowcase(model);

    const [echoInput, setEchoInput] = useState('hello tern');

    const handlePing = useCallback(() => { void model.ping(); }, [model]);
    const handleStats = useCallback(() => { void model.refreshStats(); }, [model]);
    const handleEcho = useCallback(() => {
        if (echoInput.trim()) { void model.echo(echoInput.trim()); }
    }, [model, echoInput]);
    const handleEchoKey = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { handleEcho(); }
    }, [handleEcho]);

    return (
        <div className="showcase">
            <header className="showcase__header">
                <div className="showcase__header-top">
                    <h1 className="showcase__title">Tern Component Showcase</h1>
                    <SignInPanel />
                </div>
                <p className="showcase__subtitle">
                    A React component that is also a Flow-based programming node.
                    Handler endpoints are registered via YAML and Turtle config files.
                </p>
            </header>

            {/* ── Connection ── */}
            <section className="showcase__section">
                <h2>Server Connection</h2>
                <div className={`status-badge ${connected ? 'status-badge--ok' : 'status-badge--err'}`}>
                    <span className="status-badge__dot" />
                    {connected ? 'Connected' : 'Disconnected'}
                </div>
            </section>

            {/* ── Ping ── */}
            <section className="showcase__section">
                <h2>Ping  <span className="endpoint-badge">tern:ping</span></h2>
                <div className="showcase__row">
                    <button className="btn" onClick={handlePing} disabled={!connected}>
                        Ping Server
                    </button>
                    {pingRtt !== null && <span className="ping-result">{pingRtt} ms</span>}
                </div>
            </section>

            {/* ── Echo ── */}
            <section className="showcase__section">
                <h2>Echo  <span className="endpoint-badge">tern:echo</span></h2>
                <p className="showcase__hint">
                    Sample endpoint registered via <code>config/extensions/echo.yaml</code>.
                    The server uppercases your message and echoes it back.
                </p>
                <div className="showcase__row">
                    <input
                        className="text-input"
                        value={echoInput}
                        onChange={e => setEchoInput(e.target.value)}
                        onKeyDown={handleEchoKey}
                        placeholder="Type a message…"
                        disabled={!connected}
                    />
                    <button
                        className="btn"
                        onClick={handleEcho}
                        disabled={!connected || echoPending || !echoInput.trim()}
                    >
                        {echoPending ? 'Sending…' : 'Send'}
                    </button>
                </div>
                {echoResult !== null && (
                    <div className="echo-result">
                        <span className="echo-result__label">Server says:</span>
                        <span className="echo-result__value">{echoResult.echo}</span>
                        <span className="echo-result__meta">
                            {new Date(echoResult.receivedAt).toLocaleTimeString()}
                        </span>
                    </div>
                )}
            </section>

            {/* ── Triple Store ── */}
            <section className="showcase__section">
                <h2>Triple Store  <span className="endpoint-badge">tern:triple.stats</span></h2>
                <button className="btn" onClick={handleStats} disabled={!connected}>
                    Refresh Stats
                </button>
                {stats !== null && (
                    <table className="stats-table">
                        <tbody>
                            <tr><th>Namespaces</th><td>{stats.namespaces}</td></tr>
                            <tr><th>Names</th>     <td>{stats.names}</td></tr>
                            <tr><th>Nodes</th>     <td>{stats.nodes}</td></tr>
                            <tr><th>Edges</th>     <td>{stats.edges}</td></tr>
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}
