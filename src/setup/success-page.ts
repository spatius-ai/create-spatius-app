import assets from './success-page-assets.json' with { type: 'json' };

/**
 * Offline callback page, aligned with spatius-site's Luminous design system.
 * Palette/type: LuminousDesignSystemPrototype.tsx and luminous-base.css.
 * Materials/radii: luminous-surfaces.css. Only bundled brand assets are
 * interpolated; authentication data must never appear in this document.
 */
export const successPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Spatius authorization complete</title>
    <style>
      /* Bundled font notices:
${assets.fontLicense}
      */
      @font-face { font-family: "HP Inter"; src: url("${assets.inter}") format("woff2"); font-style: normal; font-weight: 400 700; font-display: swap; }
      @font-face { font-family: "HP Geist Mono"; src: url("${assets.geistMono}") format("woff2"); font-style: normal; font-weight: 400; font-display: swap; }
      :root {
        --lab-page: #f5f5f7;
        --lab-surface: #fdfdff;
        --lab-surface-2: #f7f7fb;
        --lab-soft: #ecebfa;
        --lab-text: #23242f;
        --lab-copy: #4e5166;
        --lab-accent: #6363a7;
        --surface-card-radius: 14px;
        --surface-inner-radius: 10px;
        --surface-divider: rgb(35 36 47 / 0.045);
        --surface-raised-card: inset 0 0 0 1px rgb(35 36 47 / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.86), 0 1px 2px rgb(35 36 47 / 0.035), 0 8px 18px -14px rgb(35 36 47 / 0.12);
        --frosted-button-fill: linear-gradient(180deg, rgb(255 255 255 / 0.9), rgb(253 253 255 / 0.78)), rgb(249 249 253 / 0.58);
        --frosted-light-shadow: 0 2px 5px rgb(52 45 83 / 0.02), 0 2px 10px rgb(52 45 83 / 0.03);
        color-scheme: light;
        font-family: "HP Inter", ui-sans-serif, system-ui, sans-serif;
        font-synthesis: none;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: var(--lab-text);
        background: var(--lab-page);
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; min-height: 100svh; display: flex; flex-direction: column; }
      a { color: inherit; text-decoration: none; touch-action: manipulation; }
      a:focus-visible { outline: 2px solid var(--lab-accent); outline-offset: 3px; }
      header, footer { width: min(100% - 48px, 1120px); margin-inline: auto; display: flex; align-items: center; gap: 20px; }
      header { padding-block: 16px; }
      .brand { display: inline-flex; align-items: center; min-height: 44px; }
      .brand svg { display: block; width: 128.402px; height: 33px; }
      .eyebrow { font: 400 10px/14px "HP Geist Mono", ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--lab-copy); }
      main { flex: 1; display: grid; place-items: center; padding: 24px; }
      .card { width: min(100%, 620px); padding: 40px; background: var(--lab-surface); border-radius: var(--surface-card-radius); box-shadow: var(--surface-raised-card); }
      .status { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
      .status .eyebrow { color: var(--lab-accent); }
      .check { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--lab-soft); color: var(--lab-accent); }
      .check svg { width: 20px; height: 20px; }
      h1 { font-size: clamp(30px, 5vw, 40px); font-weight: 500; letter-spacing: -.05em; line-height: 1.1; text-wrap: balance; margin: 0 0 14px; }
      .description { color: var(--lab-copy); line-height: 1.6; font-size: 16px; text-wrap: pretty; margin: 0; max-width: 420px; }
      .terminal { display: flex; align-items: center; gap: 16px; padding: 18px 20px; margin: 24px 0 28px; background: var(--lab-surface-2); box-shadow: inset 0 0 0 1px var(--surface-divider); border-radius: var(--surface-inner-radius); }
      .terminal-icon { width: 22px; height: 22px; flex: none; color: var(--lab-accent); }
      .terminal strong { display: block; font-size: 14px; font-weight: 600; line-height: 22px; }
      .terminal p { margin: 3px 0 0; font-size: 13px; color: var(--lab-copy); line-height: 21px; text-wrap: pretty; }
      nav { border-top: 1px solid var(--surface-divider); padding-top: 24px; }
      nav .eyebrow { display: block; margin-bottom: 14px; }
      .links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .links a { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 48px; padding: 12px 18px; border: 1px solid rgb(39 28 70 / 0.07); border-radius: 999px; background: var(--frosted-button-fill); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.88), var(--frosted-light-shadow); font-size: 14px; font-weight: 550; line-height: 22px; transition: background-color 150ms ease-out, border-color 150ms ease-out, transform 150ms ease-out; }
      .links a:active { transform: scale(.98); }
      .link-label { display: flex; align-items: center; gap: 10px; }
      .links svg { width: 18px; height: 18px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; color: var(--lab-copy); }
      .links .external-icon { width: 14px; height: 14px; color: var(--lab-accent); }
      footer { justify-content: flex-end; padding-block: 8px; font-size: 12px; color: var(--lab-copy); }
      footer a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
      footer svg { width: 14px; height: 14px; }
      @media (hover: hover) {
        .links a:hover { background: #fff; border-color: rgb(99 99 167 / .3); }
        footer a:hover { color: var(--lab-text); text-decoration: underline; text-underline-offset: 4px; }
      }
      @media (max-width: 760px) {
        header, footer { width: calc(100% - 40px); }
        main { padding: 24px 16px; }
        .card { padding: 28px 24px; border-radius: 12px; }
      }
      @media (max-width: 520px) { .links { grid-template-columns: 1fr; } .terminal { align-items: flex-start; padding: 16px; } }
      @media (prefers-reduced-motion: reduce) { .links a { transition: none; } .links a:active { transform: none; } }
    </style>
  </head>
  <body>
    <header>
      <!-- Inline wordmark from spatius-site/src/assets/prototypes/homepage-refresh/spatius-header-logo.svg. -->
      <a class="brand" href="https://www.spatius.ai/" target="_blank" rel="noopener noreferrer" aria-label="Spatius home"><svg aria-hidden="true" width="128.402" height="33" viewBox="0 0 128.402 33" fill="none" xmlns="http://www.w3.org/2000/svg">
<g>
<path d="M26.7901 1.07875C27.3347 1.25279 27.6993 1.7674 27.6993 2.33903V5.91584C27.6993 6.62701 27.1217 7.20164 26.415 7.20164H22.6657C22.3116 7.20164 21.9905 7.34567 21.758 7.57672C21.7429 7.59173 21.7279 7.60523 21.7144 7.62173C21.5074 7.85128 21.3799 8.15435 21.3799 8.48593V14.1362C21.3799 14.8444 20.8037 15.4205 20.0956 15.4205H16.3477C15.6366 15.4205 15.0634 15.9966 15.0634 16.7048V22.3551C15.0634 23.0662 14.4873 23.6409 13.7791 23.6409H10.0313C9.32012 23.6409 8.74549 24.217 8.74549 24.9267V28.2769C8.74549 29.3722 7.4927 29.9993 6.61951 29.3392C2.55658 26.262 0 21.785 0 16.8023C0 7.52121 8.86702 0 19.8045 0C22.2666 0 24.6221 0.381086 26.7946 1.07724L26.7901 1.07875Z" fill="black"/>
<path d="M34.5408 8.92402V14.7438C34.5408 15.476 33.9482 16.0671 33.2175 16.0671H29.3587C28.6265 16.0671 28.0354 16.6598 28.0354 17.3904V23.2103C28.0354 23.9424 27.4412 24.5336 26.7121 24.5336H22.8517C22.4886 24.5336 22.1555 24.6836 21.917 24.9207C21.902 24.9357 21.887 24.9507 21.872 24.9672C21.6574 25.2027 21.5284 25.5148 21.5284 25.8569V31.6767C21.5284 32.4089 20.9357 33 20.2051 33H16.3462C15.614 33 15.0229 32.4074 15.0229 31.6767V25.8569C15.0229 25.1247 15.6155 24.5336 16.3462 24.5336H20.2051C20.9372 24.5336 21.5284 23.9409 21.5284 23.2103V17.3904C21.5284 17.3469 21.5284 17.3064 21.5344 17.2629C21.5344 17.2434 21.5374 17.2254 21.5404 17.2044C21.5404 17.1864 21.5449 17.1669 21.5494 17.1474C21.5494 17.1384 21.5524 17.1309 21.5539 17.1219C21.5569 17.1039 21.5629 17.0859 21.5674 17.0694C21.5704 17.0529 21.5764 17.0364 21.5809 17.0184C21.5929 16.9809 21.6064 16.9403 21.6214 16.9043C21.6334 16.8728 21.6469 16.8428 21.6589 16.8143C21.6589 16.8113 21.6619 16.8098 21.6619 16.8083C21.6709 16.7918 21.6784 16.7753 21.6889 16.7588C21.7144 16.7123 21.7444 16.6658 21.7729 16.6223C21.7864 16.6043 21.7984 16.5863 21.8134 16.5698C21.8314 16.5443 21.851 16.5217 21.8735 16.4977C21.8885 16.4812 21.9035 16.4662 21.9185 16.4512C21.9485 16.4212 21.98 16.3927 22.0115 16.3642C22.0445 16.3372 22.0775 16.3132 22.112 16.2877C22.1465 16.2652 22.184 16.2427 22.22 16.2217C22.256 16.2022 22.2951 16.1842 22.3326 16.1662C22.3731 16.1482 22.4121 16.1332 22.4541 16.1212C22.4856 16.1107 22.5171 16.1031 22.5486 16.0956C22.5801 16.0866 22.6131 16.0806 22.6461 16.0761C22.6731 16.0731 22.6986 16.0701 22.7257 16.0656H26.7091C27.4397 16.0656 28.0324 15.473 28.0324 14.7423V8.92252C28.0324 8.19035 28.625 7.59921 29.3557 7.59921H33.2145C33.9467 7.59921 34.5378 8.19185 34.5378 8.92252H34.5393L34.5408 8.92402Z" fill="black"/>
<path d="M39.66 18.3207V23.1533C39.66 23.7609 39.1694 24.2515 38.5618 24.2515H35.3571C34.7494 24.2515 34.2588 24.7421 34.2588 25.3498V30.1809C34.2588 30.7885 33.7682 31.2806 33.1606 31.2806H29.9558C29.3482 31.2806 28.8576 30.79 28.8576 30.1809V25.3498C28.8576 24.7421 29.3482 24.2515 29.9558 24.2515H33.1606C33.7682 24.2515 34.2588 23.7609 34.2588 23.1533V18.3207C34.2588 17.713 34.7494 17.2224 35.3571 17.2224H38.5618C39.1694 17.2224 39.66 17.713 39.66 18.3207Z" fill="black"/>
<g>
<path d="M87.4729 14.7004C87.0108 14.1288 86.4467 13.6577 85.782 13.2871C85.1249 12.9165 84.3807 12.7319 83.548 12.7319C82.6478 12.7319 81.8061 12.9 81.023 13.2376C80.2398 13.5736 79.5511 14.0417 78.9525 14.6389C78.3553 15.236 77.8872 15.9307 77.5512 16.7214C77.2226 17.512 77.0591 18.3582 77.0591 19.2584C77.0591 20.1586 77.2316 21.0678 77.5767 21.884C77.9308 22.7002 78.4139 23.4204 79.0275 24.043C79.6501 24.6657 80.3703 25.1533 81.1865 25.5074C82.0027 25.8614 82.8774 26.037 83.8121 26.037C84.5863 26.037 85.2554 25.8644 85.8195 25.5194C86.3912 25.1653 86.8503 24.7077 87.1954 24.1435L87.3349 25.7084H90.4151V13.086H87.3349L87.4744 14.7019L87.4729 14.7004ZM86.6642 21.2524C86.3777 21.8075 85.9831 22.2501 85.4775 22.5772C84.9733 22.9058 84.3927 23.0693 83.7356 23.0693C83.0784 23.0693 82.5068 22.9058 81.9682 22.5772C81.4385 22.2486 81.0124 21.8075 80.6929 21.2524C80.3733 20.6973 80.2128 20.0791 80.2128 19.3965C80.2128 18.7138 80.3688 18.0957 80.6794 17.5405C80.9989 16.9854 81.4235 16.5428 81.9547 16.2157C82.4933 15.8797 83.0859 15.7116 83.7341 15.7116C84.3822 15.7116 84.9583 15.8752 85.464 16.2037C85.9771 16.5323 86.3777 16.9779 86.6627 17.542C86.9493 18.0972 87.0918 18.7153 87.0918 19.398C87.0918 20.0806 86.9493 20.6898 86.6627 21.2539L86.6642 21.2524Z" fill="black"/>
<path d="M52.5885 11.116C53.1271 10.9135 53.6957 10.8175 54.2928 10.825C54.89 10.825 55.4496 10.909 55.9717 11.077C56.4938 11.2376 56.935 11.4551 57.2965 11.7342C57.6581 12.0117 57.8982 12.3193 58.0167 12.6554L60.9199 11.6081C60.6258 10.792 60.1367 10.0928 59.4555 9.51217C58.7819 8.93154 57.9957 8.49044 57.0955 8.18737C56.1953 7.8843 55.2606 7.73277 54.2928 7.73277C53.1316 7.73277 52.0498 7.95632 51.0491 8.40192C50.0484 8.84752 49.2397 9.47017 48.6261 10.2698C48.0124 11.0695 47.7048 12.0027 47.7048 13.0725C47.7048 14.2082 47.9914 15.1339 48.563 15.8496C49.1437 16.5653 49.9299 17.1249 50.9231 17.5285C51.9163 17.9321 53.0401 18.2307 54.2928 18.4242C54.8645 18.5172 55.4211 18.6508 55.9582 18.8278C56.4969 19.0048 56.9379 19.2449 57.283 19.548C57.6281 19.842 57.8006 20.2216 57.8006 20.6837C57.8006 21.1458 57.6371 21.5374 57.3085 21.8825C56.98 22.2186 56.5464 22.4841 56.0077 22.6777C55.4781 22.8622 54.905 22.9552 54.2914 22.9552C53.6777 22.9552 53.1346 22.8712 52.6125 22.7032C52.0903 22.5351 51.6492 22.3116 51.2877 22.034C50.9261 21.7565 50.686 21.4489 50.5675 21.1128L47.6763 22.1736C47.9704 22.9807 48.455 23.6754 49.1272 24.256C49.8008 24.8277 50.5825 25.2703 51.4752 25.5808C52.3754 25.8839 53.3131 26.0354 54.2898 26.0354C55.4676 26.0354 56.5569 25.8119 57.5591 25.3663C58.5598 24.9207 59.364 24.298 59.9701 23.4984C60.5763 22.6912 60.8793 21.752 60.8793 20.6837C60.8793 19.6155 60.5763 18.7438 59.9701 18.0206C59.364 17.2884 58.5613 16.7033 57.5591 16.2667C56.5569 15.8301 55.4676 15.518 54.2898 15.332C53.6417 15.2225 53.0536 15.1054 52.5224 14.9779C51.9928 14.8429 51.5667 14.6328 51.2472 14.3463C50.9351 14.0597 50.7805 13.6351 50.7805 13.071C50.7805 12.6329 50.9486 12.2458 51.2847 11.9097C51.6207 11.5736 52.0543 11.3081 52.5855 11.1145L52.5885 11.116Z" fill="black"/>
<path d="M74.0959 14.7139C73.4897 14.1003 72.7876 13.6201 71.9879 13.2751C71.1882 12.93 70.3255 12.7574 69.3998 12.7574C68.5926 12.7574 67.8845 12.939 67.2798 13.3006C66.6827 13.6546 66.1771 14.1168 65.7645 14.6884V13.086H62.6843L62.6843 30.5185H65.7645V24.13C66.1771 24.7017 66.6812 25.1698 67.2798 25.5314C67.886 25.8854 68.5926 26.061 69.3998 26.061C70.3255 26.061 71.1882 25.8884 71.9879 25.5434C72.7876 25.1983 73.4897 24.7227 74.0959 24.1165C74.702 23.5104 75.1851 22.7917 75.5227 21.983C75.8678 21.1759 76.0403 20.3132 76.0403 19.395C76.0403 18.4767 75.8678 17.6201 75.5227 16.8204C75.1866 16.0207 74.711 15.3185 74.0959 14.7124V14.7139ZM72.429 21.2644C72.1094 21.8195 71.6803 22.2621 71.1417 22.5892C70.6031 22.9163 70.0104 23.0813 69.3623 23.0813C68.7141 23.0813 68.15 22.9178 67.6459 22.5892C67.1403 22.2531 66.7457 21.806 66.4591 21.2509C66.1726 20.6867 66.03 20.0686 66.03 19.395C66.03 18.7213 66.1726 18.1077 66.4591 17.5525C66.7457 16.9974 67.1403 16.5548 67.6459 16.2277C68.1515 15.8917 68.7231 15.7221 69.3623 15.7221C70.0014 15.7221 70.6121 15.8902 71.1417 16.2277C71.6803 16.5563 72.1094 16.9974 72.429 17.5525C72.7486 18.1077 72.9091 18.7228 72.9091 19.395C72.9091 20.0671 72.7486 20.6988 72.429 21.2629V21.2644Z" fill="black"/>
<path d="M103.464 13.0859H100.383V25.7083H103.464V13.0859Z" fill="black"/>
<path d="M101.936 8.3014C101.491 8.3014 101.111 8.45294 100.8 8.75601C100.488 9.05908 100.334 9.43266 100.334 9.87976C100.334 10.3269 100.49 10.7125 100.8 11.0155C101.111 11.3096 101.495 11.4566 101.95 11.4566C102.404 11.4566 102.77 11.3096 103.073 11.0155C103.377 10.7125 103.528 10.3344 103.528 9.87976C103.528 9.42516 103.372 9.05908 103.061 8.75601C102.758 8.45294 102.385 8.3014 101.938 8.3014H101.936Z" fill="black"/>
<path d="M114.21 13.0859V20.2306C114.21 20.7272 114.089 21.1818 113.844 21.5944C113.6 21.998 113.276 22.322 112.872 22.5666C112.469 22.8021 112.014 22.9207 111.508 22.9207C111.003 22.9207 110.571 22.8021 110.158 22.5666C109.754 22.322 109.43 21.998 109.186 21.5944C108.941 21.1818 108.82 20.7272 108.82 20.2306V13.0859H105.74V21.0377C105.74 21.9635 105.963 22.8051 106.409 23.5613C106.863 24.31 107.469 24.9116 108.226 25.3662C108.983 25.8118 109.82 26.0354 110.737 26.0354C111.418 26.0354 112.059 25.9049 112.656 25.6438C113.253 25.3752 113.771 25.0122 114.209 24.5591L114.221 25.7083H117.301L117.289 13.0859H114.209H114.21Z" fill="black"/>
<path d="M126.242 18.8788C125.594 18.5248 124.899 18.2262 124.159 17.9831C123.831 17.8826 123.486 17.7896 123.124 17.7056C122.77 17.6216 122.468 17.503 122.215 17.3515C121.963 17.191 121.837 16.9524 121.837 16.6313C121.837 16.2953 121.93 16.0252 122.114 15.8242C122.308 15.6216 122.56 15.4791 122.872 15.3951C123.184 15.311 123.529 15.2765 123.907 15.2945C124.201 15.311 124.483 15.3786 124.753 15.4971C125.022 15.6066 125.262 15.7491 125.474 15.9262C125.684 16.0942 125.849 16.2803 125.966 16.4813L128.402 15.0425C127.915 14.2848 127.25 13.6997 126.408 13.2886C125.576 12.8685 124.657 12.6569 123.657 12.6569C122.831 12.6569 122.062 12.8205 121.346 13.149C120.639 13.4776 120.063 13.9442 119.616 14.5504C119.178 15.1565 118.959 15.8752 118.959 16.7094C118.959 17.467 119.165 18.1152 119.577 18.6538C119.997 19.1834 120.549 19.617 121.231 19.9546C121.921 20.2907 122.665 20.5397 123.465 20.6988C123.768 20.7738 124.078 20.8593 124.399 20.9508C124.728 21.0348 124.996 21.1654 125.207 21.3424C125.426 21.5105 125.535 21.7505 125.535 22.0626C125.535 22.3566 125.442 22.5967 125.258 22.7827C125.08 22.9673 124.845 23.1068 124.551 23.1998C124.264 23.2839 123.961 23.3259 123.642 23.3259C123.264 23.3259 122.914 23.2628 122.594 23.1368C122.282 23.0108 122.014 22.8548 121.787 22.6702C121.561 22.4767 121.396 22.2951 121.295 22.1271L118.695 23.2373C118.947 23.776 119.309 24.2381 119.781 24.6252C120.252 25.0122 120.791 25.3198 121.397 25.5464C122.011 25.7654 122.647 25.8959 123.303 25.9379C124.177 26.0055 124.998 25.8794 125.765 25.5599C126.539 25.2403 127.17 24.7767 127.658 24.1721C128.146 23.5584 128.39 22.8428 128.39 22.0266C128.407 21.3109 128.218 20.6973 127.822 20.1841C127.426 19.671 126.9 19.2374 126.243 18.8834L126.242 18.8788Z" fill="black"/>
<path d="M96.1029 12.7109V9.12204H93.0242V13.0859H95.7278C95.9348 13.0859 96.1029 13.254 96.1029 13.461V15.7911C96.1029 15.9981 95.9348 16.1661 95.7278 16.1661H93.0242V23.9319C93.0242 24.5861 93.3888 25.3497 93.8974 25.7083H97.2971C97.0721 25.5058 96.1029 24.6056 96.1029 23.9319V16.5412C96.1029 16.3342 96.2709 16.1661 96.478 16.1661H99.1516V13.0859H96.478C96.2709 13.0859 96.1029 12.9179 96.1029 12.7109Z" fill="black"/>
</g>
</g>
</svg></a>
    </header>
    <main>
      <section class="card" aria-labelledby="success-title">
        <div class="status">
          <span class="check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
          <span class="eyebrow">You're connected</span>
        </div>
        <h1 id="success-title">Authorization complete.</h1>
        <p class="description">Spatius Studio is connected and ready for your next idea.</p>
        <div class="terminal">
          <svg class="terminal-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="1.5" /><path d="m6 9 3 3-3 3m6 0h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <div><strong>Continue in your terminal</strong><p>You can close this tab and finish your project setup.</p></div>
        </div>
        <nav aria-label="Spatius resources">
          <span class="eyebrow">While you're building</span>
          <div class="links">
            <a href="https://docs.spatius.ai/" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z" /></svg>Documentation</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M5 15 15 5M7 5h8v8" stroke-width="1.7" /></svg></a>
            <a href="https://app.spatius.ai" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M9 9v12" /></svg>Open Studio</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M5 15 15 5M7 5h8v8" stroke-width="1.7" /></svg></a>
            <a href="https://github.com/spatius-ai" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" /></svg>GitHub</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M5 15 15 5M7 5h8v8" stroke-width="1.7" /></svg></a>
            <a href="https://discord.gg/9HGhZfHZh9" target="_blank" rel="noopener noreferrer"><span class="link-label"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" /><path d="M7 10h10M7 14h6" /></svg>Join our Discord</span><svg class="external-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M5 15 15 5M7 5h8v8" stroke-width="1.7" /></svg></a>
          </div>
        </nav>
      </section>
    </main>
    <footer><a href="https://www.spatius.ai/" target="_blank" rel="noopener noreferrer">Explore Spatius <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M5 15 15 5M7 5h8v8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg></a></footer>
  </body>
</html>`;
