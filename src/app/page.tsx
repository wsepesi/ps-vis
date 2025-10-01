"use client";

import { FormEvent, useState } from "react";

interface SummaryMeta {
  id?: string;
  format?: string;
  players: { p1: string; p2: string };
  winner?: string;
  loser?: string;
  resultNote?: string;
}

interface SummaryResponse {
  html: string;
  text: string;
  meta: SummaryMeta;
  error?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) {
      setError("Paste a replay link first.");
      return;
    }
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: SummaryResponse = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to summarize replay");
      }
      setSummary(data);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!summary) return;
    try {
      if (typeof navigator !== "undefined" && "clipboard" in navigator && typeof ClipboardItem !== "undefined") {
        const htmlBlob = new Blob([summary.html], { type: "text/html" });
        const textBlob = new Blob([summary.text], { type: "text/plain" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": htmlBlob,
            "text/plain": textBlob,
          }),
        ]);
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(summary.text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy to clipboard");
    }
  }

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 16px", display: "flex", flexDirection: "column", gap: "24px" }}>
      <header>
        <h1 style={{ fontSize: "28px", fontWeight: 600, marginBottom: "8px" }}>Pokémon Showdown Replay Summarizer</h1>
      </header>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <label htmlFor="replay-url" style={{ fontWeight: 600 }}>Replay link</label>
        <input
          id="replay-url"
          type="url"
          placeholder="https://replay.pokemonshowdown.com/..."
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          style={{
            padding: "10px",
            border: "1px solid #111",
            fontSize: "16px",
            fontFamily: "inherit",
          }}
          required
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px",
            background: "#111",
            color: "#fff",
            border: "none",
            fontSize: "16px",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Summarize"}
        </button>
      </form>

      {error && (
        <div style={{ border: "1px solid #aa0000", padding: "12px", background: "#fff5f5" }}>
          <strong style={{ display: "block", marginBottom: "4px" }}>Error</strong>
          <span>{error}</span>
        </div>
      )}

      {summary && (() => {
        const { players, format, winner, loser, resultNote } = summary.meta;
        const p1Tag = winner === players.p1 ? "[W] " : loser === players.p1 ? "[L] " : "";
        const p2Tag = winner === players.p2 ? "[W] " : loser === players.p2 ? "[L] " : "";
        return (
          <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <strong>Result:</strong> {p1Tag}{players.p1} vs {p2Tag}{players.p2}
                {format ? ` — ${format}` : ""}
                {resultNote ? ` (${resultNote})` : ""}
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={loading}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #111",
                  background: copied ? "#e0ffe0" : "transparent",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {copied ? "Copied!" : "Copy summary to clipboard"}
              </button>
            </div>

            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>Preview</h2>
              <div
                style={{ border: "1px solid #111", padding: "16px", overflowX: "auto" }}
                dangerouslySetInnerHTML={{ __html: summary.html }}
              />
            </div>

            <div>
              <h3 style={{ fontSize: "18px", marginBottom: "8px" }}>Plain text</h3>
              <pre
                style={{
                  border: "1px solid #111",
                  padding: "16px",
                  background: "#f7f7f7",
                  whiteSpace: "pre-wrap",
                  fontSize: "14px",
                  lineHeight: 1.4,
                }}
              >
                {summary.text}
              </pre>
            </div>
          </section>
        );
      })()}
    </main>
  );
}
