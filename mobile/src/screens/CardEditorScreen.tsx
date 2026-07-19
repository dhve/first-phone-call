import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { hostingService } from '../hosting/hostingService';
import type { CardSkill, LocalCard } from '../storage/appStorage';
import { colors, ui } from './ui';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Skills are edited as one per line: "name: description". */
function skillsToText(skills: CardSkill[]): string {
  return skills.map((s) => (s.description ? `${s.name}: ${s.description}` : s.name)).join('\n');
}

function textToSkills(text: string): CardSkill[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf(':');
      const name = sep >= 0 ? line.slice(0, sep).trim() : line;
      const description = sep >= 0 ? line.slice(sep + 1).trim() : undefined;
      return {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill',
        name,
        description: description || undefined,
      };
    });
}

export function CardEditorScreen({ onBack }: { onBack: () => void }) {
  const existing = hostingService.getActiveCard();
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [skillsText, setSkillsText] = useState(existing ? skillsToText(existing.skills) : '');
  const [allowWrites, setAllowWrites] = useState(existing?.allowWrites ?? false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const cleanSlug = slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(cleanSlug)) {
      setError('Slug must be lowercase letters, digits, and hyphens (e.g. "my-agent").');
      return;
    }
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    const card: LocalCard = {
      slug: cleanSlug,
      name: name.trim(),
      description: description.trim(),
      skills: textToSkills(skillsText),
      allowWrites,
      version: existing?.version ?? 0,
      updatedAt: new Date().toISOString(),
    };
    hostingService.saveCard(card);
    onBack();
  };

  return (
    <SafeAreaView style={ui.safe}>
      <StatusBar style="dark" />
      <View style={ui.header}>
        <View>
          <Text style={ui.title}>Agent card</Text>
          <Text style={ui.subtitle}>What other agents see and can ask about</Text>
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
          <View style={ui.card}>
            <Text style={ui.label}>Slug</Text>
            <TextInput
              style={ui.input}
              value={slug}
              onChangeText={setSlug}
              autoCapitalize="none"
              editable={!existing}
              placeholder="my-agent"
              placeholderTextColor={colors.faint}
            />
            <Text style={ui.label}>Name</Text>
            <TextInput
              style={ui.input}
              value={name}
              onChangeText={setName}
              placeholder="Vedh's Assistant"
              placeholderTextColor={colors.faint}
            />
            <Text style={ui.label}>Description</Text>
            <TextInput
              style={[ui.input, { minHeight: 70 }]}
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="What this agent knows and answers"
              placeholderTextColor={colors.faint}
            />
            <Text style={ui.label}>Skills (one per line, "name: description")</Text>
            <TextInput
              style={[ui.input, { minHeight: 90 }]}
              value={skillsText}
              onChangeText={setSkillsText}
              multiline
              autoCapitalize="none"
              placeholder={'availability: When I am free this week\nfaq: Answers about my projects'}
              placeholderTextColor={colors.faint}
            />
            <View style={ui.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={ui.label}>Allow writes to knowledge folder</Text>
                <Text style={ui.body}>
                  Lets remote requests save files via write_file. Off by default.
                </Text>
              </View>
              <Switch value={allowWrites} onValueChange={setAllowWrites} />
            </View>
            {error && <Text style={ui.errorText}>{error}</Text>}
            <Pressable style={ui.primaryBtn} onPress={save}>
              <Text style={ui.primaryText}>Save card</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
