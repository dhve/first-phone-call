import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NANDA } from '../config';
import { getNandaBaseUrl } from '../api/nanda';
import { hostingService, type HostStatus } from '../hosting/hostingService';
import { useHostingStatus } from '../hosting/useHosting';
import { defaultNandaOrgId, sanitizeOrgId } from '../nanda/registration';
import { loadSettings } from '../storage/appStorage';
import { colors, ui } from './ui';

/**
 * NANDA index registration flow: sign in to a NANDA index server, register
 * the active card as a personal agent (org_id prefilled as <handle>-<slug>,
 * editable), then wait for the contact email verification to activate it.
 */
export function NandaScreen({ onBack }: { onBack: () => void }) {
  const status = useHostingStatus();
  const settings = loadSettings();
  const card = hostingService.getActiveCard();

  const [apiUrl, setApiUrl] = useState(getNandaBaseUrl());
  const [email, setEmail] = useState(settings.email ?? '');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [orgId, setOrgId] = useState(
    settings.nandaOrgId ??
      (settings.email && card ? defaultNandaOrgId(settings.email, card.slug) : ''),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const signedIn = status.nanda.state !== 'not-registered';
  const registered =
    status.nanda.state === 'pending' ||
    status.nanda.state === 'active' ||
    status.nanda.state === 'registering';

  return (
    <SafeAreaView style={ui.safe}>
      <StatusBar style="dark" />
      <View style={ui.header}>
        <View>
          <Text style={ui.title}>NANDA registration</Text>
          <Text style={ui.subtitle}>List your agent in the NANDA index</Text>
        </View>
        <Pressable onPress={onBack}>
          <Text style={ui.linkText}>Back</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={ui.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={ui.content}>
          {error && (
            <View style={ui.card}>
              <Text style={ui.errorText}>{error}</Text>
            </View>
          )}

          {/* NANDA account */}
          <View style={ui.card}>
            <Text style={ui.sectionTitle}>NANDA account</Text>
            <Text style={ui.label}>Index server URL</Text>
            <TextInput
              style={ui.input}
              value={apiUrl}
              onChangeText={setApiUrl}
              autoCapitalize="none"
              placeholder={NANDA.defaultApiUrl}
              placeholderTextColor={colors.faint}
            />
            <Text style={ui.label}>Email</Text>
            <TextInput
              style={ui.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.faint}
            />
            <Text style={ui.label}>Password</Text>
            <TextInput
              style={ui.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
              placeholderTextColor={colors.faint}
            />
            <Pressable
              style={[ui.primaryBtn, pending && ui.primaryBtnDisabled]}
              disabled={pending}
              onPress={() =>
                run(() => hostingService.nandaAuthenticate(mode, email, password, apiUrl))
              }
            >
              {pending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={ui.primaryText}>
                  {mode === 'signin' ? 'Sign in to NANDA' : 'Create NANDA account'}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
              <Text style={ui.linkText}>
                {mode === 'signin'
                  ? 'New here? Create an account'
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </View>

          {/* Registration */}
          <View style={ui.card}>
            <Text style={ui.sectionTitle}>Agent registration</Text>
            <Text style={ui.body}>
              {card
                ? `Registers "${card.name}" (${card.slug}) as a personal agent. ` +
                  'NANDA emails a verification link to your address; the entry ' +
                  'activates when you click it.'
                : 'Create a card first, then register it here.'}
            </Text>
            <Text style={ui.label}>Organization id</Text>
            <TextInput
              style={ui.input}
              value={orgId}
              onChangeText={setOrgId}
              autoCapitalize="none"
              editable={!registered}
              placeholder="handle-slug"
              placeholderTextColor={colors.faint}
            />
            {!registered && (
              <Pressable
                style={[
                  ui.primaryBtn,
                  (pending || !card || !signedIn) && ui.primaryBtnDisabled,
                ]}
                disabled={pending || !card || !signedIn}
                onPress={() => run(() => hostingService.registerWithNanda(sanitizeOrgId(orgId)))}
              >
                <Text style={ui.primaryText}>Register with NANDA</Text>
              </Pressable>
            )}
            <View style={ui.statusRow}>
              <Text style={ui.statusLabel}>Status</Text>
              <Text style={[ui.statusValue, { color: stateColor(status) }]}>
                {stateLabel(status)}
              </Text>
            </View>
            {status.nanda.state === 'pending' && (
              <Text style={ui.body}>
                Waiting for email verification. Check the inbox for{' '}
                {settings.email ?? 'your account email'} and open the link, then refresh.
              </Text>
            )}
            {registered && (
              <Pressable onPress={() => run(() => hostingService.refreshNandaStatus())}>
                <Text style={ui.linkText}>Refresh status</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function stateLabel(status: HostStatus): string {
  switch (status.nanda.state) {
    case 'not-registered': return 'Not signed in';
    case 'signed-in': return 'Signed in, not registered';
    case 'registering': return 'Registering';
    case 'pending': return 'Pending email verification';
    case 'active': return `Active (${status.nanda.orgId})`;
    case 'error': return 'Error';
  }
}

function stateColor(status: HostStatus): string {
  switch (status.nanda.state) {
    case 'active': return colors.ok;
    case 'error': return colors.danger;
    case 'pending':
    case 'registering': return colors.warn;
    default: return colors.muted;
  }
}
