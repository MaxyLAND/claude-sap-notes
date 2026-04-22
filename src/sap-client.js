import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const ME_SAP = 'https://me.sap.com';
const getNavTimeout = () => Number(process.env.SAP_NAV_TIMEOUT ?? 45000);
const getStoragePath = () =>
  resolve(process.env.SAP_STORAGE_STATE ?? './storage-state.json');

function log(...args) {
  // stderr only — stdout is reserved for MCP protocol
  console.error('[sap-client]', ...args);
}

const USER_SELECTORS = [
  'input[name="j_username"]',
  'input#j_username',
  'input[name="username"]',
  'input#username',
  'input[name="login"]',
  'input#login',
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[data-sap-ui-fastnavgroup] input[type="text"]',
  'input[placeholder*="mail" i]',
  'input[placeholder*="user" i]',
  'input[aria-label*="mail" i]',
  'input[aria-label*="user" i]',
];

const PASS_SELECTORS = [
  'input[name="j_password"]',
  'input#j_password',
  'input[name="password"]',
  'input#password',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[aria-label*="password" i]',
];

const SIGN_IN_SELECTORS = [
  'a#header-nav-button',
  'a.sec1-login-button',
  'a[href="/home"]:has-text("Sign In")',
  'a:has-text("Sign In")',
  'a:has-text("Sign in")',
  'a:has-text("Iniciar sesión")',
  'button:has-text("Sign In")',
  'button:has-text("Sign in")',
];

const COOKIE_SELECTORS = [
  '#truste-consent-button',
  'button:has-text("Accept All")',
  'button:has-text("Aceptar todo")',
  'button:has-text("Accept all")',
  'button:has-text("I Accept")',
];

// Welcome / first-run dialog shown by SAP for Me on first login into a new session
const WELCOME_DISMISS_SELECTORS = [
  'button:has-text("Inicio")',
  'button:has-text("Start")',
  'button:has-text("Begin")',
  'button:has-text("Got it")',
  'button:has-text("Entendido")',
  'button:has-text("Close")',
  'button:has-text("Cerrar")',
  '.sapMDialog button.sapMBtn',
  '[role="dialog"] button',
];

async function dismissCookieBanner(page) {
  for (const sel of COOKIE_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  }
  return false;
}

async function dismissWelcomePopup(page) {
  // Fast exit: if no dialog present at all, don't spin.
  const hasDialog = await page
    .locator('[role="dialog"], .sapMDialog')
    .first()
    .isVisible({ timeout: 250 })
    .catch(() => false);
  if (!hasDialog) return false;

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    for (const sel of WELCOME_DISMISS_SELECTORS) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 150 }).catch(() => false)) {
        await loc.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(300);
        const stillOpen = await page
          .locator('[role="dialog"]:visible, .sapMDialog:visible')
          .first()
          .isVisible({ timeout: 150 })
          .catch(() => false);
        if (!stillOpen) return true;
      }
    }
    await page.waitForTimeout(200);
  }
  return false;
}

const SUBMIT_SELECTORS = [
  'button#logOnFormSubmit',
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Continue")',
  'button:has-text("Continuar")',
  'button:has-text("Next")',
  'button:has-text("Siguiente")',
  'button:has-text("Log On")',
  'button:has-text("Log on")',
  'button:has-text("Sign in")',
  'button:has-text("Iniciar sesión")',
];

async function firstVisible(frameOrPage, selectors) {
  for (const sel of selectors) {
    try {
      const loc = frameOrPage.locator(sel).first();
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        return sel;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function clickFirst(frameOrPage, selectors) {
  const sel = await firstVisible(frameOrPage, selectors);
  if (!sel) return false;
  try {
    await frameOrPage.locator(sel).first().click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForFrameWith(page, selectors, timeout) {
  const start = Date.now();
  const interval = 500;
  while (Date.now() - start < timeout) {
    const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
    for (const f of frames) {
      for (const sel of selectors) {
        try {
          const loc = f.locator(sel).first();
          if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
            return f;
          }
        } catch {
          /* ignore */
        }
      }
    }
    await page.waitForTimeout(interval);
  }
  throw new Error(
    `Timeout ${timeout}ms waiting for any of [${selectors.slice(0, 3).join(', ')}...]`
  );
}

async function dumpDebug(page, prefix = 'login-debug') {
  try {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const shot = resolve(`./${prefix}.png`);
    const html = resolve(`./${prefix}.html`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    await writeFile(html, await page.content(), 'utf8').catch(() => {});
    log(`debug dump → url=${url} title="${title}" screenshot=${shot} html=${html}`);
  } catch {
    /* ignore */
  }
}

export class SapClient {
  constructor() {
    this.browser = null;
    this.context = null;
    this.loginInFlight = null;
    // If storage-state.json exists, assume session is good until proven otherwise.
    // Skips the probe/login dance on the first call → saves ~12s.
    this.sessionKnownGood = existsSync(getStoragePath());
    this.lastStorageSave = 0;
    // Throttle storage save to at most every 5 minutes to capture rolling cookies.
    this.STORAGE_SAVE_INTERVAL_MS = 5 * 60 * 1000;
  }

  async maybeSaveStorage() {
    const now = Date.now();
    if (now - this.lastStorageSave < this.STORAGE_SAVE_INTERVAL_MS) return;
    this.lastStorageSave = now;
    try {
      await this.saveStorage();
    } catch (err) {
      log('maybeSaveStorage failed:', err?.message || err);
    }
  }

  async init() {
    if (this.browser) return;
    const headful = process.env.SAP_HEADFUL === '1';
    this.browser = await chromium.launch({ headless: !headful });
    const contextOptions = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    };
    if (existsSync(getStoragePath())) {
      contextOptions.storageState = getStoragePath();
      log('loaded storage state from', getStoragePath());
    }
    this.context = await this.browser.newContext(contextOptions);
    this.context.setDefaultNavigationTimeout(getNavTimeout());
    this.context.setDefaultTimeout(getNavTimeout());

    // Block trackers, fonts, images, media to accelerate SPA loads.
    // Use specific URL patterns instead of '**/*' so most requests bypass the
    // route handler entirely (each handled request pays an IPC roundtrip).
    const blockPatterns = [
      // Images / fonts / media by extension
      /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?)(\?|$)/i,
      /\.(woff2?|ttf|otf|eot)(\?|$)/i,
      /\.(mp4|mp3|webm|ogg|wav|m4a|m4v)(\?|$)/i,
      // Third-party trackers / consent / surveys
      /assets\.adobedtm\.com/,
      /consent\.trustarc\.com/,
      /cdn\.trustarc\.com/,
      /google-analytics\.com/,
      /googletagmanager\.com/,
      /doubleclick\.net/,
      /nebula-cdn\.kampyle\.com/,
      /cdn\.qualtrics\.com/,
      /qualtrics\.com/,
      /medallia\.com/,
    ];
    for (const pattern of blockPatterns) {
      await this.context.route(pattern, (route) => route.abort().catch(() => {}));
    }
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.context = null;
    this.browser = null;
  }

  async saveStorage() {
    if (!this.context) return;
    const dir = dirname(getStoragePath());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await this.context.storageState({ path: getStoragePath() });
    log('storage state saved');
  }

  async ensureLoggedIn({ force = false } = {}) {
    await this.init();
    if (!force && this.sessionKnownGood) return true;
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = this._loginOnce({ force }).finally(() => {
      this.loginInFlight = null;
    });
    const result = await this.loginInFlight;
    this.sessionKnownGood = true;
    return result;
  }

  markSessionDead() {
    this.sessionKnownGood = false;
  }

  async _loginOnce({ force }) {
    const user = process.env.SAP_USER;
    const pass = process.env.SAP_PASS;
    if (!user || !pass) {
      throw new Error('Missing SAP_USER / SAP_PASS in environment (.env)');
    }

    const page = await this.context.newPage();
    try {
      if (!force) {
        // Probe: if storage state still valid, me.sap.com loads without accounts redirect.
        const probeOk = await this._probeSession(page);
        if (probeOk) {
          log('session reused from storage');
          return true;
        }
      }

      log('performing interactive login for', user);
      // /home forces the IdP redirect; /root is the landing page with cookie banner
      await page.goto(`${ME_SAP}/home`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: getNavTimeout() }).catch(() => {});

      try {
        // If we're still on me.sap.com landing (no redirect), click Sign In.
        if (/me\.sap\.com/i.test(page.url()) && !/accounts\.sap\.com/i.test(page.url())) {
          await dismissCookieBanner(page).catch(() => {});
          const clicked = await clickFirst(page, SIGN_IN_SELECTORS);
          if (clicked) {
            await page
              .waitForURL(/accounts\.sap\.com|hana\.ondemand\.com/i, { timeout: getNavTimeout() })
              .catch(() => {});
          }
        }

        // Step 1: email (form may live in same-origin iframe on IAS)
        const userFrame = await waitForFrameWith(page, USER_SELECTORS, getNavTimeout());
        const userSel = await firstVisible(userFrame, USER_SELECTORS);
        if (!userSel) throw new Error('no username input found');
        await userFrame.fill(userSel, user);

        // Continue/submit
        await clickFirst(userFrame, SUBMIT_SELECTORS);

        // Step 2: password. Might be same frame or a new one after redirect.
        await page.waitForLoadState('domcontentloaded', { timeout: getNavTimeout() }).catch(() => {});
        const passFrame = await waitForFrameWith(page, PASS_SELECTORS, getNavTimeout());
        const passSel = await firstVisible(passFrame, PASS_SELECTORS);
        if (!passSel) throw new Error('no password input found');
        await passFrame.fill(passSel, pass);

        await clickFirst(passFrame, SUBMIT_SELECTORS);

        await page.waitForURL(/me\.sap\.com/i, { timeout: getNavTimeout() }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: getNavTimeout() }).catch(() => {});

        const finalUrl = page.url();
        if (!/me\.sap\.com/i.test(finalUrl)) {
          throw new Error(`Login did not land on me.sap.com (final url: ${finalUrl})`);
        }

        await this.saveStorage();
        return true;
      } catch (err) {
        await dumpDebug(page).catch(() => {});
        throw err;
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  async _probeSession(page) {
    try {
      await page.goto(`${ME_SAP}/home`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Small settle wait for any redirect to trigger.
      await page.waitForTimeout(800);
      const url = page.url();
      // If redirected to accounts.sap.com or SAP IdP, session is dead.
      if (/accounts\.sap\.com|hana\.ondemand\.com\/login|saml2|\/saml\//i.test(url)) return false;
      // Still on me.sap.com/home with no redirect → session alive.
      return /me\.sap\.com\/home/i.test(url);
    } catch {
      return false;
    }
  }

  async fetchNote(noteId) {
    const id = String(noteId).replace(/\D/g, '');
    if (!id) throw new Error('Invalid note id');
    const t0 = Date.now();
    await this.ensureLoggedIn();
    const tLogin = Date.now();
    const page = await this.context.newPage();
    try {
      const res = await this._fetchNoteOnPage(page, id);
      log(
        `fetchNote ${id}: login=${tLogin - t0}ms fetch=${Date.now() - tLogin}ms total=${
          Date.now() - t0
        }ms`
      );
      await this.maybeSaveStorage();
      return res;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async _fetchNoteOnPage(page, id) {
    const urls = [
      `${ME_SAP}/notes/${id}`,
      `${ME_SAP}/notes/${id}/E`, // some locales
    ];
    let lastErr;
    for (const url of urls) {
      try {
        const tGoto = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const tAfterGoto = Date.now();
        // Wait for note content to render (title h1 with digits = note id).
        await page
          .waitForFunction(
            () => {
              // Note content ready when title shows the id + a body section with > 500 chars.
              const t = document.title || '';
              if (!/\d{3,}/.test(t)) return false;
              const main =
                document.querySelector('main') ||
                document.querySelector('[role="main"]') ||
                document.querySelector('article') ||
                document.body;
              return main && (main.innerText || '').length > 500;
            },
            undefined,
            { timeout: 10000 }
          )
          .catch(() => {});
        const tAfterWait = Date.now();
        await dismissWelcomePopup(page).catch(() => {});
        const tAfterDismiss = Date.now();
        log(
          `_fetchNoteOnPage url=${url} goto=${tAfterGoto - tGoto}ms wait=${
            tAfterWait - tAfterGoto
          }ms dismiss=${tAfterDismiss - tAfterWait}ms`
        );

        // If kicked to accounts.sap.com, session died — re-login once and retry.
        if (/accounts\.sap\.com/i.test(page.url())) {
          log('session expired mid-fetch, re-logging in');
          this.markSessionDead();
          await this.ensureLoggedIn({ force: true });
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page
            .waitForFunction(
              () => {
                const h = document.querySelector('h1');
                return h && /\d{3,}/.test(h.textContent || '');
              },
              { timeout: 15000 }
            )
            .catch(() => {});
        }

        const data = await page.evaluate(() => {
          const pick = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
          const title =
            pick('h1') ||
            pick('[class*="noteTitle"]') ||
            pick('[data-testid*="title"]') ||
            document.title;

          // Try common main content containers.
          const main =
            document.querySelector('main') ||
            document.querySelector('[role="main"]') ||
            document.querySelector('article') ||
            document.body;

          // Grab visible structured text.
          const clone = main.cloneNode(true);
          clone
            .querySelectorAll('script,style,nav,header,footer,svg,noscript')
            .forEach((n) => n.remove());
          const text = clone.innerText.replace(/\n{3,}/g, '\n\n').trim();

          const meta = {};
          document.querySelectorAll('dt,dd,[class*="metaLabel"],[class*="metaValue"]').forEach(
            () => {}
          );
          // Light metadata grab from dl pairs
          const dls = document.querySelectorAll('dl');
          dls.forEach((dl) => {
            const dts = dl.querySelectorAll('dt');
            const dds = dl.querySelectorAll('dd');
            for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
              const k = dts[i].textContent.trim();
              const v = dds[i].textContent.trim();
              if (k && v) meta[k] = v;
            }
          });

          return { title, text, meta, url: location.href };
        });

        if (!data.text || data.text.length < 40) {
          lastErr = new Error(`Empty note content at ${url}`);
          continue;
        }
        return { id, ...data };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error(`Could not fetch note ${id}`);
  }

  async searchNotes(query, limit = 10) {
    await this.ensureLoggedIn();
    const page = await this.context.newPage();
    try {
      // If query is pure digits, treat as direct note id — skip search.
      const pureId = /^\d{3,}$/.test(query.trim()) ? query.trim() : null;
      if (pureId) {
        const note = await this._fetchNoteOnPage(page, pureId);
        return {
          query,
          count: 1,
          results: [
            {
              id: note.id,
              title: note.title,
              snippet: note.text.slice(0, 200),
              url: note.url,
            },
          ],
        };
      }

      // Navigate to home, dismiss popups, then use global search.
      await page.goto(`${ME_SAP}/home`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Wait for search input to be ready rather than networkidle.
      await page
        .waitForSelector(
          'input[placeholder="Buscar"], input[placeholder="Search"], input[type="search"], #searchField input',
          { timeout: 12000 }
        )
        .catch(() => {});
      if (/accounts\.sap\.com/i.test(page.url())) {
        this.markSessionDead();
        await this.ensureLoggedIn({ force: true });
        await page.goto(`${ME_SAP}/home`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page
          .waitForSelector(
            'input[placeholder="Buscar"], input[placeholder="Search"], input[type="search"], #searchField input',
            { timeout: 12000 }
          )
          .catch(() => {});
      }
      await dismissWelcomePopup(page).catch(() => {});

      // Locate global search field and submit.
      const searchInputSelectors = [
        'input[placeholder="Buscar"]',
        'input[placeholder="Search"]',
        'input[aria-label="Buscar"]',
        'input[aria-label="Search"]',
        'input[type="search"]',
        '#searchField input',
        'input.sapMSFI',
      ];
      const inputSel = await firstVisible(page, searchInputSelectors);
      if (!inputSel) {
        await dumpDebug(page, 'search-debug').catch(() => {});
        throw new Error('Search input not found on /home');
      }
      await page.fill(inputSel, query);
      await page.press(inputSel, 'Enter');

      // Wait for at least one notes anchor to appear (results rendered).
      await page
        .waitForSelector('a[href*="/notes/"]', { timeout: 15000 })
        .catch(() => {});

      // Try to click a "Notes"/"KBA" tab/filter if present to scope results.
      const tabSelectors = [
        'button:has-text("Notes")',
        'button:has-text("Notas")',
        'button:has-text("SAP Notes")',
        'a:has-text("Notes")',
        'a:has-text("Notas")',
        '[role="tab"]:has-text("Notes")',
        '[role="tab"]:has-text("Notas")',
      ];
      const tabSel = await firstVisible(page, tabSelectors);
      if (tabSel) {
        await page.locator(tabSel).first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
      }

      const results = await page.evaluate((max) => {
        const out = [];
        const seen = new Set();
        const anchors = document.querySelectorAll('a[href*="/notes/"]');
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/notes\/(\d+)/);
          if (!m) continue;
          const id = m[1];
          if (seen.has(id)) continue;
          seen.add(id);
          const card =
            a.closest('[class*="searchResult"],[class*="result"],li,article,section') || a;
          const title = (
            card.querySelector('h2,h3,h4,[class*="title"]')?.textContent ||
            a.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const snippet = (
            card.querySelector('[class*="snippet"],[class*="summary"],p')?.textContent || ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          out.push({
            id,
            title,
            snippet,
            url: new URL(href, location.origin).href,
          });
          if (out.length >= max) break;
        }
        return out;
      }, limit);

      if (!results.length) {
        await dumpDebug(page, 'search-debug').catch(() => {});
      }
      await this.maybeSaveStorage();
      return { query, count: results.length, results };
    } finally {
      await page.close().catch(() => {});
    }
  }

  // Search + fetch content for each result in parallel.
  // Each fetched note provides a real description snippet + canonical URL.
  async searchNotesWithContent(query, limit = 5, snippetChars = 600) {
    const search = await this.searchNotes(query, limit);
    if (!search.count) return search;

    const t0 = Date.now();
    const enriched = await Promise.all(
      search.results.map(async (r) => {
        try {
          const note = await this.fetchNote(r.id);
          // Extract a clean first chunk from the "Descripción" / "Symptom" area.
          const text = (note.text || '').replace(/\s+/g, ' ').trim();
          const snippet = text.slice(0, snippetChars);
          return {
            ...r,
            title: note.title || r.title,
            url: note.url || r.url,
            snippet,
            fullLength: text.length,
          };
        } catch (err) {
          log(`enrich failed for ${r.id}:`, err?.message || err);
          return r;
        }
      })
    );
    log(`searchNotesWithContent: ${enriched.length} notes enriched in ${Date.now() - t0}ms`);
    return { query, count: enriched.length, results: enriched };
  }
}

export async function writeTextFileSafe(path, content) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(path, content, 'utf8');
}
