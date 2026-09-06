export async function attachAvatarSession(
  container: HTMLElement,
  _credentials: unknown,
  _room: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  window.__fixture.events.push('avatar:attach');
  const figure = document.createElement('div');
  figure.className = 'fixture-avatar';
  figure.setAttribute('aria-label', 'Test avatar renderer');
  // Neutral geometry exercises the real stage's layout without a persona asset.
  figure.style.cssText =
    'position:absolute;inset:14% 25% 0;border-radius:48% 48% 0 0;background:linear-gradient(160deg,#c9c9b9,#83988a);box-shadow:0 0 80px #354b3a30';
  container.append(figure);
  await Promise.resolve();
  return {
    dispose: async () => {
      window.__fixture.events.push('avatar:detach');
      figure.remove();
      await Promise.resolve();
    },
  };
}
