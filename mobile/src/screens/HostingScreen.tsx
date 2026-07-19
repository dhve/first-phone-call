import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MODEL } from '../config';
import { hostingService, type HostStatus } from '../hosting/hostingService';
import { useHostingStatus } from '../hosting/useHosting';
import { colors, ui } from './ui';

export function HostingScreen({
  onEditCard,
  onNanda,
}: {
  onEditCard: () => void;
  onNanda: () => void;
}) {
  const status = useHostingStatus();
  const [actionError, setActionError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const toggleHosting = async (enabled: boolean) => {
    if (toggling) return;
    setToggling(true);
    await run(() => (enabled ? hostingService.startHosting() : hostingService.stopHosting()));
    setToggling(false);
  };

  const model = status.model;
  const canHost = status.card.saved && model.state !== 'not-downloaded';

  return (
    <SafeAreaView style={ui.safe}>
      <StatusBar style="dark" />
      <View style={ui.header}>
        <View>
          <Text style={ui.title}>Host39 Agent</Text>
          <Text style={ui.subtitle}>{status.auth.email}</Text>
        </View>
        <Pressable onPress={() => run(() => hostingService.signOut())}>
          <Text style={ui.linkText}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={ui.content}>
        {actionError && (
          <View style={ui.card}>
            <Text style={ui.errorText}>{actionError}</Text>
          </View>
        )}

        {/* Model */}
        <View style={ui.card}>
          <View style={ui.row}>
            <Text style={ui.sectionTitle}>On-device model</Text>
            <StatusPill text={modelLabel(model.state)} tone={modelTone(model.state)} />
          </View>
          <Text style={ui.body}>
            Qwen2.5 1.5B Instruct ({MODEL.sizeLabel}). Downloads once, verified
            against its official checksum, then runs fully offline.
          </Text>
          {model.state === 'downloading' && (
            <View style={ui.progressTrack}>
              <View
                style={[ui.progressFill, { width: `${Math.round(model.progress * 100)}%` }]}
              />
            </View>
          )}
          {(model.state === 'downloading' || model.state === 'verifying' || model.state === 'loading') && (
            <View style={ui.row}>
              <ActivityIndicator color={colors.primary} />
              <Text style={ui.body}>
                {model.state === 'downloading'
                  ? `Downloading ${Math.round(model.progress * 100)}%`
                  : model.state === 'verifying'
                    ? 'Verifying checksum'
                    : 'Loading into memory'}
              </Text>
            </View>
          )}
          {model.error && <Text style={ui.errorText}>{model.error}</Text>}
          {(model.state === 'not-downloaded' || model.state === 'error') && (
            <Pressable
              style={ui.primaryBtn}
              onPress={() => run(() => hostingService.downloadAndVerifyModel())}
            >
              <Text style={ui.primaryText}>Download model</Text>
            </Pressable>
          )}
        </View>

        {/* Card */}
        <View style={ui.card}>
          <View style={ui.row}>
            <Text style={ui.sectionTitle}>Agent card</Text>
            <Pressable onPress={onEditCard}>
              <Text style={ui.linkText}>{status.card.saved ? 'Edit' : 'Create'}</Text>
            </Pressable>
          </View>
          <Text style={ui.body}>
            {status.card.saved
              ? `${status.card.name} (${status.card.slug})` +
                (status.card.allowWrites ? ' - writes allowed' : '')
              : 'No card yet. Create one to describe your agent.'}
          </Text>
        </View>

        {/* Device registration */}
        <View style={ui.card}>
          <View style={ui.row}>
            <Text style={ui.sectionTitle}>Device key</Text>
            <StatusPill
              text={status.device.registered ? 'Registered' : 'Not registered'}
              tone={status.device.registered ? 'ok' : 'warn'}
            />
          </View>
          <Text style={ui.body}>
            An ES256 key in the Android Keystore signs your published card.
            Register its public key with Host39 once.
          </Text>
          {status.device.error && <Text style={ui.errorText}>{status.device.error}</Text>}
          {!status.device.registered && (
            <Pressable
              style={ui.primaryBtn}
              onPress={() => run(() => hostingService.registerDeviceKey())}
            >
              <Text style={ui.primaryText}>Register device</Text>
            </Pressable>
          )}
        </View>

        {/* Hosting toggle */}
        <View style={ui.card}>
          <View style={ui.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={ui.sectionTitle}>Host my agent</Text>
              <Text style={ui.body}>
                Keeps a connection to the relay in a foreground service and
                answers requests on this phone.
              </Text>
            </View>
            {toggling ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={status.hostingEnabled}
                onValueChange={toggleHosting}
                disabled={!canHost && !status.hostingEnabled}
              />
            )}
          </View>
          {!canHost && !status.hostingEnabled && (
            <Text style={ui.body}>Download the model and create a card first.</Text>
          )}
        </View>

        {/* Status panel */}
        <View style={ui.card}>
          <Text style={ui.sectionTitle}>Status</Text>
          <StatusRow label="Model" value={modelLabel(model.state)} tone={modelTone(model.state)} />
          <StatusRow
            label="Local card"
            value={status.card.saved ? `Saved (${status.card.slug})` : 'None'}
            tone={status.card.saved ? 'ok' : 'warn'}
          />
          <StatusRow
            label="Signed publication"
            value={publicationLabel(status)}
            tone={
              status.publication.state === 'published'
                ? 'ok'
                : status.publication.state === 'error'
                  ? 'err'
                  : 'warn'
            }
            action={
              status.card.saved && status.publication.state !== 'publishing'
                ? { label: 'Publish', onPress: () => run(() => hostingService.publishCard()) }
                : undefined
            }
          />
          {status.publication.error && <Text style={ui.errorText}>{status.publication.error}</Text>}
          <StatusRow
            label="Relay connection"
            value={relayLabel(status)}
            tone={
              status.relay.state === 'connected'
                ? 'ok'
                : status.relay.state === 'stopped'
                  ? 'muted'
                  : status.relay.state === 'error'
                    ? 'err'
                    : 'warn'
            }
          />
          {status.relay.error && <Text style={ui.errorText}>{status.relay.error}</Text>}
          <StatusRow
            label="NANDA registration"
            value={nandaLabel(status)}
            tone={nandaTone(status)}
            action={{ label: 'Manage', onPress: onNanda }}
          />
          {status.nanda.error && <Text style={ui.errorText}>{status.nanda.error}</Text>}
          <StatusRow
            label="Public resolution"
            value={resolutionLabel(status)}
            tone={
              status.resolution.state === 'resolved'
                ? 'ok'
                : status.resolution.state === 'not-resolved'
                  ? 'err'
                  : 'muted'
            }
            action={{ label: 'Check', onPress: () => run(() => hostingService.checkResolution()) }}
          />
          {status.busy && (
            <View style={ui.row}>
              <ActivityIndicator color={colors.primary} />
              <Text style={ui.body}>Answering a request</Text>
            </View>
          )}
        </View>

        {/* Audit log (outcomes only, never content) */}
        <View style={ui.card}>
          <Text style={ui.sectionTitle}>Recent activity</Text>
          {status.audit.length === 0 ? (
            <Text style={ui.body}>No requests handled yet.</Text>
          ) : (
            [...status.audit]
              .slice(-8)
              .reverse()
              .map((entry, i) => (
                <View key={`${entry.ts}-${i}`} style={ui.statusRow}>
                  <Text style={ui.body}>
                    {entry.ts.replace('T', ' ').slice(0, 19)} · {entry.card}
                  </Text>
                  <StatusPill
                    text={entry.outcome + (entry.code ? ` (${entry.code})` : '')}
                    tone={entry.outcome === 'ok' ? 'ok' : entry.outcome === 'rejected' ? 'warn' : 'err'}
                  />
                </View>
              ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Tone = 'ok' | 'warn' | 'err' | 'muted';

const toneColor: Record<Tone, string> = {
  ok: colors.ok,
  warn: colors.warn,
  err: colors.danger,
  muted: colors.muted,
};

function StatusPill({ text, tone }: { text: string; tone: Tone }) {
  return <Text style={[ui.statusValue, { color: toneColor[tone] }]}>{text}</Text>;
}

function StatusRow(props: {
  label: string;
  value: string;
  tone: Tone;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={ui.statusRow}>
      <Text style={ui.statusLabel}>{props.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <StatusPill text={props.value} tone={props.tone} />
        {props.action && (
          <Pressable onPress={props.action.onPress}>
            <Text style={ui.linkText}>{props.action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function modelLabel(state: HostStatus['model']['state']): string {
  switch (state) {
    case 'not-downloaded': return 'Not downloaded';
    case 'downloading': return 'Downloading';
    case 'verifying': return 'Verifying';
    case 'downloaded': return 'Downloaded';
    case 'loading': return 'Loading';
    case 'loaded': return 'Loaded';
    case 'error': return 'Error';
  }
}

function modelTone(state: HostStatus['model']['state']): Tone {
  switch (state) {
    case 'loaded': return 'ok';
    case 'error': return 'err';
    case 'not-downloaded': return 'muted';
    default: return 'warn';
  }
}

function publicationLabel(status: HostStatus): string {
  switch (status.publication.state) {
    case 'not-published': return 'Not published';
    case 'publishing': return 'Publishing';
    case 'published': return `Published v${status.publication.version}`;
    case 'error': return 'Error';
  }
}

function relayLabel(status: HostStatus): string {
  switch (status.relay.state) {
    case 'stopped': return 'Stopped';
    case 'connecting': return 'Connecting';
    case 'connected': return 'Connected';
    case 'waiting-token': return 'Waiting for token';
    case 'backoff': return 'Reconnecting';
    case 'error': return 'Error';
  }
}

function resolutionLabel(status: HostStatus): string {
  switch (status.resolution.state) {
    case 'unknown': return 'Not checked';
    case 'checking': return 'Checking';
    case 'resolved': return 'Resolves publicly';
    case 'not-resolved': return 'Not resolving';
  }
}

function nandaLabel(status: HostStatus): string {
  switch (status.nanda.state) {
    case 'not-registered': return 'Not registered';
    case 'signed-in': return 'Signed in, not registered';
    case 'registering': return 'Registering';
    case 'pending': return 'Pending email verification';
    case 'active': return `Active (${status.nanda.orgId})`;
    case 'error': return 'Error';
  }
}

function nandaTone(status: HostStatus): Tone {
  switch (status.nanda.state) {
    case 'active': return 'ok';
    case 'error': return 'err';
    case 'registering':
    case 'pending': return 'warn';
    default: return 'muted';
  }
}
