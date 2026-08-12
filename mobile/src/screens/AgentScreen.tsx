import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, getLlmCatalogProvider } from '@openvideo/shared/llmProviders';
import { AGENT_SCOPE_POLICY } from '@openvideo/shared/agentScope';

import { readSlot } from '../lib/credentials';
import { customCredentialKey, useCustomProviders } from '../lib/customProviders';
import { useSpendPermissions, type Decision } from '../lib/permissions';
import { AGENT_TOOLS, findTool } from '../lib/agentTools';
import { sendChatTurn, type ChatMessage, type ToolCallProposal } from '../lib/agentChatClient';
import { dropUnansweredCalls, trimHistory } from '../lib/chatMemory';
import { clearChat, readChat, writeChat } from '../lib/chatStore';
import { SpendPrompt } from '../components/SpendPrompt';
import { AddCustomProvider } from '../components/AddCustomProvider';
import { ChatText } from '../components/ChatText';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/**
 * The agent, with approval in front of every tool call.
 *
 * A tool that only reads costs nothing and gets a plain approve/deny. A tool
 * that generates media charges the user's own provider account, so it goes
 * through the same once/always/reject prompt the buttons use, keyed to its
 * feature — approving the agent to make images is not approving it to make
 * video.
 */

/**
 * What this surface can actually do, listed from the tools themselves.
 *
 * `agentTools` already refuses to declare a tool whose adapter cannot run here —
 * voice is absent for that reason — so the tool list *is* the capability list,
 * and writing the capabilities out by hand would be a second copy that goes
 * stale the first time a tool is added or dropped. The names come from the same
 * array the request carries.
 *
 * The limits are worth stating rather than leaving to be inferred. A model with
 * no trim tool does not conclude it cannot trim; it offers to, and then either
 * invents a result or leaves the user waiting for something that will never
 * happen. Naming the control they should tap instead turns a dead end into an
 * answer.
 */
const CAPABILITIES =
  `Your tools are the whole of what you can do here: ${AGENT_TOOLS.map((tool) => tool.name).join(', ')}. ` +
  'You cannot edit the timeline — trimming, splitting, moving, deleting clips and changing clip effects are done by ' +
  'the user on the Edit tab, and you have no tool for any of them. You cannot export; that is the Export button in ' +
  'the title bar. You cannot synthesise speech on this surface at all: the Voice tab sizes a script against the cut ' +
  'and says so itself. ' +
  'When a request needs something you have no tool for, say which part you cannot do and name the tab or control ' +
  'that does it, then do the part you can.';

const SYSTEM_PROMPT =
  'You are the OpenScene editing assistant on a phone. Be brief — the screen is small. ' +
  // Seen on the device: a reply that answered, then answered again in a second
  // paragraph. On a phone that is most of a screenful of scrolling for nothing.
  'Say it once; do not restate a point you have already made. ' +
  'Plan and price before proposing anything that generates media, and say the cost in your own words. ' +
  'Every tool call is shown to the user for approval before it runs, so never claim something has happened until a tool result says it did.' +
  '\n\n' +
  CAPABILITIES +
  '\n\n' +
  // The same scope both surfaces answer to, from the shared core rather than
  // written twice and left to drift.
  AGENT_SCOPE_POLICY;

type Pending = { readonly proposal: ToolCallProposal; readonly cost: string };

export function AgentScreen({
  topInset,
  keyboardOffset,
  projectId
}: {
  readonly topInset: number;
  /** Height of the chrome above this screen; see FormScreen. */
  readonly keyboardOffset: number;
  readonly projectId: string | null;
}) {
  const permissions = useSpendPermissions();
  const { providers: customProviders, refresh: refreshCustom } = useCustomProviders();
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [providerId, setProviderId] = useState('openai');
  const [modelId, setModelId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<readonly ChatMessage[]>(() => readChat(projectId));
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  /**
   * Which conversation a turn belongs to.
   *
   * A turn takes seconds against a provider and holds the history it started
   * from. Starting a new conversation, or moving to another project, while one
   * is in flight used to end with the reply landing on the cleared thread and
   * putting the whole old transcript back — and the write effect then saved it
   * again, so the discard silently undid itself. Bumping this abandons anything
   * still in the air.
   */
  const era = useRef(0);

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

  /**
   * The conversation follows the project, not the mount.
   *
   * The AI tab only exists while it is the selected tab, so every glance at the
   * timeline used to throw the transcript away. Reading on project change and
   * writing on every change keeps it where the tools' subject already is.
   */
  useEffect(() => {
    era.current += 1;
    setMessages(readChat(projectId));
  }, [projectId]);

  useEffect(() => {
    writeChat(projectId, messages);
  }, [projectId, messages]);

  /** Runs one turn and stops at the first proposal that needs a decision. */
  const advance = async (history: readonly ChatMessage[]): Promise<void> => {
    const started = era.current;
    setThinking(true);
    setError(null);
    const turn = await sendChatTurn({
      providerId,
      modelId,
      // Trimmed here and not only on the way to disk: the cap exists because
      // every turn re-sends the whole history, and that is this line. Repaired
      // for the same reason it is repaired on the way back in — a history that
      // still carries an unanswered call is one the provider refuses outright,
      // and refusing to send it beats a 400 the user cannot act on.
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...trimHistory(dropUnansweredCalls(history))],
      tools: AGENT_TOOLS
    });
    if (started !== era.current) return;
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
  const complete = async (
    history: readonly ChatMessage[],
    proposal: ToolCallProposal,
    summary: string,
    image?: string
  ): Promise<void> => {
    const reply: ChatMessage = {
      role: 'tool',
      content: summary,
      toolCallId: proposal.id,
      toolName: proposal.name,
      ...(image === undefined ? {} : { image })
    };
    const next = [...history, reply];
    setMessages(next);
    await advance(next);
  };

  const run = async (history: readonly ChatMessage[], proposal: ToolCallProposal): Promise<void> => {
    const tool = findTool(proposal.name);
    if (tool === undefined) return;
    const started = era.current;
    setThinking(true);
    try {
      const result = await tool.run(proposal.args, { projectId, onProgress: setProgress });
      if (started !== era.current) return;
      const image = result.image;
      setProgress(null);
      await complete(
        history,
        proposal,
        result.summary,
        image === undefined ? undefined : `data:${image.mimeType};base64,${image.base64}`
      );
    } catch (failure) {
      if (started !== era.current) return;
      setProgress(null);
      await complete(history, proposal, failure instanceof Error ? failure.message : 'The tool failed.');
    } finally {
      if (started === era.current) setThinking(false);
    }
  };

  /** Closes the prompt and answers the call, without remembering anything. */
  const dismiss = (): void => {
    const request = pending;
    setPending(null);
    if (request === null) return;
    void complete(messages, request.proposal, 'The user dismissed this without deciding. Ask again if it matters.');
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
    // The approval card for a free tool sits inline rather than in a modal, so
    // nothing physically stopped the user typing past it — and a turn sent with
    // that call still unanswered is rejected outright by the provider. The
    // question has to be answered before the conversation moves on.
    if (pending !== null) return;
    setDraft('');
    const next = [...messages, { role: 'user', content: body } as ChatMessage];
    setMessages(next);
    void advance(next);
  };

  const providerLabel = providers.find((provider) => provider.id === providerId)?.label ?? providerId;
  const spendTool = pending === null ? undefined : findTool(pending.proposal.name);

  return (
    // The composer is the bottom-most thing on the screen, so the keyboard
    // covered both the field being typed into and the send button. `padding` on
    // both platforms and an offset for the title bar above: the reasoning is in
    // FormScreen, which has the same problem in a scrolling shape.
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: topInset }]}
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
    >
      <View style={styles.modelBar}>
        <Pressable
          accessibilityRole="button"
          style={press(styles.modelPick)}
          onPress={() => setPickerOpen((open) => !open)}
        >
          <Text style={styles.modelText} numberOfLines={1}>
            {providerLabel} · {modelId.length === 0 ? 'no tool-calling model' : modelId}
          </Text>
          <Text style={styles.modelChevron}>{pickerOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {/* The transcript now outlives the screen, so there has to be a way to
            end one. Without it the only exit from a conversation that has gone
            wrong is deleting the project. */}
        {messages.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
            onPress={() => {
              era.current += 1;
              clearChat(projectId);
              setMessages([]);
              setError(null);
              setPending(null);
              setThinking(false);
              setProgress(null);
            }}
            style={press(styles.newChat)}
          >
            <Text style={styles.newChatText}>New</Text>
          </Pressable>
        )}
      </View>

      {pickerOpen && (
        <View style={styles.picker}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.pickerRow}
          >
            {providers.map((provider) => (
              <Pressable
                key={provider.id}
                accessibilityRole="button"
                accessibilityState={{ selected: provider.id === providerId }}
                onPress={() => setProviderId(provider.id)}
                style={press([styles.chip, provider.id === providerId && styles.chipOn])}
              >
                <Text style={[styles.chipText, provider.id === providerId && styles.chipTextOn]}>{provider.label}</Text>
                {connected[provider.id] !== true && provider.auth === 'api-key' && <Text style={styles.chipDot}>•</Text>}
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={styles.modelList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
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
                  style={press([styles.modelRow, model.id === modelId && styles.modelRowOn])}
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
        keyboardShouldPersistTaps="handled"
        // Dragging the thread pushes the keyboard down with the finger, which is
        // how every messaging app on both platforms behaves.
        keyboardDismissMode="interactive"
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
                {message.image !== undefined && (
                  <Image style={styles.image} source={{ uri: message.image }} accessibilityLabel="Generated image" resizeMode="cover" />
                )}
                {message.imageDropped === true && (
                  <Text style={styles.toolNote}>The image is not kept with the transcript. Generate it again to see it.</Text>
                )}
              </View>
            );
          }
          if (message.content.length === 0) return null;
          return (
            <View key={index} style={[styles.bubble, message.role === 'user' ? styles.mine : styles.theirs]}>
              {/* The user's own words go through unchanged; only the assistant
                  writes Markdown at us. */}
              {message.role === 'user' ? (
                <Text style={styles.mineText}>{message.content}</Text>
              ) : (
                <ChatText style={styles.theirsText}>{message.content}</ChatText>
              )}
            </View>
          );
        })}
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
            <Pressable accessibilityRole="button" style={press(styles.approveYes)} onPress={() => decide('once')}>
              <Text style={styles.approveYesText}>Run</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={press(styles.approveNo)} onPress={() => decide('reject')}>
              <Text style={styles.approveNoText}>Decline</Text>
            </Pressable>
          </View>
        </View>
      )}

      {spendTool?.spends != null && (
        <SpendPrompt
          feature={spendTool.spends}
          headline={pending?.cost ?? ''}
          visible={pending !== null}
          onDecide={decide}
          onDismiss={dismiss}
        />
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
          accessibilityLabel="Send"
          disabled={thinking || pending !== null || draft.trim().length === 0}
          onPress={send}
          style={press([styles.send, (thinking || pending !== null || draft.trim().length === 0) && styles.sendOff])}
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  modelBar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP, paddingLeft: 20, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  modelPick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP, paddingVertical: 12 },
  newChat: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  newChatText: { color: theme.textWeak, fontSize: 13, fontWeight: '700' },
  modelText: { flex: 1, color: theme.text, fontSize: 13, fontWeight: '600' },
  modelChevron: { color: theme.textWeaker, fontSize: 11 },
  picker: { borderBottomWidth: 1, borderBottomColor: theme.line, paddingBottom: 10 },
  pickerRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: MIN_TAP, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: theme.bg },
  chipDot: { color: theme.warn, fontSize: 13 },
  modelList: { maxHeight: 220 },
  modelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: MIN_TAP, paddingHorizontal: 20, paddingVertical: 10 },
  modelRowOn: { backgroundColor: theme.surface },
  modelName: { flex: 1, color: theme.text, fontSize: 14 },
  modelMeta: { color: theme.textWeaker, fontSize: 12, fontVariant: ['tabular-nums'] },
  addCustom: { paddingHorizontal: 20, paddingTop: 10 },
  note: { color: theme.textWeaker, fontSize: 12, lineHeight: 17, paddingHorizontal: 20, paddingTop: 6 },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10, paddingBottom: 24 },
  empty: { color: theme.textWeak, fontSize: 14, lineHeight: 21, padding: 8 },
  bubble: { maxWidth: '86%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: theme.accent },
  theirs: { alignSelf: 'flex-start', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line },
  mineText: { color: theme.bg, fontSize: 14, lineHeight: 20 },
  theirsText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  toolBubble: { alignSelf: 'stretch', padding: 11, borderRadius: 10, borderWidth: 1, borderColor: theme.line, gap: 6 },
  toolName: { color: theme.mint, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  toolText: { color: theme.textWeak, fontSize: 13, lineHeight: 19 },
  toolNote: { color: theme.textWeaker, fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  image: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: theme.bg },
  working: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 4 },
  error: { color: theme.danger, fontSize: 13, lineHeight: 19 },
  approveCard: { margin: 16, marginTop: 0, padding: 14, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 8 },
  approveTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  approveArgs: { color: theme.textWeaker, fontSize: 12, lineHeight: 17 },
  approveRow: { flexDirection: 'row', gap: 8 },
  approveYes: { flex: 1, minHeight: MIN_TAP, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  approveYesText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  approveNo: { flex: 1, minHeight: MIN_TAP, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.line },
  approveNoText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.line },
  input: { flex: 1, maxHeight: 120, minHeight: MIN_TAP, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, color: theme.text, fontSize: 15 },
  send: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  sendOff: { opacity: 0.35 },
  sendText: { color: theme.bg, fontSize: 19, fontWeight: '700' }
});
