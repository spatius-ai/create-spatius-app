import type { PromptOption, SetupPrompts } from '../src/prompts.js';

export class FakePrompts implements SetupPrompts {
  readonly choices: string[];
  readonly confirmations: boolean[];
  readonly inputs: string[];
  readonly passwords: string[];
  readonly seenOptions: Array<PromptOption<string>[]> = [];

  constructor({
    choices = [],
    confirmations = [],
    inputs = [],
    passwords = [],
  }: {
    choices?: string[];
    confirmations?: boolean[];
    inputs?: string[];
    passwords?: string[];
  } = {}) {
    this.choices = [...choices];
    this.confirmations = [...confirmations];
    this.inputs = [...inputs];
    this.passwords = [...passwords];
  }

  choose<Value extends string>(
    _message: string,
    options: PromptOption<Value>[],
    initialValue: Value,
  ): Promise<Value> {
    this.seenOptions.push(options);
    return Promise.resolve((this.choices.shift() ?? initialValue) as Value);
  }

  confirm(_message: string, initialValue = true): Promise<boolean> {
    return Promise.resolve(this.confirmations.shift() ?? initialValue);
  }

  input(
    _message: string,
    options?: { initialValue?: string; placeholder?: string },
  ): Promise<string> {
    return Promise.resolve(
      this.inputs.shift() ??
        options?.initialValue ??
        options?.placeholder ??
        '',
    );
  }

  password(_message: string): Promise<string> {
    return Promise.resolve(this.passwords.shift() ?? 'test-secret');
  }
}
