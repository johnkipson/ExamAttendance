import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { loadState, parsePeopleArray, Person, savePeople, saveSession, todayISO } from './src/storage';
import { displayDate, makeDocx, makeJson, makePdf, ReadyFile, saveToFolder, shareFile } from './src/exporters';

const C = {
  bg: '#faf7f2', card: '#ffffff', ink: '#2b2420', muted: '#7a7168', accent: '#8a5a3b', accentDark: '#734a2f',
  accentLight: '#f1e4d6', border: '#e6ddd0', good: '#3d7a4e', goodLight: '#e3efe6', danger: '#b3413b', dangerLight: '#f6e2e0',
};

// Alert with buttons does not work in a browser preview, so fall back to confirm() there.
function confirmAsk(title: string, message: string, okText: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise(res => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
    { text: okText, style: 'destructive', onPress: () => res(true) },
  ], { cancelable: true, onDismiss: () => res(false) }));
}
function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`); else Alert.alert(title, message);
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [ready, setReady] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null);
  const toast = useToast();

  useEffect(() => {
    loadState().then(({ state, fromStorage }) => {
      setPeople(state.people); setSelected(new Set(state.selected)); setTitle(state.title); setDate(state.date);
      setStatus(fromStorage ? `Loaded ${state.people.length} names saved on this phone. Changes save automatically.` : `Starting with the built-in list (${state.people.length} names). Changes save automatically on this phone.`);
      if (!fromStorage) savePeople(state.people);
      setReady(true);
    });
  }, []);

  // Save today's ticks, title and date as they change, so nothing is lost if the app closes.
  useEffect(() => { if (ready) saveSession({ selected: [...selected], title, date }); }, [ready, selected, title, date]);

  const updatePeople = useCallback((next: Person[]) => { setPeople(next); savePeople(next); }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => people.filter(p => !q || p.name.toLowerCase().includes(q)), [people, q]);

  const toggle = useCallback((id: number) => setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; }), []);
  const selectAll = (state: boolean) => setSelected(prev => { const s = new Set(prev); visible.forEach(p => state ? s.add(p.id) : s.delete(p.id)); return s; });

  const addName = (name: string) => {
    const n = name.trim(); if (!n) return;
    const nextId = people.length ? Math.max(...people.map(p => p.id)) + 1 : 1;
    updatePeople([...people, { id: nextId, name: n }]); setQuery(''); toast.show('Name added ✓');
  };
  const saveEdit = useCallback((id: number, name: string) => {
    const n = name.trim(); if (!n) { toast.show('Name cannot be empty'); return; }
    setPeople(prev => { const next = prev.map(p => p.id === id ? { ...p, name: n } : p); savePeople(next); return next; });
    setEditingId(null); toast.show('Name updated ✓');
  }, [toast]);
  const removeName = useCallback(async (p: Person) => {
    if (!(await confirmAsk('Remove name', `Remove "${p.name}" from the list?`, 'Remove'))) return;
    setPeople(prev => { const next = prev.filter(x => x.id !== p.id); savePeople(next); return next; });
    setSelected(prev => { const s = new Set(prev); s.delete(p.id); return s; });
    toast.show('Name removed ✓');
  }, [toast]);

  const report = () => ({
    title: title.trim() || 'Exam Attendance',
    dateDisplay: displayDate(date || todayISO()),
    present: people.filter(p => selected.has(p.id)).map(p => p.name),
    total: people.length,
  });
  const exportAs = async (kind: 'pdf' | 'docx') => {
    if (selected.size === 0) { notify('No names ticked', 'Please tick at least one name before generating the document.'); return; }
    setBusy(kind === 'pdf' ? 'Making the PDF…' : 'Making the Word file…');
    try {
      const f = kind === 'pdf' ? await makePdf(report()) : await makeDocx(report());
      if (Platform.OS === 'web' && kind === 'pdf') toast.show('Choose "Save as PDF" in the print window');
      else setReadyFile(f);
    } catch (e: any) { notify('Could not make the file', String(e?.message || e)); }
    finally { setBusy(null); }
  };
  const backup = () => { setMenuOpen(false); setReadyFile(makeJson('names_backup.json', people)); };
  const restore = async () => {
    setMenuOpen(false);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      const text = Platform.OS === 'web' ? await (await fetch(a.uri)).text() : await new File(a.uri).text();
      const list = parsePeopleArray(JSON.parse(text));
      if (!list.length) throw new Error('The file has no names.');
      if (!(await confirmAsk('Restore names', `Replace the current ${people.length} names with ${list.length} names from "${a.name}"?`, 'Replace'))) return;
      updatePeople(list); setSelected(new Set()); toast.show(`Loaded ${list.length} names ✓`);
    } catch (e: any) { notify('Could not read that file', String(e?.message || e)); }
  };
  const resetTicks = async () => {
    setMenuOpen(false);
    if (await confirmAsk('Start a new exam day', 'Clear all ticks and the exam title? Your name list stays.', 'Clear')) { setSelected(new Set()); setTitle(''); setDate(todayISO()); toast.show('Ready for a new exam ✓'); }
  };

  const pickDate = () => {
    const [y, m, d] = (date || todayISO()).split('-').map(Number);
    DateTimePickerAndroid.open({ value: new Date(y, m - 1, d), mode: 'date', onChange: (ev, picked) => {
      if (ev.type === 'set' && picked) { const p = (n: number) => String(n).padStart(2, '0'); setDate(`${picked.getFullYear()}-${p(picked.getMonth() + 1)}-${p(picked.getDate())}`); }
    } });
  };

  const renderItem = useCallback(({ item, index }: { item: Person; index: number }) => (
    <Row person={item} index={index} checked={selected.has(item.id)} editing={editingId === item.id}
      onToggle={toggle} onEdit={setEditingId} onSave={saveEdit} onCancel={() => setEditingId(null)} onRemove={removeName} />
  ), [selected, editingId, toggle, saveEdit, removeName]);

  if (!ready) return <SafeAreaView style={[s.fill, s.center]}><ActivityIndicator color={C.accent} size="large" /></SafeAreaView>;

  return (
    <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={visible}
          keyExtractor={p => String(p.id)}
          renderItem={renderItem}
          extraData={[selected, editingId]}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.listPad}
          ListHeaderComponent={
            <View style={s.headerWrap}>
              <View style={s.titleRow}>
                <View style={s.fill}>
                  <Text style={s.h1}>📖 Exam Attendance</Text>
                  <Text style={s.sub}>Tick who is present and make a PDF or Word list for today's exam.</Text>
                </View>
                <Pressable style={s.menuBtn} onPress={() => setMenuOpen(true)} accessibilityLabel="More options" hitSlop={8}><Text style={s.menuDots}>⋮</Text></Pressable>
              </View>

              <View style={s.card}>
                <Text style={s.label}>Exam title</Text>
                <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. பரிசுத்த வேதாகம போட்டி 3" placeholderTextColor="#b0a69c" />
                <Text style={[s.label, { marginTop: 10 }]}>Exam date</Text>
                {Platform.OS === 'web'
                  ? <TextInput style={s.input} value={date} onChangeText={setDate} placeholder="yyyy-mm-dd" />
                  : <Pressable style={[s.input, s.dateBtn]} onPress={pickDate} accessibilityRole="button"><Text style={s.dateText}>📅  {displayDate(date)}</Text><Text style={s.change}>Change</Text></Pressable>}
              </View>

              <View style={s.card}>
                <View style={s.rowWrap}>
                  <Btn kind="ghost" onPress={() => setAddOpen(true)}>+ Add name</Btn>
                  <Text style={s.count}><Text style={s.countBig}>{selected.size}</Text> present · {people.length} total</Text>
                </View>
                <Text style={s.hint}>{status}</Text>
              </View>

              <View style={[s.card, { gap: 10 }]}>
                <View style={s.searchBox}>
                  <Text style={s.searchIcon}>🔍</Text>
                  <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search a name…" placeholderTextColor="#b0a69c" returnKeyType="search" />
                  {query ? <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search"><Text style={s.clearX}>✕</Text></Pressable> : null}
                </View>
                <View style={s.rowWrap}>
                  <Btn kind="ghost" onPress={() => selectAll(true)}>Select all{q ? ' shown' : ''}</Btn>
                  <Btn kind="ghost" onPress={() => selectAll(false)}>Clear all{q ? ' shown' : ''}</Btn>
                </View>
              </View>
              <View style={s.listTop} />
            </View>
          }
          ListEmptyComponent={<View style={s.emptyBox}><Text style={s.empty}>{people.length ? 'No names match your search.' : 'No names yet. Use "+ Add name" or Restore a backup.'}</Text></View>}
          ListFooterComponent={<View style={s.listBottom} />}
        />

        <SafeAreaView edges={['bottom']} style={s.footer}>
          <Text style={s.footCount}>{selected.size} of {people.length} present</Text>
          <View style={s.footBtns}>
            <Btn kind="primary" onPress={() => exportAs('pdf')} style={s.fill}>⬇ PDF</Btn>
            <Btn kind="primary" onPress={() => exportAs('docx')} style={s.fill}>⬇ Word</Btn>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <AddNameModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={n => { addName(n); setAddOpen(false); }} />
      <MenuModal open={menuOpen} onClose={() => setMenuOpen(false)} onBackup={backup} onRestore={restore} onReset={resetTicks} />
      <FileModal file={readyFile} onClose={() => setReadyFile(null)} toast={toast.show} />
      <Modal transparent visible={!!busy} animationType="fade"><View style={[s.backdrop, s.center]}><View style={s.busyBox}><ActivityIndicator color={C.accent} /><Text style={s.busyText}>{busy}</Text></View></View></Modal>
      {toast.node}
    </SafeAreaView>
  );
}

type RowProps = { person: Person; index: number; checked: boolean; editing: boolean; onToggle: (id: number) => void; onEdit: (id: number) => void; onSave: (id: number, name: string) => void; onCancel: () => void; onRemove: (p: Person) => void };
const Row = memo(function Row({ person, index, checked, editing, onToggle, onEdit, onSave, onCancel, onRemove }: RowProps) {
  const [draft, setDraft] = useState(person.name);
  useEffect(() => { if (editing) setDraft(person.name); }, [editing, person.name]);
  if (editing) return (
    <View style={[s.row, s.rowEditing]}>
      <TextInput style={[s.input, s.fill]} value={draft} onChangeText={setDraft} autoFocus onSubmitEditing={() => onSave(person.id, draft)} returnKeyType="done" />
      <Btn kind="primary" small onPress={() => onSave(person.id, draft)}>Save</Btn>
      <Btn kind="ghost" small onPress={onCancel}>Cancel</Btn>
    </View>
  );
  return (
    <View style={[s.row, checked && s.rowOn]}>
      <Pressable style={s.rowMain} onPress={() => onToggle(person.id)} accessibilityRole="checkbox" accessibilityState={{ checked }} android_ripple={{ color: C.accentLight }}>
        <View style={[s.box, checked && s.boxOn]}>{checked ? <Text style={s.tick}>✓</Text> : null}</View>
        <Text style={s.name}><Text style={s.num}>{index + 1}.  </Text>{person.name}</Text>
      </Pressable>
      <View style={s.actions}>
        <Btn kind="ghost" small onPress={() => onEdit(person.id)}>Edit</Btn>
        <Btn kind="danger" small onPress={() => onRemove(person)}>Remove</Btn>
      </View>
    </View>
  );
});

function Btn({ children, onPress, kind, small, style }: { children: React.ReactNode; onPress: () => void; kind: 'primary' | 'ghost' | 'danger'; small?: boolean; style?: any }) {
  const bg = kind === 'primary' ? C.accent : kind === 'danger' ? C.dangerLight : C.accentLight;
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.danger : C.accent;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.btn, small && s.btnSm, { backgroundColor: bg, opacity: pressed ? 0.75 : 1 }, style]}>
      <Text style={[s.btnText, small && s.btnTextSm, { color: fg }]} numberOfLines={1}>{children}</Text>
    </Pressable>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={s.sheet}>{children}</SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AddNameModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (n: string) => void }) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(''); }, [open]);
  return (
    <Sheet open={open} onClose={onClose}>
      <Text style={s.sheetTitle}>Add a name</Text>
      <TextInput style={s.input} value={v} onChangeText={setV} placeholder="e.g. Sis. Mary Joseph, Chennai" placeholderTextColor="#b0a69c" autoFocus onSubmitEditing={() => v.trim() && onAdd(v)} returnKeyType="done" />
      <View style={[s.rowWrap, { justifyContent: 'flex-end', marginTop: 14 }]}>
        <Btn kind="ghost" onPress={onClose}>Cancel</Btn>
        <Btn kind="primary" onPress={() => v.trim() && onAdd(v)}>Add name</Btn>
      </View>
    </Sheet>
  );
}

function MenuModal({ open, onClose, onBackup, onRestore, onReset }: { open: boolean; onClose: () => void; onBackup: () => void; onRestore: () => void; onReset: () => void }) {
  const Item = ({ icon, label, sub, onPress }: { icon: string; label: string; sub: string; onPress: () => void }) => (
    <Pressable style={({ pressed }) => [s.menuItem, pressed && { backgroundColor: C.bg }]} onPress={onPress}>
      <Text style={s.menuIcon}>{icon}</Text><View style={s.fill}><Text style={s.menuLabel}>{label}</Text><Text style={s.menuSub}>{sub}</Text></View>
    </Pressable>
  );
  return (
    <Sheet open={open} onClose={onClose}>
      <Text style={s.sheetTitle}>More options</Text>
      <Item icon="💾" label="Backup names" sub="Save or share the name list as a .json file" onPress={onBackup} />
      <Item icon="📂" label="Restore names" sub="Load a names .json file (replaces the list)" onPress={onRestore} />
      <Item icon="🧹" label="New exam day" sub="Clear all ticks and the exam title" onPress={onReset} />
    </Sheet>
  );
}

function FileModal({ file, onClose, toast }: { file: ReadyFile | null; onClose: () => void; toast: (m: string) => void }) {
  const [working, setWorking] = useState(false);
  const run = async (fn: () => Promise<void>) => { if (!file || working) return; setWorking(true); try { await fn(); } catch (e: any) { notify('Something went wrong', String(e?.message || e)); } finally { setWorking(false); } };
  const kind = file?.name.endsWith('.pdf') ? 'PDF file' : file?.name.endsWith('.docx') ? 'Word file' : 'Backup file';
  return (
    <Sheet open={!!file} onClose={onClose}>
      <Text style={s.sheetTitle}>{kind} ready ✓</Text>
      <Text style={s.fileName} numberOfLines={2}>{file?.name}</Text>
      <View style={{ gap: 10, marginTop: 14 }}>
        <Btn kind="primary" onPress={() => run(async () => { await shareFile(file!); onClose(); })}>Share (WhatsApp, Gmail, Drive…)</Btn>
        <Btn kind="ghost" onPress={() => run(async () => { const where = await saveToFolder(file!); if (where) { toast(`Saved in ${where} ✓`); onClose(); } })}>Save to a folder on this phone</Btn>
        <Btn kind="ghost" onPress={onClose}>Close</Btn>
      </View>
      {working ? <ActivityIndicator style={{ marginTop: 10 }} color={C.accent} /> : null}
    </Sheet>
  );
}

function useToast() {
  const [msg, setMsg] = useState('');
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m); if (timer.current) clearTimeout(timer.current);
    Animated.timing(op, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: Platform.OS !== 'web' }).start(), 2200);
  }, [op]);
  const node = <Animated.View pointerEvents="none" style={[s.toast, { opacity: op }]}><Text style={s.toastText}>{msg}</Text></Animated.View>;
  return useMemo(() => ({ show, node }), [show, msg]); // eslint-disable-line react-hooks/exhaustive-deps
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  listPad: { paddingHorizontal: 14, paddingBottom: 24, backgroundColor: C.bg, flexGrow: 1 },
  headerWrap: { paddingTop: 12, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink },
  sub: { color: C.muted, fontSize: 14, marginTop: 2, lineHeight: 19 },
  menuBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  menuDots: { fontSize: 24, color: C.accent, fontWeight: '700', lineHeight: 28 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: '#fff', minHeight: 46 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateText: { fontSize: 16, color: C.ink },
  change: { color: C.accent, fontWeight: '700' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  count: { marginLeft: 'auto', color: C.muted, fontSize: 14 },
  countBig: { fontSize: 18, fontWeight: '700', color: C.good },
  hint: { fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 17 },
  searchBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 9, paddingHorizontal: 10, minHeight: 46 },
  searchIcon: { fontSize: 15, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 16, color: C.ink, paddingVertical: 9 },
  clearX: { fontSize: 16, color: C.muted, paddingHorizontal: 4 },
  listTop: { height: 12, backgroundColor: C.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderBottomWidth: 0, borderColor: C.border, marginBottom: -12 },
  listBottom: { height: 12, backgroundColor: C.card, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderWidth: 1, borderTopWidth: 0, borderColor: C.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, paddingRight: 8, gap: 6 },
  rowOn: { backgroundColor: '#f7fbf8' },
  rowEditing: { padding: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingLeft: 12, gap: 12, minHeight: 54 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#c9b8a6', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  boxOn: { backgroundColor: C.good, borderColor: C.good },
  tick: { color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 18 },
  name: { flex: 1, fontSize: 15.5, color: C.ink, lineHeight: 21 },
  num: { color: C.muted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 6 },
  emptyBox: { backgroundColor: C.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border, padding: 30 },
  empty: { textAlign: 'center', color: C.muted, fontSize: 15 },
  btn: { borderRadius: 9, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnSm: { paddingHorizontal: 10, paddingVertical: 7, minHeight: 34, borderRadius: 7 },
  btnText: { fontSize: 15, fontWeight: '700' },
  btnTextSm: { fontSize: 13 },
  footer: { backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 },
  footCount: { textAlign: 'center', color: C.muted, fontSize: 13, marginBottom: 6 },
  footBtns: { flexDirection: 'row', gap: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(43,36,32,.38)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 22 },
  sheetTitle: { fontSize: 19, fontWeight: '700', color: C.ink, marginBottom: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 10 },
  menuIcon: { fontSize: 24 },
  menuLabel: { fontSize: 16, fontWeight: '600', color: C.ink },
  menuSub: { fontSize: 13, color: C.muted, marginTop: 1 },
  fileName: { color: C.muted, fontSize: 14 },
  busyBox: { backgroundColor: C.card, padding: 22, borderRadius: 14, flexDirection: 'row', gap: 12, alignItems: 'center' },
  busyText: { fontSize: 16, color: C.ink },
  toast: { position: 'absolute', bottom: 120, alignSelf: 'center', backgroundColor: C.good, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, maxWidth: '90%' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
