import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, getLlmCatalogProvider } from '@openvideo/shared/llmProviders';

import { readSlot } from '../lib/credentials';
import { customCredentialKey, useCustomProviders } from '../lib/customProviders';
import { useSpendPermissions, type Decision } from '../lib/permissions';
import { AGENT_TOOLS, findTool } from '../lib/agentTools';
import { sendChatTurn, type ChatMessage, type ToolCallProposal } from '../lib/agentChatClient';
import { SpendPrompt } from '../components/SpendPrompt';
import { AddCustomProvider } from '../components/AddCustomProvider';
import { theme } from '../lib/theme';

/**
 * The agent, with approval in front of every tool call.
 *
 * A tool that only reads costs nothing and gets a plain approve/deny. A tool
 * that generates media charges the user's own provider account, so it goes
 * through the same once/always/reject prompt the buttons use, keyed to its
 * feature — approving the agent to make images is not approving it to make
 * video.
 */

const SYSTEM_PROMPT =
  'You are the OpenScene editing assistant on a phone. Be brief — the screen is small. ' +
  'Plan and price before proposing anything that generates media, and say the cost in your own words. ' +
  'Every tool call is shown to the user for approval before it runs, so never claim something has happened until a tool result says it did.';

type Pending = { readonly proposal: ToolCallProposal; readonly cost: string };

export function AgentScreen({ topInset, projectId }: { readonly topInset: number; readonly projectId: string | null }) {
  const permissions = useSpendPermissions();
  const { providers: customProviders, refresh: refreshCustom } = useCustomProviders();
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [providerId, setProviderId] = useState('openai');
  const [modelId, setModelId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [images, setImages] = useState<readonly string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  // Providers worth showing: the popular ones, plus any the user has connected —
  // 153 in a phone-sized list is a search problem, not a picker.
  const providers = useMemo(() => {
    const wanted = new Set([...POPULAR_LLM_PROVIDER_IDS, ...Object.keys(connected).filter((id) => connected[id])]);
    return [
      // The user's own endpoints lead: they were added deliberately, which is a
      // stronger signal of intent than a popularity list.
      ...customProviders.map((provider) => ({ id: provider.id, label: provider.label, auth: 'api-key' as const })),
      ...LLM_PROVIDERS.filter((provider) => wanted.has(provider.id))
    ];
  }, [connected, customProviders]);

  const models = useMemo(() => {
    const custom = customProviders.find((provider) => provider.id === providerId);
    // A custom endpoint publishes no catalog, so the models are the ones the
    // user named and every one is assumed to call tools — the endpoint is the
    // authority, and it will say so if it does not.
    if (custom !== undefined) {
      return custom.models.map((id) => ({ id, label: id, toolCall: true, contextK: undefined }));
    }
    const catalog = getLlmCatalogProvider(providerId);
    // Only tool-callers: a model that cannot call tools cannot do anything here
    // except talk, and it would look broken rather than limited.
    //
    // Sorted by context window because the catalog's own order is alphabetical,
    // which put `gpt-4` at the top — a model both older and dearer than the ones
    // below it. Context size is the one ranking the catalog actually publishes.
    return (catalog?.models ?? [])
      .filter((model) => model.toolCall === true)
      .slice()
      .sort((a, b) => (b.contextK ?? 0) - (a.contextK ?? 0));
  }, [providerId, customProviders]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      ...LLM_PROVIDERS.filter((provider) => provider.credentialKey !== undefined).map(
        async (provider) => [provider.id, (await readSlot(provider.credentialKey as string)) !== null] as const
      ),
      ...customProviders.map(
        async (provider) => [provider.id, (await readSlot(customCredentialKey(provider.id))) !== null] as const
      )
    ]).then((entries) => {
      if (!cancelled) setConnected(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [customProviders]);

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === modelId)) setModelId(models[0].id);
  }, [models, modelId]);

  /** Runs one turn and stops at the first proposal that needs a decision. */
  const advance = async (history: readonly ChatMessage[]): Promise<void> => {
    setThinking(true);
    setError(null);
    const turn = await sendChatTurn({
      providerId,
      modelId,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      tools: AGENT_TOOLS
    });
    setThinking(false);

    if (!turn.ok) {
      setError(turn.message);
      return;
    }

    const assistant: ChatMessage = { role: 'assistant', content: turn.text, proposals: turn.proposals };
    const next = [...history, assistant];
    setMessages(next);

    const proposal = turn.proposals[0];
    if (proposal === undefined) return;

    const tool = findTool(proposal.name);
    if (tool === undefined) {
      await complete(next, proposal, `${proposal.name} is not a tool this app has.`);
      return;
    }

    // A free tool still asks, but with a plain approval; a spending one asks with
    // the price, unless the user already answered for that feature.
    if (tool.spends === null) {
      setPending({ proposal, cost: 'free' });
      return;
    }
    const standing = permissions.standingFor(tool.spends);
    if (standing === 'reject') {
      await complete(next, proposal, `The user has ${tool.spends} set to never charge. Do not try again.`);
      return;
    }
    if (standing === 'always') {
      await run(next, proposal);
      return;
    }
    setPending({ proposal, cost: tool.costOf(proposal.args) });
  };

  /** Feeds a tool reply back to the model and continues the loop. */
  const complete = async (history: readonly ChatMessage[], proposal: ToolCallProposal, summary: string): Promise<void> => {
    const reply: ChatMessage = { role: 'tool', content: summary, toolCallId: proposal.id, toolName: proposal.name };
    const next = [...history, reply];
    setMessages(next);
    await advance(next);
  };

  const run = async (history: readonly ChatMessage[], proposal: ToolCallProposal): Promise<void> => {
    const tool = findTool(proposal.name);
    if (tool === undefined) return;
    setThinking(true);
    try {
      const result = await tool.run(proposal.args, { projectId, onProgress: setProgress });
      const image = result.image;
      if (image !== undefined) {
        setImages((current) => [...current, `data:${image.mimeType};base64,${image.base64}`]);
      }
      setProgress(null);
      await complete(history, proposal, result.summary);
    } catch (failure) {
      setProgress(null);
      await complete(history, proposal, failure instanceof Error ? failure.message : 'The tool failed.');
    } finally {
      setThinking(false);
    }
  };

  const decide = (decision: Decision): void => {
    const request = pending;
    setPending(null);
    if (request === null) return;
    const tool = findTool(request.proposal.name);
    if (tool?.spends != null) permissions.remember(tool.spends, decision);
    if (decision === 'reject') {
      void complete(messages, request.proposal, 'The user declined this call.');
      return;
    }
    void run(messages, request.proposal);
  };

  const send = (): void => {
    const body = draft.trim();
    if (body.length === 0 || modelId.length === 0) return;
    setDraft('');
    const next = [...messages, { role: 'user', content: body } as ChatMessage];
    setMessages(next);
    void advance(next);
  };

  const providerLabel = providers.find((provider) => provider.id === providerId)?.label ?? providerId;
  const spendTool = pending === null ? undefined : findTool(pending.proposal.name);

  return (
    <View style={[styles.root, { paddingTop: topInset }]}>
      <Pressable accessibilityRole="button" style={styles.modelBar} onPress={() => setPickerOpen((open) => !open)}>
        <Text style={styles.modelText} numberOfLines={1}>
          {providerLabel} · {modelId.length === 0 ? 'no tool-calling model' : modelId}
        </Text>
        <Text style={styles.modelChevron}>{pickerOpen ? '▲' : '▼'}</Text>
      </Pressable>

      {pickerOpen && (
        <View style={styles.picker}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
            {providers.map((provider) => (
              <Pressable
                key={provider.id}
                accessibilityRole="button"
                accessibilityState={{ selected: provider.id === providerId }}
                onPress={() => setProviderId(provider.id)}
                style={[styles.chip, provider.id === providerId && styles.chipOn]}
              >
                <Text style={[styles.chipText, provider.id === providerId && styles.chipTextOn]}>{provider.label}</Text>
                {connected[provider.id] !== true && provider.auth === 'api-key' && <Text style={styles.chipDot}>•</Text>}
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={styles.modelList} nestedScrollEnabled>
            {models.length === 0 ? (
              <Text style={styles.note}>{providerLabel} lists no tool-calling models in the catalog.</Text>
            ) : (
              models.map((model) => (
                <Pressable
                  key={model.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: model.id === modelId }}
                  onPress={() => {
                    setModelId(model.id);
                    setPickerOpen(false);
                  }}
                  style={[styles.modelRow, model.id === modelId && styles.modelRowOn]}
                >
                  <Text style={styles.modelName}>{model.label}</Text>
                  {model.contextK !== undefined && <Text style={styles.modelMeta}>{model.contextK}k</Text>}
                </Pressable>
              ))
            )}
          </ScrollView>
          {connected[providerId] !== true && (
            <Text style={styles.note}>{providerLabel} has no key stored — add one in Settings.</Text>
          )}
          <View style={styles.addCustom}>
            <AddCustomProvider
              onAdded={() => {
                refreshCustom();
                setPickerOpen(true);
              }}
            />
          </View>
        </View>
      )}

      <ScrollView
        ref={scroller}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <Text style={styles.empty}>
            Ask for a plan, a script check, an image, or a shot. Every tool call is shown for approval first, and
            anything that charges your provider says the price before it runs.
          </Text>
        )}
        {messages.map((message, index) => {
          if (message.role === 'tool') {
            return (
              <View key={index} style={styles.toolBubble}>
                <Text style={styles.toolName}>{message.toolName}</Text>
                <Text style={styles.toolText}>{message.content}</Text>
              </View>
            );
          }
          if (message.content.length === 0) return null;
          return (
            <View key={index} style={[styles.bubble, message.role === 'user' ? styles.mine : styles.theirs]}>
              <Text style={message.role === 'user' ? styles.mineText : styles.theirsText}>{message.content}</Text>
            </View>
          );
        })}
        {images.map((uri, index) => (
          <View key={`image-${index}`} style={styles.toolBubble}>
            <Text style={styles.toolName}>generated image</Text>
            <Text style={styles.toolText}>{uri.slice(0, 48)}…</Text>
          </View>
        ))}
        {thinking && (
          <View style={styles.working}>
            <ActivityIndicator color={theme.accent} />
            {progress !== null && <Text style={styles.toolText}>{progress}</Text>}
          </View>
        )}
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      {/* Free tools get a plain approval — there is no price to show, and dressing
          a read-only call up as a spend would train the user to tap through. */}
      {pending !== null && spendTool?.spends == null && (
        <View style={styles.approveCard}>
          <Text style={styles.approveTitle}>Run {pending.proposal.name}?</Text>
          <Text style={styles.approveArgs} numberOfLines={4}>
            {JSON.stringify(pending.proposal.args)}
          </Text>
          <View style={styles.approveRow}>
            <Pressable accessibilityRole="button" style={styles.approveYes} onPress={() => decide('once')}>
              <Text style={styles.approveYesText}>Run</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.approveNo} onPress={() => decide('reject')}>
              <Text style={styles.approveNoText}>Decline</Text>
            </Pressable>
          </View>
        </View>
      )}

      {spendTool?.spends != null && (
        <SpendPrompt feature={spendTool.spends} headline={pending?.cost ?? ''} visible={pending !== null} onDecide={decide} />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask the assistant…"
          placeholderTextColor={theme.textWeaker}
          multiline
          accessibilityLabel="Message"
        />
        <Pressable
          accessibilityRole="button"
          disabled={thinking || draft.trim().length === 0}
          onPress={send}
          style={[styles.send, (thinking || draft.trim().length === 0) && styles.sendOff]}
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  modelBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.line },
  modelText: { flex: 1, color: theme.text, fontSize: 12, fontWeight: '600' },
  modelChevron: { color: theme.textWeaker, fontSize: 10 },
  picker: { borderBottomWidth: 1, borderBottomColor: theme.line, paddingBottom: 10 },
  pickerRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: theme.bg },
  chipDot: { color: theme.warn, fontSize: 12 },
  modelList: { maxHeight: 180 },
  modelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 9 },
  modelRowOn: { backgroundColor: theme.surface },
  modelName: { color: theme.text, fontSize: 12 },
  modelMeta: { color: theme.textWeaker, fontSize: 10, fontVariant: ['tabular-nums'] },
  addCustom: { paddingHorizontal: 20, paddingTop: 10 },
  note: { color: theme.textWeaker, fontSize: 11, lineHeight: 16, paddingHorizontal: 20, paddingTop: 6 },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10, paddingBottom: 24 },
  empty: { color: theme.textWeak, fontSize: 13, lineHeight: 20, padding: 8 },
  bubble: { maxWidth: '86%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: theme.accent },
  theirs: { alignSelf: 'flex-start', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line },
  mineText: { color: theme.bg, fontSize: 14, lineHeight: 20 },
  theirsText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  toolBubble: { alignSelf: 'stretch', padding: 11, borderRadius: 10, borderWidth: 1, borderColor: theme.line, gap: 4 },
  toolName: { color: theme.mint, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  toolText: { color: theme.textWeak, fontSize: 12, lineHeight: 18 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 4 },
  error: { color: theme.danger, fontSize: 12, lineHeight: 18 },
  approveCard: { margin: 16, marginTop: 0, padding: 14, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 8 },
  approveTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  approveArgs: { color: theme.textWeaker, fontSize: 11, lineHeight: 16 },
  approveRow: { flexDirection: 'row', gap: 8 },
  approveYes: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: 'center', backgroundColor: theme.accent },
  approveYesText: { color: theme.bg, fontSize: 13, fontWeight: '700' },
  approveNo: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: 'center', borderWidth: 1, borderColor: theme.line },
  approveNoText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.line },
  input: { flex: 1, maxHeight: 120, minHeight: 42, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, color: theme.text, fontSize: 14 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  sendOff: { opacity: 0.35 },
  sendText: { color: theme.bg, fontSize: 18, fontWeight: '700' }
});
