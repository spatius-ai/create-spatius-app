import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      await route.abort();
      return;
    }
    if (url.pathname === '/api/session') {
      await route.fulfill({
        json: {
          server_url: 'wss://example.invalid',
          participant_token: 'fixture-token',
          room_name: 'fixture-room',
          spatius_app_id: 'fixture-app',
          spatius_avatar_id: 'fixture-avatar',
        },
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/tests/e2e/harness.html');
});

test('minimal workspace exposes microphone activity, readable devices, and transcript', async ({
  page,
}, testInfo) => {
  await expect(
    page.getByRole('heading', { name: 'Voice assistant' }),
  ).toBeVisible();
  const transcript = page.getByRole('complementary', { name: 'Transcript' });
  await expect(transcript).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('idle.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  const meter = page.getByRole('group', { name: 'Your microphone activity' });
  await expect(meter).toBeVisible();
  await expect(meter.locator('.audio-bars')).toHaveAttribute(
    'data-enabled',
    'true',
  );
  await expect(page.getByLabel('Microphone device')).toBeVisible();
  const avatarBox = await page.getByLabel('Avatar stage').boundingBox();
  const transcriptBox = await transcript.boundingBox();
  expect(avatarBox).not.toBeNull();
  expect(transcriptBox).not.toBeNull();
  if (testInfo.project.name === 'desktop') {
    expect(transcriptBox!.x).toBeGreaterThanOrEqual(
      avatarBox!.x + avatarBox!.width,
    );
  } else {
    expect(transcriptBox!.y).toBeGreaterThanOrEqual(
      avatarBox!.y + avatarBox!.height,
    );
  }
  await page.screenshot({
    path: testInfo.outputPath('connected.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Mute microphone' }).click();
  await expect(meter).toContainText('Microphone off');
  await expect(meter.locator('.audio-bars')).toHaveAttribute(
    'data-enabled',
    'false',
  );
  await page.getByRole('textbox', { name: 'Message your agent' }).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log')).toContainText('I hear you.');
  await page.screenshot({
    path: testInfo.outputPath('transcript.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test('explicit Start, attach ordering, one audio renderer, typed chat and full post-call transcript', async ({
  page,
}) => {
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session')) posts++;
  });
  expect(await page.evaluate(() => window.__fixture.events)).toEqual([]);
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  expect(posts).toBe(1);
  const events = await page.evaluate(() => window.__fixture.events);
  expect(events).toContain('room:false');
  expect(events.indexOf('avatar:attach')).toBeLessThan(
    events.indexOf('room:connect'),
  );
  expect(events.filter((event) => event === 'room:connect')).toHaveLength(1);
  await expect(page.getByTestId('remote-audio-renderer')).toHaveCount(1);
  await page
    .getByRole('textbox', { name: 'Message your agent' })
    .fill('Hello there');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log')).toContainText('Hello there');
  await expect(page.getByRole('log')).toContainText('I hear you.');
  await expect(page.getByText('Hello there', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Live captions')).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation' }).click();
  await expect(
    page.getByRole('heading', { name: 'Conversation ended' }),
  ).toBeVisible();
  await expect(page.getByTestId('remote-audio-renderer')).toHaveCount(0);
  await expect(page.getByRole('log')).toContainText('Hello there');
  expect(posts).toBe(1);
});

test('mic denial retains typed chat, device selection, and audio unlock', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__fixture.failMicrophone = true;
    window.__fixture.blockedAudio = true;
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('continue by typing');
  await page.getByRole('button', { name: 'Enable sound' }).click();
  await expect(page.getByRole('button', { name: 'Enable sound' })).toBeHidden();
  await page.getByRole('textbox').fill('Text still works');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log')).toContainText('Text still works');
  await page.evaluate(() => {
    window.__fixture.failMicrophone = false;
  });
  await page.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  await page.getByLabel('Microphone device').selectOption('headset');
  expect(await page.evaluate(() => window.__fixture.events)).toContain(
    'device:headset',
  );
});

test('streamed updates replace transcript by ID and the panel stays open with keyboard input', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.__fixture.messages = [
      { id: 'speech', timestamp: 0, message: 'Partial', isUser: false },
    ];
    window.dispatchEvent(new Event('fixture:update'));
  });
  await expect(page.getByRole('log')).toContainText('Partial');
  await page.evaluate(() => {
    window.__fixture.messages = [
      {
        id: 'speech',
        timestamp: 0,
        message: 'Completed speech',
        isUser: false,
      },
    ];
    window.dispatchEvent(new Event('fixture:update'));
  });
  await expect(page.getByRole('log')).toContainText('Completed speech');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('textbox').focus();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('complementary', { name: 'Transcript' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test('reconnecting keeps the attempt and the final message survives disconnection in the same turn', async ({
  page,
}) => {
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session')) posts++;
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('fixture:reconnecting')),
  );
  await expect(page.getByRole('status')).toContainText('Reconnecting');
  await expect(page.getByTestId('remote-audio-renderer')).toHaveCount(1);
  expect(posts).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new Event('fixture:reconnected')),
  );
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.__fixture.messages = [
      {
        id: 'farewell',
        timestamp: 0,
        message: 'The final reply',
        isUser: false,
      },
    ];
    window.dispatchEvent(new Event('fixture:update'));
    window.dispatchEvent(new Event('fixture:disconnect'));
  });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('The final reply');
  expect(posts).toBe(1);
});

test('agent join timeout aborts the attempt and exposes an explicit retry', async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    window.__fixture.stallConnect = true;
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Connecting to the room' }),
  ).toBeVisible();
  await page.clock.fastForward(33_000);
  await expect(page.getByRole('alert')).toContainText(
    'agent did not join in time',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(await page.evaluate(() => window.__fixture.events)).toContain(
    'avatar:detach',
  );
});

test('cancel a pending bootstrap and ignore its late response', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/session', async (route) => {
    await gate;
    await route
      .fulfill({
        json: {
          server_url: 'wss://example.invalid',
          participant_token: 'late',
          room_name: 'late',
          spatius_app_id: 'app',
          spatius_avatar_id: 'avatar',
        },
      })
      .catch(() => undefined);
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  release();
  await expect(
    page.getByRole('button', { name: 'Start conversation', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__fixture.events)).not.toContain(
    'room:connect',
  );
});

test('no credentials refetch on end; explicit retry creates another attempt', async ({
  page,
}) => {
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session')) posts++;
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('fixture:disconnect')),
  );
  await expect(page.getByRole('alert')).toContainText('connection ended');
  expect(posts).toBe(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  expect(posts).toBe(2);
});

test('room connection waits for agent readiness without publishing a microphone', async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
    window.__fixture.pendingAgent = true;
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Waiting for your agent' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled();
  expect(await page.evaluate(() => window.__fixture.events)).not.toContain(
    'microphone:true',
  );
  await page.screenshot({
    path: testInfo.outputPath('waiting.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.__fixture.pendingAgent = false;
    window.dispatchEvent(new Event('fixture:update'));
  });
  await expect(
    page.getByRole('button', { name: 'Mute microphone' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('heading', { name: 'Waiting for your agent' }),
  ).toHaveCount(0);
  await expect(page.getByRole('textbox')).toBeEnabled();
});

test('an agent that never initializes times out even after the room connects', async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    window.__fixture.pendingAgent = true;
  });
  await page
    .getByRole('button', { name: 'Start conversation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Waiting for your agent' }),
  ).toBeVisible();
  await page.clock.fastForward(33_000);
  await expect(page.getByRole('alert')).toContainText(
    'agent did not join in time',
  );
  expect(await page.evaluate(() => window.__fixture.events)).toContain(
    'avatar:detach',
  );
});
