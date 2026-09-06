/** Static, offline-capable callback page. Never interpolate authentication data. */
export const successPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Spatius authorization complete</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #151131; background: #f7f5f1; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; min-height: 100svh; display: flex; flex-direction: column; background: radial-gradient(ellipse at 50% 38%, #eae6f3 0, transparent 58%); }
      a { color: inherit; text-decoration: none; }
      a:focus-visible { outline: 3px solid #6363a7; outline-offset: 5px; }
      header, footer { width: min(100% - 48px, 1120px); margin-inline: auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-block: 28px; }
      .brand { font-size: 24px; font-weight: 650; letter-spacing: -.9px; }
      .brand { display: inline-flex; align-items: center; gap: 8px; }
      .eyebrow { font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; color: #636174; }
      main { flex: 1; display: grid; place-items: center; padding: 48px 24px; }
      .card { width: min(100%, 620px); padding: 48px; background: #ffffffed; border: 1px solid #e8e4ee; border-radius: 24px; box-shadow: 0 24px 80px -32px #30234d30; }
      .check { display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid #dcd7ed; border-radius: 50%; background: #f1eef8; color: #6363a7; margin-bottom: 28px; }
      .check svg { width: 24px; height: 24px; }
      h1 { font-size: clamp(30px, 5vw, 42px); font-weight: 550; letter-spacing: -.045em; line-height: 1.15; margin: 12px 0 16px; }
      .description { color: #636174; line-height: 1.7; font-size: 15px; margin: 0; max-width: 420px; }
      .terminal { display: flex; align-items: center; gap: 16px; padding: 20px; margin: 28px 0 32px; background: #f7f5f9; border: 1px solid #e8e4ee; border-radius: 12px; }
      .terminal-icon { font: 20px ui-monospace, SFMono-Regular, Consolas, monospace; color: #6363a7; }
      .terminal strong { display: block; font-size: 14px; font-weight: 600; }
      .terminal p { margin: 5px 0 0; font-size: 13px; color: #636174; line-height: 1.5; }
      nav { border-top: 1px solid #eeebf1; padding-top: 24px; }
      nav .eyebrow { display: block; margin-bottom: 14px; }
      .links { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .links a { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 46px; padding: 12px 14px; border: 1px solid #e8e4ee; border-radius: 9px; font-size: 13px; font-weight: 550; }
      .links a:hover { background: #f1eef8; border-color: #bab2d4; }
      .link-label { display: flex; align-items: center; gap: 10px; }
      .links svg { width: 18px; height: 18px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; color: #6363a7; }
      .links .external-icon { width: 14px; height: 14px; }
      footer { justify-content: flex-end; font-size: 12px; color: #636174; }
      footer a:hover { color: #151131; text-decoration: underline; }
      @media (max-width: 520px) {
        header, footer { width: calc(100% - 40px); padding-block: 22px; }
        main { padding: 20px; }
        .card { padding: 28px 24px; border-radius: 18px; }
        .links { grid-template-columns: 1fr; }
        footer { flex-wrap: wrap; gap: 12px; }
      }
    </style>
  </head>
  <body>
    <header>
      <!-- Inline brand mark from spatius-site/src/assets/brand/spatius-logo-mark-black.svg. -->
      <a class="brand" href="https://www.spatius.ai/" target="_blank" rel="noopener noreferrer"><svg width="24" height="20" aria-hidden="true" viewBox="0 0 265 220" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_279_158)"><path d="M178.56 7.19C182.19 8.35 184.62 11.78 184.62 15.59V39.43C184.62 44.17 180.77 48 176.06 48H151.07C148.71 48 146.57 48.96 145.02 50.5C144.92 50.6 144.82 50.69 144.73 50.8C143.35 52.33 142.5 54.35 142.5 56.56V94.22C142.5 98.94 138.66 102.78 133.94 102.78H108.96C104.22 102.78 100.4 106.62 100.4 111.34V149C100.4 153.74 96.56 157.57 91.84 157.57H66.86C62.12 157.57 58.29 161.41 58.29 166.14V188.47C58.29 195.77 49.94 199.95 44.12 195.55C17.04 175.04 0 145.2 0 111.99C0 50.13 59.1 0 132 0C148.41 0 164.11 2.53999 178.59 7.17999L178.56 7.19Z" fill="currentColor"/><path d="M230.22 59.4799V98.2699C230.22 103.15 226.27 107.09 221.4 107.09H195.68C190.8 107.09 186.86 111.04 186.86 115.91V154.7C186.86 159.58 182.9 163.52 178.04 163.52H152.31C149.89 163.52 147.67 164.52 146.08 166.1C145.98 166.2 145.88 166.3 145.78 166.41C144.35 167.98 143.49 170.06 143.49 172.34V211.13C143.49 216.01 139.54 219.95 134.67 219.95H108.95C104.07 219.95 100.13 216 100.13 211.13V172.34C100.13 167.46 104.08 163.52 108.95 163.52H134.67C139.55 163.52 143.49 159.57 143.49 154.7V115.91C143.49 115.62 143.49 115.35 143.53 115.06C143.53 114.93 143.55 114.81 143.57 114.67C143.57 114.55 143.6 114.42 143.63 114.29C143.63 114.23 143.65 114.18 143.66 114.12C143.68 114 143.72 113.88 143.75 113.77C143.77 113.66 143.81 113.55 143.84 113.43C143.92 113.18 144.01 112.91 144.11 112.67C144.19 112.46 144.28 112.26 144.36 112.07C144.36 112.05 144.38 112.04 144.38 112.03C144.44 111.92 144.49 111.81 144.56 111.7C144.73 111.39 144.93 111.08 145.12 110.79C145.21 110.67 145.29 110.55 145.39 110.44C145.51 110.27 145.64 110.12 145.79 109.96C145.89 109.85 145.99 109.75 146.09 109.65C146.29 109.45 146.5 109.26 146.71 109.07C146.93 108.89 147.15 108.73 147.38 108.56C147.61 108.41 147.86 108.26 148.1 108.12C148.34 107.99 148.6 107.87 148.85 107.75C149.12 107.63 149.38 107.53 149.66 107.45C149.87 107.38 150.08 107.33 150.29 107.28C150.5 107.22 150.72 107.18 150.94 107.15C151.12 107.13 151.29 107.11 151.47 107.08H178.02C182.89 107.08 186.84 103.13 186.84 98.2599V59.4699C186.84 54.5899 190.79 50.6499 195.66 50.6499H221.38C226.26 50.6499 230.2 54.5999 230.2 59.4699H230.21L230.22 59.4799Z" fill="currentColor"/><path d="M264.34 122.11V154.32C264.34 158.37 261.07 161.64 257.02 161.64H235.66C231.61 161.64 228.34 164.91 228.34 168.96V201.16C228.34 205.21 225.07 208.49 221.02 208.49H199.66C195.61 208.49 192.34 205.22 192.34 201.16V168.96C192.34 164.91 195.61 161.64 199.66 161.64H221.02C225.07 161.64 228.34 158.37 228.34 154.32V122.11C228.34 118.06 231.61 114.79 235.66 114.79H257.02C261.07 114.79 264.34 118.06 264.34 122.11Z" fill="currentColor"/></g><defs><clipPath id="clip0_279_158"><rect width="265" height="220" fill="white"/></clipPath></defs></svg>Spatius</a>
    </header>
    <main>
      <section class="card" aria-labelledby="success-title">
        <div class="check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
        <span class="eyebrow">You're connected</span>
        <h1 id="success-title">Authorization complete.</h1>
        <p class="description">Your next idea starts here. Spatius is ready to help you bring it to life.</p>
        <div class="terminal">
          <span class="terminal-icon" aria-hidden="true">&gt;_</span>
          <div><strong>Continue in your terminal</strong><p>You can close this tab and finish your project setup.</p></div>
        </div>
        <nav aria-label="Spatius resources">
          <span class="eyebrow">While you're building</span>
          <div class="links">
            <a href="https://docs.spatius.ai/" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z" /></svg>Documentation</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg></a>
            <a href="https://app.spatius.ai" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M9 9v12" /></svg>Open Studio</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg></a>
            <a href="https://github.com/spatius-ai" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" /></svg>GitHub</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg></a>
            <a href="https://discord.gg/9HGhZfHZh9" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" /><path d="M7 10h10M7 14h6" /></svg>Join our Discord</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg></a>
          </div>
        </nav>
      </section>
    </main>
    <footer><a href="https://www.spatius.ai/" target="_blank" rel="noopener noreferrer">Explore Spatius ↗</a></footer>
  </body>
</html>`;
