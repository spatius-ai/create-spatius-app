import {
  confirm as clackConfirm,
  isCancel,
  password as clackPassword,
  select,
  text,
} from '@clack/prompts';
import process from 'node:process';
import { createInterface, type Interface } from 'node:readline';

import { CliError, EXIT_CODES, PromptCancelledError } from './errors.js';

export interface PromptOption<Value extends string> {
  hint?: string;
  label: string;
  value: Value;
}

export interface SetupPrompts {
  choose<Value extends string>(
    message: string,
    options: PromptOption<Value>[],
    initialValue: Value,
  ): Promise<Value>;
  confirm(message: string, initialValue?: boolean): Promise<boolean>;
  input(
    message: string,
    options?: { initialValue?: string; placeholder?: string },
  ): Promise<string>;
  password(message: string): Promise<string>;
}

interface PromptSessionOptions {
  /**
   * Allows line-oriented secret input only in the built CLI test harness. This
   * must never be enabled for ordinary users because it cannot disable echo.
   */
  allowInsecureTestInput?: boolean;
  input?: NodeJS.ReadableStream;
  output?: Pick<NodeJS.WritableStream, 'write'>;
  terminal: boolean;
}

export class PromptSession implements SetupPrompts {
  readonly #allowInsecureTestInput: boolean;
  readonly #lineInterface?: Interface;
  readonly #lineIterator?: AsyncIterableIterator<string>;
  readonly #output: Pick<NodeJS.WritableStream, 'write'>;
  readonly #terminal: boolean;

  constructor({
    allowInsecureTestInput = false,
    input = process.stdin,
    output = process.stdout,
    terminal,
  }: PromptSessionOptions) {
    this.#allowInsecureTestInput = allowInsecureTestInput;
    this.#output = output;
    this.#terminal = terminal;

    if (!terminal) {
      this.#lineInterface = createInterface({
        crlfDelay: Number.POSITIVE_INFINITY,
        input,
        terminal: false,
      });
      this.#lineIterator = this.#lineInterface[Symbol.asyncIterator]();
    }
  }

  close(): void {
    this.#lineInterface?.close();
  }

  async #readLine(message: string): Promise<string> {
    this.#output.write(message);
    const result = await this.#lineIterator!.next();
    if (result.done) {
      throw new PromptCancelledError();
    }

    return result.value.trim();
  }

  async projectDirectory(initialValue: string): Promise<string | symbol> {
    if (this.#terminal) {
      const answer = await text({
        defaultValue: initialValue,
        message: 'Where should we create your project?',
        placeholder: initialValue,
      });
      return isCancel(answer) ? Symbol('cancelled') : answer;
    }

    try {
      const answer = await this.#readLine(
        `Where should we create your project? (${initialValue}) `,
      );
      return answer === '' ? initialValue : answer;
    } catch (error) {
      if (error instanceof PromptCancelledError) {
        return Symbol('cancelled');
      }
      throw error;
    }
  }

  async choose<Value extends string>(
    message: string,
    options: PromptOption<Value>[],
    initialValue: Value,
  ): Promise<Value> {
    if (this.#terminal) {
      const answer = await select<Value>({
        initialValue,
        message,
        options: options as Parameters<typeof select<Value>>[0]['options'],
      });

      if (isCancel(answer)) {
        throw new PromptCancelledError();
      }

      return answer;
    }

    const choices = options.map((option) => option.value).join('/');
    while (true) {
      const answer = await this.#readLine(
        `${message} (${choices}) [${initialValue}] `,
      );
      if (answer === '') {
        return initialValue;
      }

      const selected = options.find(
        (option) => option.value.toLowerCase() === answer.toLowerCase(),
      );
      if (selected !== undefined) {
        return selected.value;
      }

      this.#output.write(`Choose one of: ${choices}.\n`);
    }
  }

  async confirm(message: string, initialValue = true): Promise<boolean> {
    if (this.#terminal) {
      const answer = await clackConfirm({
        active: 'Yes',
        inactive: 'No',
        initialValue,
        message,
      });

      if (isCancel(answer)) {
        throw new PromptCancelledError();
      }

      return answer;
    }

    const suffix = initialValue ? 'Y/n' : 'y/N';
    while (true) {
      const answer = await this.#readLine(`${message} (${suffix}) `);
      if (answer === '') {
        return initialValue;
      }
      if (['y', 'yes'].includes(answer.toLowerCase())) {
        return true;
      }
      if (['n', 'no'].includes(answer.toLowerCase())) {
        return false;
      }

      this.#output.write('Enter yes or no.\n');
    }
  }

  async input(
    message: string,
    {
      initialValue,
      placeholder,
    }: { initialValue?: string; placeholder?: string } = {},
  ): Promise<string> {
    if (this.#terminal) {
      const answer = await text({
        ...(initialValue === undefined ? {} : { defaultValue: initialValue }),
        message,
        ...(placeholder === undefined ? {} : { placeholder }),
      });

      if (isCancel(answer)) {
        throw new PromptCancelledError();
      }

      return answer.trim();
    }

    const suffix = initialValue === undefined ? '' : ` (${initialValue})`;
    const answer = await this.#readLine(`${message}${suffix} `);
    return answer === '' && initialValue !== undefined ? initialValue : answer;
  }

  async password(message: string): Promise<string> {
    if (this.#terminal) {
      const answer = await clackPassword({ mask: '•', message });
      if (isCancel(answer)) {
        throw new PromptCancelledError();
      }

      return answer.trim();
    }

    if (!this.#allowInsecureTestInput) {
      throw new CliError(
        'INVALID_ARGUMENT',
        'Credential setup requires an interactive terminal so secret input can be masked.',
        {
          exitCode: EXIT_CODES.invalidArgument,
          recovery:
            'Run create-spatius-app setup . --interactive in a terminal with a PTY.',
        },
      );
    }

    return this.#readLine(`${message} `);
  }

  shouldInstall(): Promise<boolean> {
    return this.confirm('Install dependencies now?', true);
  }

  shouldConfigureCredentials(): Promise<boolean> {
    return this.confirm(
      'Configure provider and Spatius credentials now?',
      true,
    );
  }
}
