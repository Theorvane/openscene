import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { createProject, deleteProject, listProjects, renameProject, type ProjectSummary } from '../lib/projectStore';
import { CloseIcon, GearIcon, PencilIcon } from '../components/Icon';
import { FormScreen } from '../components/FormScreen';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

export function ProjectsScreen({
  topInset,
  activeProjectId,
  onOpen,
  onOpenSettings
}: {
  readonly topInset: number;
  readonly activeProjectId: string | null;
  readonly onOpen: (projectId: string) => void;
  readonly onOpenSettings?: () => void;
}) {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [draftName, setDraftName] = useState('');
  /** The project being renamed, and the name being typed for it. */
  const [renaming, setRenaming] = useState<{ readonly project: ProjectSummary; readonly name: string } | null>(null);

  const refresh = useCallback(() => setProjects(listProjects()), []);
  useEffect(refresh, [refresh]);

  const confirmDelete = (project: ProjectSummary): void => {
    // Deleting a project removes its media too, so it asks. The desktop asks for
    // the same reason.
    Alert.alert('Delete project', `Delete “${project.name}” and its imported media? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteProject(project.id);
          refresh();
        }
      }
    ]);
  };

  const commitRename = (): void => {
    // The keyboard's done key reaches this too, and it is not disabled the way
    // the button is — without the same guard, submitting a blank name closed the
    // sheet on a rename that `renameProject` had refused, leaving the user
    // believing it had worked.
    if (renaming === null || renaming.name.trim().length === 0) return;
    if (renameProject(renaming.project.id, renaming.name) !== null) refresh();
    setRenaming(null);
  };

  const create = (): void => {
    const project = createProject(draftName);
    setDraftName('');
    refresh();
    onOpen(project.id);
  };

  return (
    <FormScreen
      topInset={topInset}
      contentStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={theme.textWeak} />}
    >
      <View style={styles.headRow}>
        <Text style={styles.h1}>Projects</Text>
        {onOpenSettings !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={onOpenSettings}
            style={press(styles.iconButton)}
          >
            <GearIcon size={20} />
          </Pressable>
        )}
      </View>
      <Text style={styles.sub}>
        Stored inside the app. Imported clips are copied in, so a project keeps working after the original is deleted
        from your library.
      </Text>

      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          value={draftName}
          onChangeText={setDraftName}
          placeholder="New project name"
          placeholderTextColor={theme.textWeaker}
          accessibilityLabel="New project name"
          returnKeyType="go"
          onSubmitEditing={create}
        />
        <Pressable accessibilityRole="button" onPress={create} style={press(styles.create)}>
          <Text style={styles.createText}>Create</Text>
        </Pressable>
      </View>

      {projects.length === 0 ? (
        <Text style={styles.empty}>No projects yet. Create one to start editing.</Text>
      ) : (
        projects.map((project) => (
          <View key={project.id} style={[styles.card, project.id === activeProjectId && styles.cardActive]}>
            <Pressable style={press(styles.cardMain)} accessibilityRole="button" onPress={() => onOpen(project.id)}>
              <Text style={styles.cardTitle}>{project.name}</Text>
              <Text style={styles.cardMeta}>
                {project.id === activeProjectId ? 'open · ' : ''}
                edited {project.updatedAt.slice(0, 16).replace('T', ' ')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rename ${project.name}`}
              onPress={() => setRenaming({ project, name: project.name })}
              style={press(styles.iconButton)}
            >
              <PencilIcon size={17} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${project.name}`}
              onPress={() => confirmDelete(project)}
              style={press(styles.iconButton)}
            >
              <CloseIcon size={15} color={theme.danger} />
            </Pressable>
          </View>
        ))
      )}

      {/*
        Renaming is a sheet rather than `Alert.prompt`, which is iOS-only: the
        optional call the screen used to make simply did nothing on Android, so
        the button was there and the rename was not.
      */}
      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        {/* A Modal is its own window, so the screen's avoidance does not reach
            inside it — and this one is vertically centred, which is exactly where
            the keyboard lands. */}
        <KeyboardAvoidingView style={styles.scrim} behavior="padding">
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Rename project</Text>
            <TextInput
              style={styles.sheetInput}
              value={renaming?.name ?? ''}
              onChangeText={(name) => setRenaming((current) => (current === null ? null : { ...current, name }))}
              placeholder="Project name"
              placeholderTextColor={theme.textWeaker}
              accessibilityLabel="Project name"
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={commitRename}
            />
            <View style={styles.sheetRow}>
              <Pressable accessibilityRole="button" onPress={() => setRenaming(null)} style={press(styles.sheetCancel)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={(renaming?.name ?? '').trim().length === 0}
                onPress={commitRename}
                style={press([styles.sheetSave, (renaming?.name ?? '').trim().length === 0 && styles.sheetSaveOff])}
              >
                <Text style={styles.sheetSaveText}>Rename</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  newRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: MIN_TAP,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 15
  },
  create: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 10, backgroundColor: theme.accent },
  createText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  empty: { color: theme.textWeak, fontSize: 14, marginTop: 12 },
  card: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingVertical: 6, paddingRight: 4, borderRadius: 12, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  cardActive: { borderColor: theme.accent },
  cardMain: { flex: 1, justifyContent: 'center', minHeight: MIN_TAP, paddingVertical: 4 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
  cardMeta: { color: theme.textWeaker, fontSize: 12, marginTop: 3 },
  iconButton: { width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },

  scrim: { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', padding: 26 },
  sheet: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, gap: 12, borderWidth: 1, borderColor: theme.line },
  sheetTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  sheetInput: {
    minHeight: MIN_TAP,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 15
  },
  sheetRow: { flexDirection: 'row', gap: 10 },
  sheetCancel: { flex: 1, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.line },
  sheetCancelText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' },
  sheetSave: { flex: 1, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.accent },
  sheetSaveOff: { opacity: 0.35 },
  sheetSaveText: { color: theme.bg, fontSize: 14, fontWeight: '700' }
});
