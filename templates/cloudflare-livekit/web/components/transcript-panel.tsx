import type { ReactNode } from 'react';

export function TranscriptPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="transcript-panel" aria-labelledby="transcript-title">
      <header className="transcript-heading">
        <h2 id="transcript-title">Transcript</h2>
      </header>
      {children}
    </aside>
  );
}
