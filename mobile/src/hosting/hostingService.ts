import { Agent, LlamaEngine, ToolRegistry } from 'react-native-device-agent';
import {
  AGENT,
  MIN_BATTERY_PERCENT,
  MODEL,
  agentUrn,
  buildSystemPrompt,
} from '../config';
import { createHostTools } from '../agent/tools';
import {
  checkPublicResolution,
  createServerCard,
  listServerCards,
  login,
  me,
  mintRelaySession,
  putCardCache,
  registerAccount,
  registerDevice,
  updateServerCard,
} from '../api/client';
import { downloadModel, isModelDownloaded, modelFile, verifyModel } from '../modelManager';
import {
  Host39Native,
  requireHost39Native,
  type NativeRelayState,
} from '../../modules/host39-native';
import {
  RELAY_AGENT_ERRORS,
  agentTextMessage,
  parseEnvelope,
  textFromMessage,
  type ErrorEnvelope,
  type RelayErrorName,
  type RequestEnvelope,
  type ResponseEnvelope,
} from '../relay/envelope';
import {
  appendAudit,
  getCard,
  knowledgeDir,
  loadAudit,
  loadSettings,
  saveCard as persistCard,
  saveSettings,
  type AuditEntry,
  type LocalCard,
} from '../storage/appStorage';
import { clearHost39Jwt, getHost39Jwt, setHost39Jwt } from '../storage/secureStore';
import { canonicalize } from '../util/canonicalize';
import { base64ToBase64Url, utf8ToBase64 } from '../util/base64';
import { Mutex } from '../util/mutex';

export type ModelState =
  | 'not-downloaded'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'loading'
  | 'loaded'
  | 'error';

export type PublicationState = 'not-published' | 'publishing' | 'published' | 'error';
export type ResolutionState = 'unknown' | 'checking' | 'resolved' | 'not-resolved';
export type RelayUiState = NativeRelayState | 'error';

export interface HostStatus {
  auth: { signedIn: boolean; email?: string };
  model: { state: ModelState; progress: number; error?: string };
  card: { saved: boolean; slug?: string; name?: string; allowWrites?: boolean };
  device: { registered: boolean; deviceId?: string; error?: string };
  publication: { state: PublicationState; version?: string; error?: string };
  relay: { state: RelayUiState; error?: string };
  /** Placeholder until NANDA verification lands. */
  nanda: { state: 'not-verified' };
  resolution: { state: ResolutionState };
  hostingEnabled: boolean;
  busy: boolean;
  audit: AuditEntry[];
}

const SEVERE_THERMAL = new Set(['severe', 'critical', 'emergency', 'shutdown']);

/**
 * Singleton controller for the phone agent: model lifecycle, the single
 * shared engine, relay wiring, request gating, and the status panel state.
 */
class HostingService {
  private status: HostStatus = {
    auth: { signedIn: false },
    model: { state: 'not-downloaded', progress: 0 },
    card: { saved: false },
    device: { registered: false },
    publication: { state: 'not-published' },
    relay: { state: 'stopped' },
    nanda: { state: 'not-verified' },
    resolution: { state: 'unknown' },
    hostingEnabled: false,
    busy: false,
    audit: [],
  };

  private listeners = new Set<() => void>();
  /** The ONE shared engine held while hosting is enabled. */
  private engine: LlamaEngine | null = null;
  /** Serializes inference: exactly one in-flight completion. */
  private mutex = new Mutex();
  private initialized = false;

  // Store plumbing (useSyncExternalStore-compatible).

  getStatus = (): HostStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<HostStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  // Lifecycle

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const native = Host39Native;
    if (native) {
      native.addListener('onRelayMessage', ({ json }) => {
        void this.handleRelayFrame(json);
      });
      native.addListener('onRelayState', ({ state }) => {
        this.update({ relay: { state } });
      });
      native.addListener('onRelayTokenRequest', () => {
        void this.handleTokenRequest();
      });
    }

    const settings = loadSettings();
    const token = await getHost39Jwt().catch(() => null);
    const card = getCard(settings.activeCardSlug);

    this.update({
      auth: { signedIn: !!token && !!settings.email, email: settings.email },
      model: {
        state: isModelDownloaded() ? 'downloaded' : 'not-downloaded',
        progress: 0,
      },
      card: card
        ? { saved: true, slug: card.slug, name: card.name, allowWrites: card.allowWrites }
        : { saved: false },
      device: { registered: !!settings.deviceId, deviceId: settings.deviceId },
      relay: { state: native?.getRelayState() ?? 'stopped' },
      audit: loadAudit(),
    });

    // If the foreground service outlived the JS runtime (STICKY restart),
    // reflect that hosting is on and rebuild the engine it needs.
    if (settings.hostingEnabled && native && native.getRelayState() !== 'stopped') {
      this.update({ hostingEnabled: true });
      await this.ensureEngineLoaded().catch(() => undefined);
    }
  }

  // Auth

  async signIn(email: string, password: string, serverBaseUrl: string): Promise<void> {
    saveSettings({ serverBaseUrl: serverBaseUrl.trim().replace(/\/+$/, '') });
    const { token } = await login(email.trim(), password);
    await setHost39Jwt(token);
    const profile = await me();
    saveSettings({ email: profile.email });
    this.update({ auth: { signedIn: true, email: profile.email } });
  }

  async signUp(email: string, password: string, serverBaseUrl: string): Promise<void> {
    saveSettings({ serverBaseUrl: serverBaseUrl.trim().replace(/\/+$/, '') });
    const { token } = await registerAccount(email.trim(), password);
    await setHost39Jwt(token);
    const profile = await me();
    saveSettings({ email: profile.email });
    this.update({ auth: { signedIn: true, email: profile.email } });
  }

  async signOut(): Promise<void> {
    await this.stopHosting().catch(() => undefined);
    await clearHost39Jwt();
    this.update({ auth: { signedIn: false } });
  }

  // Model

  async downloadAndVerifyModel(): Promise<void> {
    try {
      this.update({ model: { state: 'downloading', progress: 0 } });
      await downloadModel((fraction) => {
        this.update({ model: { state: 'downloading', progress: fraction } });
      });
      this.update({ model: { state: 'verifying', progress: 1 } });
      await verifyModel();
      this.update({ model: { state: 'downloaded', progress: 1 } });
    } catch (e) {
      this.update({
        model: { state: 'error', progress: 0, error: (e as Error).message },
      });
      throw e;
    }
  }

  private async ensureEngineLoaded(): Promise<LlamaEngine> {
    if (this.engine?.isLoaded) return this.engine;
    if (!isModelDownloaded()) throw new Error('Model is not downloaded');

    this.update({ model: { state: 'loading', progress: 1 } });
    try {
      const engine = await LlamaEngine.load({ model: modelFile().uri, n_ctx: MODEL.nCtx });
      this.engine = engine;
      this.update({ model: { state: 'loaded', progress: 1 } });
      return engine;
    } catch (e) {
      this.update({
        model: { state: 'error', progress: 1, error: (e as Error).message },
      });
      throw e;
    }
  }

  private async releaseEngine(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (engine) await engine.release().catch(() => undefined);
    this.update({
      model: {
        state: isModelDownloaded() ? 'downloaded' : 'not-downloaded',
        progress: 0,
      },
    });
  }

  // Device registration

  async registerDeviceKey(): Promise<void> {
    try {
      const jwk = await requireHost39Native().getPublicKeyJwk();
      const device = await registerDevice(jwk);
      saveSettings({ deviceId: device.id });
      this.update({ device: { registered: true, deviceId: device.id } });
    } catch (e) {
      this.update({
        device: { registered: false, error: (e as Error).message },
      });
      throw e;
    }
  }

  // Card

  saveCard(card: LocalCard): void {
    persistCard(card);
    saveSettings({ activeCardSlug: card.slug });
    this.update({
      card: { saved: true, slug: card.slug, name: card.name, allowWrites: card.allowWrites },
      // Local edits make any previous signed publication stale.
      publication: { state: 'not-published' },
    });
  }

  getActiveCard(): LocalCard | undefined {
    return getCard(loadSettings().activeCardSlug);
  }

  // Signed publication

  async publishCard(): Promise<void> {
    const card = this.getActiveCard();
    const { email, deviceId } = loadSettings();
    if (!card) throw new Error('No card to publish');
    if (!email) throw new Error('Not signed in');
    if (!deviceId) throw new Error('Register the device key first');

    // The server requires a strictly increasing integer version per slug.
    const nextVersion = (card.version || 0) + 1;
    this.update({ publication: { state: 'publishing', version: String(nextVersion) } });
    try {
      // 1. Keep the server's DB record in sync via the existing cards CRUD.
      const serverCards = await listServerCards();
      const existing = serverCards.find((c) => c.slug === card.slug);
      const cardBody = {
        slug: card.slug,
        display_name: card.name,
        description: card.description,
        version: String(nextVersion),
        skills: card.skills,
      };
      if (existing) await updateServerCard(existing.id, cardBody);
      else await createServerCard(cardBody);

      // 2. Sign the canonicalized card JSON with the Keystore key and push
      //    the cache the server serves while the phone is offline.
      const signable = this.buildSignableCard(card, email, nextVersion);
      const canonical = canonicalize(signable);
      const signature = base64ToBase64Url(
        await requireHost39Native().sign(utf8ToBase64(canonical)),
      );

      await putCardCache(card.slug, {
        device_id: deviceId,
        card: signable,
        signature,
        version: nextVersion,
      });

      persistCard({ ...card, version: nextVersion });
      this.update({ publication: { state: 'published', version: String(nextVersion) } });
    } catch (e) {
      this.update({
        publication: {
          state: 'error',
          version: String(nextVersion),
          error: (e as Error).message,
        },
      });
      throw e;
    }
  }

  private buildSignableCard(
    card: LocalCard,
    email: string,
    version: number,
  ): Record<string, unknown> {
    return {
      name: card.name,
      description: card.description || null,
      version,
      capabilities: { streaming: false, pushNotifications: false },
      authentication: { schemes: ['none'] },
      skills: card.skills,
      _meta: {
        identifier: agentUrn(email, card.slug),
        hostedBy: 'host39.org',
      },
    };
  }

  // Public resolution

  async checkResolution(): Promise<void> {
    const card = this.getActiveCard();
    const email = loadSettings().email;
    if (!card || !email) {
      this.update({ resolution: { state: 'unknown' } });
      return;
    }
    this.update({ resolution: { state: 'checking' } });
    const ok = await checkPublicResolution(email, card.slug);
    this.update({ resolution: { state: ok ? 'resolved' : 'not-resolved' } });
  }

  // Hosting toggle

  async startHosting(): Promise<void> {
    if (!this.getActiveCard()) throw new Error('Create a card before hosting');
    const deviceId = loadSettings().deviceId;
    if (!deviceId) throw new Error('Register the device key first');
    await this.ensureEngineLoaded();

    const session = await mintRelaySession(deviceId);
    // ws_url embeds the single-use token; hand the service the bare URL plus
    // the token so it can append fresh tokens on reconnect.
    const baseUrl = session.ws_url.split('?')[0];
    await requireHost39Native().startRelayService(baseUrl, session.token);
    saveSettings({ hostingEnabled: true });
    this.update({ hostingEnabled: true });
  }

  async stopHosting(): Promise<void> {
    saveSettings({ hostingEnabled: false });
    if (Host39Native) await Host39Native.stopRelayService();
    await this.releaseEngine();
    this.update({ hostingEnabled: false, relay: { state: 'stopped' } });
  }

  // Relay plumbing

  private async handleTokenRequest(): Promise<void> {
    // The service's single-use token was consumed or expired; mint another.
    const deviceId = loadSettings().deviceId;
    if (!deviceId) {
      this.update({
        relay: { state: 'error', error: 'Device is not registered; cannot mint relay tokens.' },
      });
      return;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const session = await mintRelaySession(deviceId);
        await requireHost39Native().provideRelayToken(session.token);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    this.update({
      relay: { state: 'error', error: 'Could not mint a relay token; check the server.' },
    });
  }

  private async handleRelayFrame(json: string): Promise<void> {
    const envelope = parseEnvelope(json);
    if (!envelope) return;
    if (envelope.type === 'request') {
      await this.handleRequest(envelope);
    }
    // hello/ready/pong are connection bookkeeping; state comes via onRelayState.
  }

  private async sendEnvelope(env: ResponseEnvelope | ErrorEnvelope): Promise<void> {
    await Host39Native?.sendRelayMessage(JSON.stringify(env));
  }

  private async rejectRequest(
    env: RequestEnvelope,
    code: RelayErrorName,
    message: string,
    cardSlug: string,
  ): Promise<void> {
    await this.sendEnvelope({
      type: 'error',
      id: env.id,
      code: RELAY_AGENT_ERRORS[code],
      message,
    });
    this.recordAudit({ ts: new Date().toISOString(), card: cardSlug, outcome: 'rejected', code });
  }

  private recordAudit(entry: AuditEntry): void {
    appendAudit(entry);
    this.update({ audit: loadAudit() });
  }

  /** Gate, run, and answer one relay request. */
  private async handleRequest(env: RequestEnvelope): Promise<void> {
    const card = this.getActiveCard();
    const slug = card?.slug ?? 'unknown';

    if (env.method !== 'message/send') {
      await this.rejectRequest(env, 'METHOD_NOT_FOUND', `Unsupported method: ${env.method}`, slug);
      return;
    }

    // Request gating: structured rejections, checked before any inference.
    let health;
    try {
      health = await requireHost39Native().deviceHealth();
    } catch (e) {
      await this.rejectRequest(env, 'INTERNAL', (e as Error).message, slug);
      return;
    }
    if (!health.online) {
      await this.rejectRequest(env, 'OFFLINE', 'Device reports no internet connectivity', slug);
      return;
    }
    if (this.mutex.locked) {
      await this.rejectRequest(env, 'BUSY', 'Another request is being processed', slug);
      return;
    }
    if (SEVERE_THERMAL.has(health.thermal)) {
      await this.rejectRequest(env, 'THERMAL', `Device thermal status is ${health.thermal}`, slug);
      return;
    }
    if (health.batteryLevel < MIN_BATTERY_PERCENT && !health.charging) {
      await this.rejectRequest(
        env,
        'LOW_BATTERY',
        `Battery at ${health.batteryLevel}% and not charging`,
        slug,
      );
      return;
    }
    if (!this.engine?.isLoaded) {
      await this.rejectRequest(env, 'MODEL_NOT_LOADED', 'Model is not loaded', slug);
      return;
    }
    if (!card) {
      await this.rejectRequest(env, 'BAD_REQUEST', 'No card is configured on this device', slug);
      return;
    }

    const prompt = textFromMessage(env.params?.message);
    if (!prompt) {
      await this.rejectRequest(env, 'BAD_REQUEST', 'Message has no text parts', slug);
      return;
    }

    const deadline = env.deadline || Date.now() + AGENT.defaultDeadlineMs;
    if (Date.now() >= deadline) {
      await this.rejectRequest(env, 'DEADLINE_EXCEEDED', 'Deadline already passed', slug);
      return;
    }

    const engine = this.engine;
    try {
      await this.mutex.run(async () => {
        this.update({ busy: true });
        // FRESH agent per request: no history carryover between callers.
        const agent = new Agent({
          engine,
          registry: new ToolRegistry(
            createHostTools({ knowledgeDir: knowledgeDir(), allowWrites: card.allowWrites }),
          ),
          systemPrompt: buildSystemPrompt(card),
          maxSteps: AGENT.maxSteps,
          temperature: AGENT.temperature,
          maxTokens: AGENT.maxOutputTokens,
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deadline - Date.now());
        try {
          const text = await agent.send(prompt, { signal: controller.signal });
          await this.sendEnvelope({ type: 'response', id: env.id, result: agentTextMessage(text) });
          this.recordAudit({ ts: new Date().toISOString(), card: card.slug, outcome: 'ok' });
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      const codeName: RelayErrorName = aborted ? 'DEADLINE_EXCEEDED' : 'INTERNAL';
      await this.sendEnvelope({
        type: 'error',
        id: env.id,
        code: RELAY_AGENT_ERRORS[codeName],
        message: aborted ? 'Deadline exceeded during processing' : (e as Error).message,
      });
      this.recordAudit({
        ts: new Date().toISOString(),
        card: card.slug,
        outcome: 'error',
        code: codeName,
      });
    } finally {
      this.update({ busy: false });
    }
  }
}

export const hostingService = new HostingService();
