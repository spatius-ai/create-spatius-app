const SENSITIVE_ASSIGNMENT =
  /\b(authorization|auth[_-]?code|code[_-]?verifier|access[_-]?token|refresh[_-]?token|api[_-]?key|api[_-]?secret|password|secret)\b(\s*[:=]\s*)(["']?)([^\s,"'&}]+)\3/giu;
const SENSITIVE_QUERY =
  /([?&](?:auth_code|code_verifier|access_token|refresh_token|api_key|api_secret)=)[^&#\s]+/giu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z\d._~+/=-]+/giu;

export class SecretRedactor {
  readonly #values = new Set<string>();

  add(...values: Array<string | undefined>): void {
    for (const value of values) {
      const trimmed = value?.trim();
      if (trimmed !== undefined && trimmed.length >= 4) {
        this.#values.add(trimmed);
      }
    }
  }

  redact(value: string): string {
    let redacted = value;
    for (const secret of [...this.#values].sort(
      (left, right) => right.length - left.length,
    )) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    }

    return redacted
      .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
      .replace(SENSITIVE_QUERY, '$1[REDACTED]')
      .replace(SENSITIVE_ASSIGNMENT, '$1$2$3[REDACTED]$3');
  }

  error(error: unknown, fallback: string): Error {
    const message = error instanceof Error ? error.message : fallback;
    return new Error(this.redact(message), { cause: error });
  }
}

export function maskSecret(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 4) {
    return '••••';
  }

  return `••••${normalized.slice(-4)}`;
}
