// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see ./PROVENANCE.md.
import { useState, type ComponentProps } from 'react';
import { Icon } from '../icons.js';
export type AgentTrackToggleProps = Omit<
  ComponentProps<'button'>,
  'onChange'
> & {
  pressed?: boolean;
  defaultPressed?: boolean;
  pending?: boolean;
  onPressedChange?: (pressed: boolean) => void;
};
export function AgentTrackToggle({
  pressed,
  defaultPressed = false,
  pending = false,
  onPressedChange,
  disabled,
  ...props
}: AgentTrackToggleProps) {
  const [uncontrolledPressed, setUncontrolledPressed] =
    useState(defaultPressed);
  const isControlled = pressed !== undefined;
  const resolvedPressed = pressed ?? uncontrolledPressed;
  const handlePressedChange = () => {
    if (!isControlled) setUncontrolledPressed(!resolvedPressed);
    onPressedChange?.(!resolvedPressed);
  };
  return (
    <button
      type="button"
      className="microphone-toggle"
      aria-label={resolvedPressed ? 'Mute microphone' : 'Enable microphone'}
      aria-pressed={resolvedPressed}
      aria-busy={pending}
      data-state={resolvedPressed ? 'on' : 'off'}
      disabled={disabled || pending}
      onClick={handlePressedChange}
      {...props}
    >
      <Icon name={resolvedPressed ? 'mic' : 'mic-off'} />
      <span>
        {pending
          ? 'Please wait'
          : resolvedPressed
            ? 'Microphone on'
            : 'Microphone off'}
      </span>
    </button>
  );
}
