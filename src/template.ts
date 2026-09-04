import { fileURLToPath } from 'node:url';

export function resolveTemplateDirectory(): string {
  return fileURLToPath(new URL('../template', import.meta.url));
}
