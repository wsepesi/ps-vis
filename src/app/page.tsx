'use client';

import { FormEvent, useState } from 'react';
import { requestSummary, copySummaryToClipboard } from '@/lib/utils';

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

const CLIPBOARD_RESET_DELAY = 2000;

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sanitizedUrl = url.trim();
    if (!sanitizedUrl) {
      setError('Paste a replay link first.');
      return;
    }
    setUrl(sanitizedUrl);
    setLoading(true);
    setError(null);
    setCopied(false);
    setSummary(null);
    try {
      const nextSummary = await requestSummary(sanitizedUrl);
      setSummary(nextSummary);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!summary) return;
    try {
      await copySummaryToClipboard(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), CLIPBOARD_RESET_DELAY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy summary');
    }
  }

  return (
    <main>
      <header>
        <h1>ps-vis</h1>
      </header>

      <form onSubmit={handleSubmit}>
        <label htmlFor="replay-url">
          Replay link
        </label>
        <input
          id="replay-url"
          type="url"
          placeholder="https://replay.pokemonshowdown.com/..."
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        <button
          type="submit"
          disabled={loading}
        >
          {loading ? 'Summarizing…' : 'Summarize'}
        </button>
      </form>

      {error && (
        <div>
          <strong>Error:</strong> {error}
        </div>
      )}

      {summary && (
        <SummaryResult
          summary={summary}
          copied={copied}
          loading={loading}
          onCopy={handleCopy}
        />
      )}
    </main>
  );
}

interface SummaryResultProps {
  summary: SummaryResponse;
  copied: boolean;
  loading: boolean;
  onCopy: () => Promise<void>;
}

function SummaryResult({ summary, copied, loading, onCopy }: SummaryResultProps) {
  const { players, format, winner, loser, resultNote } = summary.meta;
  const p1Tag = winner === players.p1 ? '[W] ' : loser === players.p1 ? '[L] ' : '';
  const p2Tag = winner === players.p2 ? '[W] ' : loser === players.p2 ? '[L] ' : '';
  const metaLine = `${p1Tag}${players.p1} vs ${p2Tag}${players.p2}`;
  const formatNote = format ? ` — ${format}` : '';
  const resultSuffix = resultNote ? ` (${resultNote})` : '';

  return (
    <section>
      <div>
        <div>
          {metaLine}
          {formatNote}
          {resultSuffix}
        </div>
        <div>
          <button
            type="button"
            onClick={() => void onCopy()}
            disabled={loading}
          >
            {copied ? 'Copied!' : 'Copy summary to clipboard'}
          </button>
        </div>
      </div>

      <div>
        <div>
          <h2>Preview</h2>
          <div
            dangerouslySetInnerHTML={{ __html: summary.html }}
          />
        </div>

        <div>
          <h3>Plain text</h3>
          <pre>
            {summary.text}
          </pre>
        </div>
      </div>
    </section>
  );
}
