import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { hostingService } from './hosting/hostingService';
import { useHostingStatus } from './hosting/useHosting';
import { CardEditorScreen } from './screens/CardEditorScreen';
import { HostingScreen } from './screens/HostingScreen';
import { SignInScreen } from './screens/SignInScreen';
import { colors, ui } from './screens/ui';

export function Host39App() {
  const status = useHostingStatus();
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<'hosting' | 'card'>('hosting');

  useEffect(() => {
    hostingService.init().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <SafeAreaView style={ui.safe}>
        <StatusBar style="dark" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={ui.body}>Starting Host39 Agent</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!status.auth.signedIn) {
    return <SignInScreen />;
  }

  if (screen === 'card') {
    return <CardEditorScreen onBack={() => setScreen('hosting')} />;
  }

  return <HostingScreen onEditCard={() => setScreen('card')} />;
}
