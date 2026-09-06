// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see ./PROVENANCE.md.
import type { ComponentProps } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { Icon } from '../icons.js';
export function AgentDisconnectButton({
  onClick,
  children,
  ...props
}: ComponentProps<'button'>) {
  const { end } = useSessionContext();
  return (
    <button
      type="button"
      className="disconnect-button"
      aria-label="End conversation"
      {...props}
      onClick={(event) => {
        onClick?.(event);
        // The host prevents default to include avatar disposal and preserve messages.
        if (!event.defaultPrevented) void end().catch(() => undefined);
      }}
    >
      <Icon name="end" />
      {children}
    </button>
  );
}
