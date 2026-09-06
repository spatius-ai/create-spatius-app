import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const clack = vi.hoisted(() => ({
  cancel: Symbol('cancel'),
  confirm: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  confirm: clack.confirm,
  isCancel: (value: unknown) => value === clack.cancel,
  password: clack.password,
  select: clack.select,
  text: clack.text,
}));

import { PromptCancelledError } from '../../src/errors.js';
import { PromptSession } from '../../src/prompts.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PromptSession terminal presentation', () => {
  it('delegates text, selection, confirmation, and masked secrets to Clack', async () => {
    clack.text.mockResolvedValueOnce('project').mockResolvedValueOnce('value');
    clack.select.mockResolvedValue('b');
    clack.confirm.mockResolvedValue(true);
    clack.password.mockResolvedValue('secret');
    const prompts = new PromptSession({ terminal: true });

    await expect(prompts.projectDirectory('default')).resolves.toBe('project');
    await expect(
      prompts.choose(
        'Choose',
        [
          { label: 'A', value: 'a' },
          { hint: 'recommended', label: 'B', value: 'b' },
        ],
        'a',
      ),
    ).resolves.toBe('b');
    await expect(prompts.confirm('Confirm?')).resolves.toBe(true);
    await expect(
      prompts.input('Value', { initialValue: 'initial', placeholder: 'hint' }),
    ).resolves.toBe('value');
    await expect(prompts.password('Secret')).resolves.toBe('secret');
    await expect(prompts.shouldInstall()).resolves.toBe(true);
    await expect(prompts.shouldConfigureCredentials()).resolves.toBe(true);
    prompts.close();

    expect(clack.password).toHaveBeenCalledWith({
      mask: '•',
      message: 'Secret',
    });
  });

  it('turns every Clack cancellation into the established cancellation contract', async () => {
    clack.text.mockResolvedValue(clack.cancel);
    clack.select.mockResolvedValue(clack.cancel);
    clack.confirm.mockResolvedValue(clack.cancel);
    clack.password.mockResolvedValue(clack.cancel);
    const prompts = new PromptSession({ terminal: true });

    await expect(prompts.projectDirectory('default')).resolves.toEqual(
      expect.any(Symbol),
    );
    await expect(
      prompts.choose('Choose', [{ label: 'A', value: 'a' }], 'a'),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(prompts.confirm('Confirm?')).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
    await expect(prompts.input('Input')).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
    await expect(prompts.password('Password')).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
  });
});

describe('PromptSession line-oriented behavior', () => {
  it('supports deterministic non-TTY project and package prompts', async () => {
    const input = Readable.from('\ninvalid\nb\nmaybe\nn\n\nline-secret\n');
    let output = '';
    const prompts = new PromptSession({
      allowInsecureTestInput: true,
      input,
      output: {
        write: (chunk: string | Uint8Array) => {
          output += chunk.toString();
          return true;
        },
      },
      terminal: false,
    });

    await expect(prompts.projectDirectory('default')).resolves.toBe('default');
    await expect(
      prompts.choose(
        'Choose',
        [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
        'a',
      ),
    ).resolves.toBe('b');
    await expect(prompts.confirm('Confirm?')).resolves.toBe(false);
    await expect(
      prompts.input('Input', { initialValue: 'initial' }),
    ).resolves.toBe('initial');
    await expect(prompts.password('Password')).resolves.toBe('line-secret');
    expect(output).toContain('Choose one of: a/b.');
    expect(output).toContain('Enter yes or no.');
    prompts.close();
  });

  it('refuses unmasked secret entry outside the isolated test harness', async () => {
    const prompts = new PromptSession({
      input: Readable.from('secret\n'),
      terminal: false,
    });
    await expect(prompts.password('Password')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    prompts.close();
  });

  it('treats EOF as cancellation', async () => {
    const project = new PromptSession({
      input: Readable.from([]),
      output: { write: () => true },
      terminal: false,
    });
    await expect(project.projectDirectory('default')).resolves.toEqual(
      expect.any(Symbol),
    );
    project.close();

    const choice = new PromptSession({
      input: Readable.from([]),
      output: { write: () => true },
      terminal: false,
    });
    await expect(
      choice.choose('Choose', [{ label: 'A', value: 'a' }], 'a'),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    choice.close();
  });
});
