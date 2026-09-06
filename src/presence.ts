import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import type { WriteStream } from 'node:tty';
import { stripVTControlCharacters } from 'node:util';

import type { TerminalTheme } from './theme.js';

const WIDTH = 36;
const HEIGHT = 11;
const FRAME_MS = 1000 / 12;
const RAMP = ' .,:;+=*#%@';

/** The same breathing surface used in the approved Presence concept. */
export function renderPresenceFrame(
  time: number,
  theme: TerminalTheme,
): string[] {
  const radius = 1.12 + 0.055 * Math.sin(time * 1.3);
  return Array.from({ length: HEIGHT }, (_, row) => {
    let line = '';
    for (let column = 0; column < WIDTH; column++) {
      const x = (column - 17.5) / 7.7;
      const y = (5 - row) / 3.85;
      const distance = x * x + y * y;
      if (distance > radius * radius) {
        line += ' ';
        continue;
      }
      const z = Math.sqrt(radius * radius - distance);
      const longitude = Math.atan2(x, z) + time * 0.35;
      const weave =
        0.5 +
        0.5 *
          Math.sin(
            longitude * 8 + y * 5 + Math.sin(y * 5 - time) * 1.1 - time * 0.8,
          );
      const light = Math.max(0, (-x * 0.45 + y * 0.45 + z * 0.7) / radius);
      const value =
        0.12 +
        0.65 * light * (0.3 + 0.7 * weave) +
        0.12 * Math.pow(z / radius, 3);
      const character = RAMP[Math.floor(value * (RAMP.length - 1))]!;
      line +=
        value > 0.32 ? theme.highlight(character) : theme.accent(character);
    }
    return line;
  });
}

interface PresenceOutput extends Pick<
  WriteStream,
  'write' | 'isTTY' | 'columns' | 'rows'
> {
  on(event: 'resize', listener: () => void): void;
  off(event: 'resize', listener: () => void): void;
}

interface PresenceOptions {
  interactive: boolean;
  theme: TerminalTheme;
  output?: PresenceOutput;
  environment?: NodeJS.ProcessEnv;
}

/** Owns only the bottom block of the terminal, never an active input prompt. */
export class Presence {
  readonly #output: PresenceOutput;
  readonly #theme: TerminalTheme;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #interactive: boolean;
  #timer?: ReturnType<typeof setInterval>;
  #time = 0;
  #label = '';
  #rendered = false;
  #resized = false;
  #width = 0;

  constructor({
    interactive,
    theme,
    output = process.stdout,
    environment = process.env,
  }: PresenceOptions) {
    this.#interactive = interactive;
    this.#theme = theme;
    this.#output = output;
    this.#environment = environment;
  }

  get visible(): boolean {
    return (
      this.#interactive &&
      this.#output.isTTY === true &&
      !this.#environment.CI &&
      this.#environment.TERM !== 'dumb' &&
      this.#output.columns >= WIDTH + 1 &&
      this.#output.rows >= HEIGHT + 8
    );
  }

  get animated(): boolean {
    return this.visible && !('NO_COLOR' in this.#environment);
  }

  readonly #onResize = (): void => {
    // A resize can reflow earlier lines. Do not move the cursor relative to
    // the old geometry, which could erase output outside our block.
    this.#resized = true;
    this.#clearTimer();
  };

  #draw(): void {
    if (this.#resized) return;
    const lines = renderPresenceFrame(this.#time, this.#theme);
    if (this.#width >= 65) {
      lines[4] += `  ${this.#theme.highlight('spatius')}`;
      lines[5] += '  a presence, taking shape.';
    }
    // Reserve one column to avoid automatic wrapping, including the status.
    lines.push(
      stripVTControlCharacters(this.#label)
        .replace(/[\r\n]/g, ' ')
        .slice(0, this.#width - 1),
    );
    const rewind = this.#rendered ? `\u001b[${HEIGHT + 1}A\r` : '';
    this.#output.write(
      rewind +
        lines
          .map((line) => `${this.#rendered ? '\u001b[2K' : ''}${line}\n`)
          .join(''),
    );
    this.#rendered = true;
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#output.off('resize', this.#onResize);
  }

  async welcome(): Promise<void> {
    if (!this.visible) return;
    this.start('');
    try {
      if (this.animated) await delay(1000);
    } finally {
      this.stop();
    }
  }

  start(label: string): void {
    this.#clearTimer();
    if (!this.visible) return;
    this.#label = label;
    this.#width = this.#output.columns;
    this.#rendered = false;
    this.#resized = false;
    this.#draw();
    if (this.animated) {
      this.#output.on('resize', this.#onResize);
      this.#timer = setInterval(() => {
        this.#time += FRAME_MS / 1000;
        this.#draw();
      }, FRAME_MS);
      // Animation must not keep the CLI alive after its work finishes.
      this.#timer.unref();
    }
  }

  message(label: string): void {
    this.#label = label;
  }

  stop(label?: string): void {
    this.#clearTimer();
    if (label !== undefined && this.#rendered) {
      this.#label = label;
      if (this.#resized || !this.animated) this.#output.write(`${label}\n`);
      else this.#draw();
    }
    this.#rendered = false;
  }
}
