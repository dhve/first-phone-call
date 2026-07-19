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
import { SERVER } from '../config';
import { hostingService } from '../hosting/hostingService';
import { loadSettings } from '../storage/appStorage';
import { colors, ui } from './ui';

export function SignInScreen() {
  const [email, setEmail] = useState(loadSettings().email ?? '');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(
    loadSettings().serverBaseUrl ?? SERVER.defaultBaseUrl,
  );
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password || pending) return;
    setPending(true);
    setError(null);
    try {
      if (mode === 'signin') await hostingService.signIn(email, password, serverUrl);
      else await hostingService.signUp(email, password, serverUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={ui.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={ui.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={[ui.content, { paddingTop: 48 }]}>
          <Text style={ui.title}>Host39 Agent</Text>
          <Text style={ui.body}>
            Host your personal agent card on this phone. Sign in to your Host39
            account to get started.
          </Text>

          <View style={ui.card}>
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
            <Text style={ui.label}>Server URL</Text>
            <TextInput
              style={ui.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              placeholder={SERVER.defaultBaseUrl}
              placeholderTextColor={colors.faint}
            />
            {error && <Text style={ui.errorText}>{error}</Text>}
            <Pressable
              style={[ui.primaryBtn, pending && ui.primaryBtnDisabled]}
              onPress={submit}
              disabled={pending}
            >
              {pending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={ui.primaryText}>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
