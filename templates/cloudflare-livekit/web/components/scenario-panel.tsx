import { useEffect, useRef, useState } from 'react';
import {
  scenario,
  scenarioData,
  type ConversationControls,
} from '../scenario.js';
export function ScenarioPanel({
  controls,
  ready,
}: {
  controls: ConversationControls;
  ready: boolean;
}) {
  const [question, setQuestion] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [query, setQuery] = useState('');
  const [talking, setTalking] = useState(false);
  const [audience, setAudience] = useState<string[]>([]);
  const [error, setError] = useState('');
  const latest = useRef(controls);
  latest.current = controls;
  const run = (operation: () => Promise<void>) => {
    setError('');
    void operation().catch(() =>
      setError('That action did not complete. Please try again.'),
    );
  };
  useEffect(() => {
    if (scenario !== 'live-streaming' || !ready || talking) return;
    let index = 0;
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      const line =
        scenarioData.audience[index++ % scenarioData.audience.length];
      setAudience((previous) => [...previous.slice(-4), line]);
      busy = true;
      void latest.current
        .speak(`A viewer says: ${line}`)
        .catch(() => setError('The host could not respond.'))
        .finally(() => {
          busy = false;
        });
    }, 12000);
    return () => window.clearInterval(timer);
  }, [ready, talking]);
  if (scenario === 'minimal') return null;
  const current = scenarioData.questions[question];
  return (
    <section
      className="scenario-panel glass"
      aria-label={`${scenario} controls`}
    >
      <h2>{scenario.replaceAll('-', ' ')}</h2>
      {scenario === 'tutoring' && (
        <>
          <p>{current.question}</p>
          <button
            disabled={!ready}
            onClick={() => run(() => controls.speak(current.question))}
          >
            Read question
          </button>
          {current.choices.map((choice, index) => (
            <button
              key={choice}
              disabled={!ready}
              onClick={() => {
                const text =
                  index === current.answer
                    ? 'That is right! Nicely done.'
                    : current.hint;
                setFeedback(text);
                run(() => controls.speak(text));
              }}
            >
              {choice}
            </button>
          ))}
          <p role="status">{feedback}</p>
          <button
            onClick={() => {
              setQuestion((question + 1) % scenarioData.questions.length);
              setFeedback('');
            }}
          >
            Next question
          </button>
          <button
            disabled={!ready}
            onClick={() => run(() => controls.setMode('free-talk'))}
          >
            Free conversation
          </button>
        </>
      )}
      {scenario === 'customer-service' && (
        <>
          <label>
            Search topics{' '}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {scenarioData.faq
            .filter((item) =>
              `${item.topic} ${item.answer}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((item) => (
              <article key={item.topic}>
                <h3>{item.topic}</h3>
                <p>{item.answer}</p>
                <button
                  disabled={!ready}
                  onClick={() => run(() => controls.speak(item.answer))}
                >
                  Read answer
                </button>
              </article>
            ))}
          <button
            disabled={!ready}
            onClick={() => run(() => controls.setMode('free-talk'))}
          >
            Ask a question
          </button>
        </>
      )}
      {scenario === 'live-streaming' && (
        <>
          <p>Simulated audience · gifts are visual reactions only</p>
          <div aria-live="polite">
            {audience.map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
          </div>
          <button
            disabled={!ready}
            onClick={() => {
              setAudience((previous) => [
                ...previous.slice(-4),
                'You sent applause!',
              ]);
              if (!talking)
                run(() => controls.speak('Thank you for the applause!'));
            }}
          >
            Send applause
          </button>
          <button
            disabled={!ready}
            onClick={() => {
              const next = !talking;
              setTalking(next);
              run(async () => {
                await controls.interrupt();
                await controls.setMode(next ? 'free-talk' : 'scripted');
              });
            }}
          >
            {talking ? 'Return to audience' : 'Talk with host'}
          </button>
        </>
      )}
      {scenario === 'companion' && <CompanionMemory />}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function CompanionMemory() {
  const [status, setStatus] = useState('Loading memory…');
  useEffect(() => {
    void fetch(
      `/api/memory?character=${encodeURIComponent(sessionStorage.getItem('spatius-character') ?? 'friend')}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = (await response.json()) as { size: number };
        setStatus(`${value.size} characters remembered in this browser.`);
      })
      .catch(() => setStatus('Memory unavailable. Conversation can continue.'));
  }, []);
  return (
    <>
      <p role="status">{status}</p>
      <button
        onClick={() => {
          void fetch(
            `/api/memory?character=${encodeURIComponent(sessionStorage.getItem('spatius-character') ?? 'friend')}`,
            { method: 'DELETE' },
          )
            .then((response) => {
              if (!response.ok) throw new Error();
              setStatus(
                'Memory cleared. End this conversation and start a new one.',
              );
            })
            .catch(() =>
              setStatus('Could not clear memory. Please try again.'),
            );
        }}
      >
        Clear memory
      </button>
    </>
  );
}
